import { GoogleGenAI, Modality } from "@google/genai";

// Helpers for decoding Gemini PCM Audio
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper to encode audio to base64
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Float32Array PCM to WAV format
function float32ToWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const bufferSize = 44 + dataSize;
  
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  
  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write PCM samples (convert float32 to int16)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, int16, true);
    offset += 2;
  }
  
  return new Uint8Array(buffer);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  // Ensure we are reading the buffer correctly aligned
  // Safety check for byte length
  if (data.byteLength % 2 !== 0) {
      // Pad with one zero byte if odd (shouldn't happen for valid PCM16)
      const newData = new Uint8Array(data.byteLength + 1);
      newData.set(data);
      data = newData;
  }

  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export class VoiceService {
  private recognition: any = null;
  private ai: GoogleGenAI;
  private audioContext: AudioContext | null = null;
  
  // Microphone analysis
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  
  // Audio recording for Gemini STT
  private scriptProcessor: ScriptProcessorNode | null = null;
  private recordedSamples: Float32Array[] = [];
  private isRecording: boolean = false;
  private recordingResolve: ((transcript: string) => void) | null = null;

  constructor() {
    // Initialize Google GenAI
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    console.log("VoiceService init, API Key present:", !!apiKey, "Key length:", apiKey.length);
    this.ai = new GoogleGenAI({ apiKey });
    
    // Log available APIs
    console.log("MediaRecorder available:", typeof MediaRecorder !== 'undefined');
    console.log("AudioContext available:", typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined');
    
    // Initialize Speech Recognition as fallback (Browser Native)
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'ru-RU';
      this.recognition.maxAlternatives = 1;
      console.log("SpeechRecognition API available (fallback)");
    } else {
      console.log("SpeechRecognition API NOT available - using AudioContext + Gemini");
    }
  }

  // Check if speech recognition is supported (AudioContext always available)
  isSpeechRecognitionSupported(): boolean {
    return typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined' || this.recognition !== null;
  }

  // --- Audio Context Management ---

  /**
   * Must be called synchronously within a user gesture (click/keypress).
   * Ensures AudioContext is running before any async network calls.
   */
  async prepareForSpeech(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    }

    if (this.audioContext.state === 'suspended') {
        try {
            await this.audioContext.resume();
        } catch (e) {
            console.warn("AudioContext resume failed in prepareForSpeech:", e);
        }
    }
  }

  // --- Microphone & Visualizer ---

  async startAudioAnalysis(): Promise<AnalyserNode | null> {
    try {
      // Reuse prepare logic to ensure context exists
      await this.prepareForSpeech();
      
      if (!this.audioContext) {
          console.warn("AudioContext failed to initialize");
          return null;
      }
      
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      
      this.microphone.connect(this.analyser);
      // Note: Do not connect to destination to avoid feedback loop
      
      return this.analyser;
    } catch (error) {
      console.warn("Could not start audio analysis (microphone access):", error);
      return null;
    }
  }

  stopAudioAnalysis() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.microphone) {
        this.microphone.disconnect();
        this.microphone = null;
    }
    // We do NOT close audioContext here because we might need it for TTS immediately after
    this.analyser = null;
  }

  // --- Speech To Text (using AudioContext + Gemini) ---

  listen(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      // Try Web Speech API first if available (more reliable when it works)
      if (this.recognition) {
        try {
          const transcript = await this.listenWithWebSpeech();
          if (transcript) {
            resolve(transcript);
            return;
          }
        } catch (error) {
          console.warn("Web Speech API failed, trying Gemini STT:", error);
        }
      }
      
      // Fallback to AudioContext + Gemini STT
      try {
        const transcript = await this.listenWithGemini();
        resolve(transcript);
      } catch (error) {
        console.error("Gemini STT failed:", error);
        resolve(""); // Return empty string on error
      }
    });
  }

  // AudioContext + Gemini STT implementation (records WAV)
  private async listenWithGemini(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure AudioContext exists
        await this.prepareForSpeech();
        
        if (!this.audioContext) {
          reject(new Error("AudioContext not available"));
          return;
        }

        // Use existing stream or create new one
        let stream = this.stream;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true
            } 
          });
          this.stream = stream;
        }

        // Create audio source from microphone
        const source = this.audioContext.createMediaStreamSource(stream);
        
        // Create script processor to capture raw PCM
        // Note: ScriptProcessorNode is deprecated but works everywhere
        // AudioWorklet is better but more complex
        const bufferSize = 4096;
        this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        this.recordedSamples = [];
        this.isRecording = true;
        this.recordingResolve = resolve;

        this.scriptProcessor.onaudioprocess = (e) => {
          if (this.isRecording) {
            const inputData = e.inputBuffer.getChannelData(0);
            // Clone the data as it gets reused
            this.recordedSamples.push(new Float32Array(inputData));
          }
        };

        // Connect: source -> scriptProcessor -> destination (required for processing)
        source.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.audioContext.destination);
        
        console.log("Recording started with AudioContext (WAV format)...");

      } catch (error) {
        console.error("Failed to start recording:", error);
        reject(error);
      }
    });
  }

  // Process recorded audio and send to Gemini
  private async processRecordedAudio(): Promise<string> {
    if (this.recordedSamples.length === 0) {
      console.log("No audio recorded");
      return "";
    }

    try {
      // Combine all samples into one Float32Array
      const totalLength = this.recordedSamples.reduce((acc, arr) => acc + arr.length, 0);
      const combinedSamples = new Float32Array(totalLength);
      
      let offset = 0;
      for (const samples of this.recordedSamples) {
        combinedSamples.set(samples, offset);
        offset += samples.length;
      }

      console.log("Total recorded samples:", totalLength, "Duration:", (totalLength / (this.audioContext?.sampleRate || 44100)).toFixed(2), "seconds");

      // Convert to WAV format
      const sampleRate = this.audioContext?.sampleRate || 44100;
      const wavData = float32ToWav(combinedSamples, sampleRate);
      
      console.log("WAV data size:", wavData.length, "bytes");

      // Convert to base64
      const base64Audio = encode(wavData);

      // Send to Gemini for transcription
      return await this.transcribeWithGemini(base64Audio);
    } catch (error) {
      console.error("Error processing recorded audio:", error);
      return "";
    }
  }

  // Transcribe audio using Gemini (expects WAV base64)
  private async transcribeWithGemini(base64Audio: string): Promise<string> {
    try {
      console.log("Sending WAV audio to Gemini for transcription...");
      
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: base64Audio
              }
            },
            {
              text: "Транскрибируй это аудио. Верни ТОЛЬКО текст того, что было сказано на русском языке, без пояснений и комментариев. Если речь не распознана или аудио пустое, верни пустую строку."
            }
          ]
        }]
      });

      const transcript = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      console.log("Gemini transcription result:", transcript);
      return transcript;
    } catch (error) {
      console.error("Gemini transcription error:", error);
      throw error;
    }
  }

  // Web Speech API implementation (fallback for browsers that support it)
  private listenWithWebSpeech(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.recognition) {
        reject(new Error("Speech Recognition API not supported"));
        return;
      }

      let hasResult = false;

      this.recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        hasResult = true;
        resolve(transcript);
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          resolve("");
        } else {
          console.warn("Speech recognition error", event.error);
          reject(new Error(event.error));
        }
      };

      this.recognition.onend = () => {
        if (!hasResult) {
          resolve("");
        }
      };

      try {
        this.recognition.start();
      } catch (e) {
        console.warn("Could not start recognition", e);
        reject(e);
      }
    });
  }

  stopListening() {
    // Stop AudioContext recording
    if (this.scriptProcessor && this.isRecording) {
      this.isRecording = false;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
      console.log("Recording stopped");
      
      // Process the recorded audio
      if (this.recordingResolve) {
        this.processRecordedAudio().then((transcript) => {
          if (this.recordingResolve) {
            this.recordingResolve(transcript);
            this.recordingResolve = null;
          }
        });
      }
    }
    
    // Stop Web Speech API if active
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        console.warn("Error stopping recognition", e);
      }
    }
  }

  // --- Google Gemini Text To Speech Only ---

  async speak(text: string): Promise<void> {
    if (!text) return;

    // Ensure AudioContext is ready.
    // NOTE: This call might fail to resume if not triggered by user gesture,
    // which is why prepareForSpeech() should be called earlier in the flow.
    await this.prepareForSpeech();
    
    if (!this.audioContext) return;

    try {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Kore' }, 
                },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (!base64Audio) {
            console.warn("No audio data received from Gemini TTS");
            return;
        }

        // Decode PCM
        const audioBuffer = await decodeAudioData(
            decode(base64Audio),
            this.audioContext,
            24000,
            1
        );

        // Play Audio
        return new Promise((resolve, reject) => {
            if (!this.audioContext) { 
                resolve(); 
                return; 
            }
            
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioContext.destination);
            
            source.onended = () => {
                resolve();
            };
            
            source.start();
        });

    } catch (error) {
        console.error("Gemini TTS Error:", error);
        // Re-throw to let caller handle it
        throw error;
    }
  }
}

export const voiceService = new VoiceService();
