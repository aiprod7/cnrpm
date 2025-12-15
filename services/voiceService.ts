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
  
  // MediaRecorder for Gemini STT
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording: boolean = false;

  constructor() {
    // Initialize Google GenAI
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    console.log("VoiceService init, API Key present:", !!apiKey, "Key length:", apiKey.length);
    this.ai = new GoogleGenAI({ apiKey });
    
    // Check for MediaRecorder support (primary method for Telegram WebView)
    if (typeof MediaRecorder !== 'undefined') {
      console.log("MediaRecorder API available - will use Gemini for STT");
    }
    
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
      console.log("SpeechRecognition API NOT available - using MediaRecorder + Gemini");
    }
  }

  // Check if speech recognition is supported (MediaRecorder OR Web Speech API)
  isSpeechRecognitionSupported(): boolean {
    return typeof MediaRecorder !== 'undefined' || this.recognition !== null;
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

  // --- Speech To Text (using MediaRecorder + Gemini) ---

  listen(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      // Always prefer MediaRecorder + Gemini for Telegram WebView compatibility
      if (typeof MediaRecorder !== 'undefined') {
        try {
          const transcript = await this.listenWithGemini();
          resolve(transcript);
        } catch (error) {
          console.error("Gemini STT failed:", error);
          // Try fallback to Web Speech API if available
          if (this.recognition) {
            console.log("Falling back to Web Speech API");
            this.listenWithWebSpeech().then(resolve).catch(reject);
          } else {
            reject(error);
          }
        }
        return;
      }
      
      // Fallback to Web Speech API (for browsers that support it)
      if (this.recognition) {
        this.listenWithWebSpeech().then(resolve).catch(reject);
        return;
      }

      reject(new Error("No speech recognition method available"));
    });
  }

  // MediaRecorder + Gemini STT implementation
  private async listenWithGemini(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        // Use existing stream from startAudioAnalysis or create new one
        let stream = this.stream;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        this.audioChunks = [];
        this.isRecording = true;

        // Determine best supported MIME type
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
          ? 'audio/webm;codecs=opus' 
          : MediaRecorder.isTypeSupported('audio/webm') 
            ? 'audio/webm'
            : 'audio/mp4';

        console.log("MediaRecorder using MIME type:", mimeType);

        this.mediaRecorder = new MediaRecorder(stream, { mimeType });

        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data);
          }
        };

        this.mediaRecorder.onstop = async () => {
          this.isRecording = false;
          
          if (this.audioChunks.length === 0) {
            resolve("");
            return;
          }

          try {
            const audioBlob = new Blob(this.audioChunks, { type: mimeType });
            console.log("Audio recorded, size:", audioBlob.size, "bytes");
            
            // Convert to base64
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // Send to Gemini for transcription
            const transcript = await this.transcribeWithGemini(base64Audio, mimeType);
            resolve(transcript);
          } catch (error) {
            console.error("Transcription error:", error);
            resolve(""); // Return empty string on error instead of rejecting
          }
        };

        this.mediaRecorder.onerror = (event: any) => {
          console.error("MediaRecorder error:", event.error);
          this.isRecording = false;
          reject(event.error);
        };

        // Start recording
        this.mediaRecorder.start();
        console.log("Recording started...");

      } catch (error) {
        console.error("Failed to start recording:", error);
        reject(error);
      }
    });
  }

  // Transcribe audio using Gemini
  private async transcribeWithGemini(base64Audio: string, mimeType: string): Promise<string> {
    try {
      console.log("Sending audio to Gemini for transcription...");
      
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Audio
              }
            },
            {
              text: "Транскрибируй это аудио на русском языке. Верни ТОЛЬКО текст того, что было сказано, без пояснений. Если речь не распознана или аудио пустое, верни пустую строку."
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

  // Convert Blob to base64
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Web Speech API implementation (fallback)
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
    // Stop MediaRecorder if recording
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
        console.log("MediaRecorder stopped");
      } catch (e) {
        console.warn("Error stopping MediaRecorder", e);
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
