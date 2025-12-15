// OpenRouter API Service for STT (using gemini-2.5-flash)
// TTS uses Web Speech API (speechSynthesis) since OpenRouter doesn't support audio output

// Constants
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const STT_MODEL = "google/gemini-2.5-flash";

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

export class VoiceService {
  private recognition: any = null;
  private audioContext: AudioContext | null = null;
  
  // Microphone analysis
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  
  // Audio recording for STT
  private scriptProcessor: ScriptProcessorNode | null = null;
  private recordedSamples: Float32Array[] = [];
  private isRecording: boolean = false;
  private recordingResolve: ((transcript: string) => void) | null = null;
  
  // Permission cache
  private microphonePermissionGranted: boolean = false;

  // TTS (using Web Speech API)
  private synth: SpeechSynthesis | null = null;
  private preferredVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    console.log("VoiceService init (OpenRouter mode)");
    console.log("OpenRouter API Key present:", !!OPENROUTER_API_KEY, "Key length:", OPENROUTER_API_KEY.length);
    console.log("STT Model:", STT_MODEL);
    
    // Log available APIs
    console.log("AudioContext available:", typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined');
    
    // Initialize Web Speech Synthesis for TTS
    if ('speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      console.log("SpeechSynthesis (TTS) available");
      
      // Load voices
      this.loadVoices();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this.loadVoices();
      }
    } else {
      console.warn("SpeechSynthesis (TTS) NOT available");
    }
    
    // Check microphone permission status on init
    this.checkMicrophonePermission();
    
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
      console.log("SpeechRecognition API NOT available - using AudioContext + OpenRouter");
    }
  }

  // Load available voices for TTS
  private loadVoices(): void {
    if (!this.synth) return;
    
    const voices = this.synth.getVoices();
    console.log("Available TTS voices:", voices.length);
    
    // Prefer Russian voice
    this.preferredVoice = voices.find(v => v.lang.startsWith('ru')) || 
                          voices.find(v => v.lang.startsWith('en')) ||
                          voices[0] || null;
    
    if (this.preferredVoice) {
      console.log("Selected TTS voice:", this.preferredVoice.name, this.preferredVoice.lang);
    }
  }

  // Check microphone permission without prompting user
  private async checkMicrophonePermission(): Promise<void> {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        this.microphonePermissionGranted = result.state === 'granted';
        console.log("Microphone permission status:", result.state);
        
        result.onchange = () => {
          this.microphonePermissionGranted = result.state === 'granted';
          console.log("Microphone permission changed to:", result.state);
        };
      }
    } catch (e) {
      console.log("Permission API not available, will check on first use");
    }
  }

  // Request microphone access once and cache the stream
  async requestMicrophoneAccess(): Promise<MediaStream | null> {
    if (this.stream && this.stream.active) {
      console.log("Reusing existing microphone stream");
      return this.stream;
    }

    try {
      console.log("Requesting microphone access...");
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
      this.microphonePermissionGranted = true;
      console.log("Microphone access granted, stream cached");
      return this.stream;
    } catch (error) {
      console.error("Microphone access denied:", error);
      this.microphonePermissionGranted = false;
      return null;
    }
  }

  hasMicrophonePermission(): boolean {
    return this.microphonePermissionGranted || (this.stream !== null && this.stream.active);
  }

  isSpeechRecognitionSupported(): boolean {
    return typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined' || this.recognition !== null;
  }

  // --- Audio Context Management ---

  async prepareForSpeech(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.warn("AudioContext resume failed:", e);
      }
    }
  }

  // --- Microphone & Visualizer ---

  async startAudioAnalysis(): Promise<AnalyserNode | null> {
    try {
      await this.prepareForSpeech();
      
      if (!this.audioContext) {
        console.warn("AudioContext failed to initialize");
        return null;
      }
      
      const stream = await this.requestMicrophoneAccess();
      if (!stream) {
        console.warn("Could not get microphone stream");
        return null;
      }
      
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      
      this.microphone.connect(this.analyser);
      
      return this.analyser;
    } catch (error) {
      console.warn("Could not start audio analysis:", error);
      return null;
    }
  }

  stopAudioAnalysis() {
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }
    this.analyser = null;
  }

  releaseMicrophone() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      console.log("Microphone stream released");
    }
  }

  // --- Speech To Text (using AudioContext + OpenRouter) ---

  listen(): Promise<string> {
    const startTime = performance.now();
    console.log("🎤 [STT] listen() called at", new Date().toISOString());
    
    return new Promise(async (resolve, reject) => {
      // Try Web Speech API first if available
      if (this.recognition) {
        console.log("🎤 [STT] Trying Web Speech API first...");
        try {
          const webSpeechStart = performance.now();
          const transcript = await this.listenWithWebSpeech();
          const webSpeechTime = performance.now() - webSpeechStart;
          console.log(`🎤 [STT] Web Speech API completed in ${webSpeechTime.toFixed(0)}ms, result: "${transcript}"`);
          if (transcript) {
            const totalTime = performance.now() - startTime;
            console.log(`✅ [STT] Total listen() time: ${totalTime.toFixed(0)}ms`);
            resolve(transcript);
            return;
          }
          console.log("🎤 [STT] Web Speech API returned empty, falling back to OpenRouter");
        } catch (error) {
          console.warn("🎤 [STT] Web Speech API failed, trying OpenRouter STT:", error);
        }
      } else {
        console.log("🎤 [STT] Web Speech API not available, using OpenRouter directly");
      }
      
      // Fallback to AudioContext + OpenRouter STT
      try {
        console.log("🎤 [STT] Starting OpenRouter STT...");
        const orStart = performance.now();
        const transcript = await this.listenWithOpenRouter();
        const orTime = performance.now() - orStart;
        console.log(`🎤 [STT] OpenRouter STT setup completed in ${orTime.toFixed(0)}ms`);
        const totalTime = performance.now() - startTime;
        console.log(`✅ [STT] Total listen() time: ${totalTime.toFixed(0)}ms, result: "${transcript}"`);
        resolve(transcript);
      } catch (error) {
        console.error("❌ [STT] OpenRouter STT failed:", error);
        resolve("");
      }
    });
  }

  // AudioContext + OpenRouter STT implementation
  private async listenWithOpenRouter(): Promise<string> {
    console.log("🎙️ [OpenRouter STT] listenWithOpenRouter() started");
    const startTime = performance.now();
    
    return new Promise(async (resolve, reject) => {
      try {
        console.log("🎙️ [OpenRouter STT] Step 1: Preparing AudioContext...");
        const prepareStart = performance.now();
        await this.prepareForSpeech();
        console.log(`🎙️ [OpenRouter STT] AudioContext prepared in ${(performance.now() - prepareStart).toFixed(0)}ms`);
        
        if (!this.audioContext) {
          console.error("❌ [OpenRouter STT] AudioContext is null!");
          reject(new Error("AudioContext not available"));
          return;
        }
        console.log(`🎙️ [OpenRouter STT] AudioContext state: ${this.audioContext.state}, sampleRate: ${this.audioContext.sampleRate}`);

        console.log("🎙️ [OpenRouter STT] Step 2: Getting microphone stream...");
        const micStart = performance.now();
        const stream = await this.requestMicrophoneAccess();
        console.log(`🎙️ [OpenRouter STT] Microphone access took ${(performance.now() - micStart).toFixed(0)}ms`);
        
        if (!stream) {
          console.error("❌ [OpenRouter STT] No microphone stream!");
          reject(new Error("Microphone access not granted"));
          return;
        }
        console.log(`🎙️ [OpenRouter STT] Stream active: ${stream.active}, tracks: ${stream.getTracks().length}`);

        console.log("🎙️ [OpenRouter STT] Step 3: Creating audio nodes...");
        const source = this.audioContext.createMediaStreamSource(stream);
        
        const bufferSize = 4096;
        this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        this.recordedSamples = [];
        this.isRecording = true;
        this.recordingResolve = resolve;

        let sampleCount = 0;
        this.scriptProcessor.onaudioprocess = (e) => {
          if (this.isRecording) {
            const inputData = e.inputBuffer.getChannelData(0);
            this.recordedSamples.push(new Float32Array(inputData));
            sampleCount++;
            if (sampleCount % 10 === 0) {
              const duration = (this.recordedSamples.length * bufferSize / (this.audioContext?.sampleRate || 44100)).toFixed(1);
              console.log(`🎙️ [Recording] ${duration}s recorded (${this.recordedSamples.length} chunks)`);
            }
          }
        };

        source.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.audioContext.destination);
        
        const setupTime = performance.now() - startTime;
        console.log(`🎙️ [OpenRouter STT] Recording setup complete in ${setupTime.toFixed(0)}ms - NOW RECORDING...`);
        console.log("🎙️ [OpenRouter STT] Waiting for stopListening() to be called...");

      } catch (error) {
        console.error("❌ [OpenRouter STT] Failed to start recording:", error);
        reject(error);
      }
    });
  }

  // Process recorded audio and send to OpenRouter
  private async processRecordedAudio(): Promise<string> {
    const startTime = performance.now();
    console.log("📤 [Process] processRecordedAudio() started");
    
    if (this.recordedSamples.length === 0) {
      console.log("⚠️ [Process] No audio recorded (0 chunks)");
      return "";
    }

    try {
      console.log("📤 [Process] Step 1: Combining audio chunks...");
      const combineStart = performance.now();
      const totalLength = this.recordedSamples.reduce((acc, arr) => acc + arr.length, 0);
      const combinedSamples = new Float32Array(totalLength);
      
      let offset = 0;
      for (const samples of this.recordedSamples) {
        combinedSamples.set(samples, offset);
        offset += samples.length;
      }
      
      const sampleRate = this.audioContext?.sampleRate || 44100;
      const durationSec = totalLength / sampleRate;
      console.log(`📤 [Process] Combined ${this.recordedSamples.length} chunks in ${(performance.now() - combineStart).toFixed(0)}ms`);
      console.log(`📤 [Process] Audio: ${totalLength} samples, ${durationSec.toFixed(2)}s duration, ${sampleRate}Hz`);

      if (durationSec < 0.5) {
        console.log("⚠️ [Process] Audio too short (<0.5s), skipping transcription");
        return "";
      }

      console.log("📤 [Process] Step 2: Converting to WAV...");
      const wavStart = performance.now();
      const wavData = float32ToWav(combinedSamples, sampleRate);
      console.log(`📤 [Process] WAV conversion took ${(performance.now() - wavStart).toFixed(0)}ms, size: ${(wavData.length / 1024).toFixed(1)}KB`);

      console.log("📤 [Process] Step 3: Encoding to base64...");
      const encodeStart = performance.now();
      const base64Audio = encode(wavData);
      console.log(`📤 [Process] Base64 encoding took ${(performance.now() - encodeStart).toFixed(0)}ms, size: ${(base64Audio.length / 1024).toFixed(1)}KB`);

      console.log("📤 [Process] Step 4: Sending to OpenRouter API...");
      const result = await this.transcribeWithOpenRouter(base64Audio);
      
      const totalTime = performance.now() - startTime;
      console.log(`✅ [Process] Total processing time: ${totalTime.toFixed(0)}ms`);
      return result;
    } catch (error) {
      console.error("❌ [Process] Error processing recorded audio:", error);
      return "";
    }
  }

  // Transcribe audio using OpenRouter (expects WAV base64)
  private async transcribeWithOpenRouter(base64Audio: string): Promise<string> {
    const startTime = performance.now();
    console.log(`🤖 [OpenRouter API] transcribeWithOpenRouter() started, audio size: ${(base64Audio.length / 1024).toFixed(1)}KB`);
    
    try {
      console.log(`🤖 [OpenRouter API] Sending request to ${STT_MODEL}...`);
      const apiStart = performance.now();
      
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://voxlux.telegram.app',
          'X-Title': 'VoxLux Voice Assistant',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: STT_MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: {
                    data: base64Audio,
                    format: "wav"
                  }
                },
                {
                  type: "text",
                  text: "Транскрибируй это аудио. Верни ТОЛЬКО текст того, что было сказано на русском языке, без пояснений и комментариев. Если речь не распознана или аудио пустое, верни пустую строку."
                }
              ]
            }
          ]
        })
      });
      
      const apiTime = performance.now() - apiStart;
      console.log(`🤖 [OpenRouter API] Response received in ${apiTime.toFixed(0)}ms, status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [OpenRouter API] Error response:`, errorText);
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      console.log("🤖 [OpenRouter API] Response structure:", {
        hasChoices: !!data.choices,
        choicesCount: data.choices?.length || 0,
        model: data.model
      });

      const transcript = data.choices?.[0]?.message?.content?.trim() || "";
      const totalTime = performance.now() - startTime;
      console.log(`✅ [OpenRouter API] Transcription complete in ${totalTime.toFixed(0)}ms, result: "${transcript}"`);
      
      return transcript;
    } catch (error: any) {
      const errorTime = performance.now() - startTime;
      console.error(`❌ [OpenRouter API] Error after ${errorTime.toFixed(0)}ms:`, error);
      console.error("❌ [OpenRouter API] Error details:", {
        name: error?.name,
        message: error?.message
      });
      throw error;
    }
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
    const startTime = performance.now();
    console.log("⏹️ [Stop] stopListening() called");
    
    // Stop AudioContext recording
    if (this.scriptProcessor && this.isRecording) {
      this.isRecording = false;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
      
      const chunksRecorded = this.recordedSamples.length;
      const sampleRate = this.audioContext?.sampleRate || 44100;
      const durationSec = chunksRecorded > 0 
        ? (this.recordedSamples.reduce((acc, arr) => acc + arr.length, 0) / sampleRate).toFixed(2) 
        : "0";
      console.log(`⏹️ [Stop] Recording stopped: ${chunksRecorded} chunks, ~${durationSec}s audio`);
      
      // Process the recorded audio
      if (this.recordingResolve) {
        console.log("⏹️ [Stop] Starting audio processing...");
        const processStart = performance.now();
        this.processRecordedAudio().then((transcript) => {
          const processTime = performance.now() - processStart;
          console.log(`⏹️ [Stop] Audio processing completed in ${processTime.toFixed(0)}ms`);
          if (this.recordingResolve) {
            this.recordingResolve(transcript);
            this.recordingResolve = null;
          }
          const totalTime = performance.now() - startTime;
          console.log(`✅ [Stop] Total stopListening() time: ${totalTime.toFixed(0)}ms`);
        }).catch((error) => {
          console.error("❌ [Stop] Audio processing failed:", error);
          if (this.recordingResolve) {
            this.recordingResolve("");
            this.recordingResolve = null;
          }
        });
      } else {
        console.log("⚠️ [Stop] No recordingResolve callback set!");
      }
    } else {
      console.log("⚠️ [Stop] Not recording (scriptProcessor:", !!this.scriptProcessor, "isRecording:", this.isRecording, ")");
    }
    
    // Stop Web Speech API if active
    if (this.recognition) {
      try {
        console.log("⏹️ [Stop] Stopping Web Speech API...");
        this.recognition.stop();
      } catch (e) {
        console.warn("⚠️ [Stop] Error stopping recognition:", e);
      }
    }
  }

  // --- Text To Speech (using Web Speech API) ---

  async speak(text: string): Promise<void> {
    if (!text) return;

    // Use Web Speech API (speechSynthesis)
    if (!this.synth) {
      console.warn("SpeechSynthesis not available");
      return;
    }

    return new Promise((resolve) => {
      // Cancel any ongoing speech
      this.synth!.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ru-RU';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      
      if (this.preferredVoice) {
        utterance.voice = this.preferredVoice;
      }
      
      utterance.onend = () => {
        console.log("TTS finished");
        resolve();
      };
      
      utterance.onerror = (e) => {
        console.error("TTS error:", e);
        resolve();
      };
      
      console.log("Starting TTS...");
      this.synth!.speak(utterance);
    });
  }
}

export const voiceService = new VoiceService();
