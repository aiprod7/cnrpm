import { GoogleGenAI, Modality } from "@google/genai";
import { GeminiLiveService } from "./geminiLiveService";
import { LiveTranscriptionService } from "./liveTranscriptionService";
import { microphoneManager } from "./microphoneManager";

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
  
  // Audio recording for Gemini STT (Legacy batch mode)
  private scriptProcessor: ScriptProcessorNode | null = null;
  private recordedSamples: Float32Array[] = [];
  private isRecording: boolean = false;
  private recordingResolve: ((transcript: string) => void) | null = null;
  
  // Gemini Live API (Real-time streaming)
  private liveService: GeminiLiveService | null = null;
  private liveTranscriptionService: LiveTranscriptionService | null = null;
  private useLiveAPI: boolean = true; // ENABLED: Using native-audio-preview model with SDK live.connect()
  private liveTranscript: string = "";
  private liveTranscriptResolve: ((transcript: string) => void) | null = null;

  constructor() {
    // Initialize Google GenAI
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.DEFAULT_GEMINI_API_KEY || '';
    console.log("VoiceService init, API Key present:", !!apiKey, "Key length:", apiKey.length);
    this.ai = new GoogleGenAI({ apiKey });
    
    // Initialize Gemini Live Transcription API (native-audio-preview model with SDK)
    if (this.useLiveAPI && apiKey) {
      console.log("🚀 [VoiceService] Initializing Gemini Live Transcription Service...");
      this.liveTranscriptionService = new LiveTranscriptionService(apiKey);
      console.log("✅ [VoiceService] Live Transcription Service ready");
    }
    
    // Keep legacy GeminiLiveService for TTS if needed
    // (LiveTranscriptionService is focused on STT only)
    
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

  /**
   * Setup callbacks for Gemini Live API
   */
  private setupLiveAPICallbacks(): void {
    if (!this.liveService) return;

    this.liveService.onTranscript((text) => {
      console.log("📝 [Live API] Real-time transcript:", text);
      this.liveTranscript += text + " ";
      
      // Call external callback for UI updates
      if (this.onRealtimeTranscriptCallback) {
        this.onRealtimeTranscriptCallback(this.liveTranscript.trim());
      }
    });

    this.liveService.onError((error) => {
      console.error("❌ [Live API] Error:", error);
    });

    this.liveService.onConnected(() => {
      console.log("✅ [Live API] Connected and ready");
    });

    this.liveService.onDisconnected(() => {
      console.log("🔌 [Live API] Disconnected");
    });
  }
  
  // Callback for real-time transcript updates
  private onRealtimeTranscriptCallback?: (transcript: string) => void;
  
  setOnRealtimeTranscript(callback: (transcript: string) => void): void {
    this.onRealtimeTranscriptCallback = callback;
  }

  /**
   * Request microphone access using MicrophoneManager (cached permission)
   * This prevents repeated permission dialogs in Telegram Mini App
   */
  async requestMicrophoneAccess(): Promise<MediaStream | null> {
    // Check if MicrophoneManager already has permission cached
    if (!microphoneManager.isReady()) {
      console.log("🎤 [VoiceService] No cached permission, initializing MicrophoneManager...");
      const granted = await microphoneManager.initialize();
      
      if (!granted) {
        console.error("❌ [VoiceService] Microphone permission denied");
        console.log("💡 Instructions:", microphoneManager.getPermissionInstructions());
        return null;
      }
    }

    // If we already have an active stream, return it
    if (this.stream && this.stream.active) {
      console.log("✅ [VoiceService] Reusing existing microphone stream");
      return this.stream;
    }

    try {
      console.log("🎤 [VoiceService] Requesting microphone stream...");
      
      // Request microphone stream (permission already cached by MicrophoneManager)
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        }
      });
      
      console.log("✅ [VoiceService] Microphone stream created");
      return this.stream;
    } catch (error: any) {
      console.error("❌ [VoiceService] Microphone stream error:", error);
      console.error("Error details:", {
        name: error?.name,
        message: error?.message,
        constraint: error?.constraint
      });
      
      // Specific error handling
      if (error.name === 'NotReadableError') {
        console.error("❌ NotReadableError: Microphone is already in use or hardware issue");
        console.error("💡 This often happens in Telegram Mini Apps - try using text input instead");
      } else if (error.name === 'NotAllowedError') {
        console.error("❌ NotAllowedError: User denied microphone permission");
        console.error("💡 Instructions:", microphoneManager.getPermissionInstructions());
      } else if (error.name === 'NotFoundError') {
        console.error("❌ NotFoundError: No microphone device found");
      } else if (error.name === 'OverconstrainedError') {
        console.error("❌ OverconstrainedError: Microphone constraints not supported");
        // Try again with no constraints
        try {
          console.log("🔄 Retrying with basic audio constraints...");
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.microphonePermissionGranted = true;
          console.log("✅ Microphone access granted on retry");
          return this.stream;
        } catch (retryError) {
          console.error("❌ Retry failed:", retryError);
        }
      }
      
      this.microphonePermissionGranted = false;
      return null;
    }
  }

  // Check if we have microphone permission (without prompting)
  hasMicrophonePermission(): boolean {
    return this.microphonePermissionGranted || (this.stream !== null && this.stream.active);
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
      
      // Use cached stream or request new one
      const stream = await this.requestMicrophoneAccess();
      if (!stream) {
        console.warn("Could not get microphone stream");
        return null;
      }
      
      this.microphone = this.audioContext.createMediaStreamSource(stream);
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
    // Don't stop the stream - keep it cached for reuse
    // This prevents repeated permission prompts
    if (this.microphone) {
        this.microphone.disconnect();
        this.microphone = null;
    }
    // We do NOT close audioContext here because we might need it for TTS immediately after
    this.analyser = null;
  }

  // Call this when the app is closing or user explicitly wants to release mic
  releaseMicrophone() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      console.log("Microphone stream released");
    }
  }

  // --- Speech To Text (using AudioContext + Gemini) ---

  listen(): Promise<string> {
    const startTime = performance.now();
    console.log("🎤 [STT] listen() called at", new Date().toISOString());
    
    return new Promise(async (resolve, reject) => {
      // Use Gemini Live API if enabled (real-time streaming)
      if (this.useLiveAPI && this.liveService) {
        console.log("🎤 [STT] Using Live API (model: gemini-2.5-flash-native-audio-preview-12-2025)");
        try {
          const transcript = await this.listenWithLiveAPI();
          const totalTime = performance.now() - startTime;
          console.log(`✅ [STT] Live API completed in ${totalTime.toFixed(0)}ms, result: "${transcript}"`);
          resolve(transcript);
          return;
        } catch (error) {
          console.error("❌ [STT] Live API failed, falling back to batch mode:", error);
          // Fall through to batch mode
        }
      }
      
      // Try Web Speech API first if available (more reliable when it works)
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
          console.log("🎤 [STT] Web Speech API returned empty, falling back to Gemini");
        } catch (error) {
          console.warn("🎤 [STT] Web Speech API failed, trying Gemini STT:", error);
        }
      } else {
        console.log("🎤 [STT] Web Speech API not available, using Gemini directly");
      }
      
      // Fallback to AudioContext + Gemini STT (batch mode)
      try {
        console.log("🎤 [STT] Starting Gemini STT (batch mode, model: gemini-2.5-flash)...");
        const geminiStart = performance.now();
        const geminiTranscript = await this.listenWithGemini();
        const geminiTime = performance.now() - geminiStart;
        console.log(`🎤 [STT] Gemini STT (gemini-2.5-flash) setup completed in ${geminiTime.toFixed(0)}ms`);
        const totalTime = performance.now() - startTime;
        console.log(`✅ [STT] Total listen() time: ${totalTime.toFixed(0)}ms, result: "${geminiTranscript}"`);
        resolve(geminiTranscript);
      } catch (error) {
        console.error("❌ [STT] Gemini STT failed:", error);
        resolve(""); // Return empty string on error
      }
    });
  }

  /**
   * Listen using Gemini Live Transcription API (native-audio-preview model with SDK)
   * Uses live.connect() for minimal latency streaming transcription
   */
  private async listenWithLiveAPI(): Promise<string> {
    console.log("🔴 [Live Transcription] Starting real-time streaming...");
    
    return new Promise(async (resolve, reject) => {
      if (!this.liveTranscriptionService) {
        console.error("❌ [Live Transcription] Service not initialized");
        reject(new Error("Live Transcription Service not initialized"));
        return;
      }

      try {
        // Reset transcript
        this.liveTranscript = "";
        this.liveTranscriptResolve = resolve;

        // Start live transcription session
        await this.liveTranscriptionService.start({
          onTranscriptUpdate: (text: string) => {
            console.log("📝 [Live Transcription] Update:", text);
            this.liveTranscript = text;
            
            // Call external callback for UI updates
            if (this.onRealtimeTranscriptCallback) {
              this.onRealtimeTranscriptCallback(text);
            }
          },
          
          onTranscriptComplete: (text: string) => {
            console.log("✅ [Live Transcription] Complete:", this.liveTranscript);
            // Don't resolve here - wait for stopListening() call
          },
          
          onError: (error: Error) => {
            console.error("❌ [Live Transcription] Error:", error);
            // Don't reject immediately - let fallback handle it
          },
          
          onClose: () => {
            console.log("🔌 [Live Transcription] Session closed");
            // Resolve with current transcript if we have one
            if (this.liveTranscriptResolve) {
              this.liveTranscriptResolve(this.liveTranscript.trim());
              this.liveTranscriptResolve = null;
            }
          },
          
          onConnected: () => {
            console.log("✅ [Live Transcription] Connected - speak now!");
          }
        });
        
        console.log("✅ [Live Transcription] Streaming started - speak now!");
        console.log("⏰ [Live Transcription] Will auto-stop after 15 seconds of streaming");
        
        // Auto-stop after 15 seconds (longer than batch mode for continuous speech)
        setTimeout(() => {
          if (this.liveTranscriptionService?.isActive()) {
            console.log("⏰ [Live Transcription] Auto-stopping after 15 seconds");
            this.stopListening();
          }
        }, 15000); // 15 seconds max recording time
        
        // NOTE: Promise will resolve when stopListening() is called
        // Either by user clicking stop button or by auto-timeout above
        
      } catch (error) {
        console.error("❌ [Live Transcription] Failed to start:", error);
        reject(error);
      }
    });
  }

  // AudioContext + Gemini STT implementation (records WAV)
  private async listenWithGemini(): Promise<string> {
    console.log("🎙️ [Gemini STT] listenWithGemini() started");
    const startTime = performance.now();
    
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure AudioContext exists
        console.log("🎙️ [Gemini STT] Step 1: Preparing AudioContext...");
        const prepareStart = performance.now();
        await this.prepareForSpeech();
        console.log(`🎙️ [Gemini STT] AudioContext prepared in ${(performance.now() - prepareStart).toFixed(0)}ms`);
        
        if (!this.audioContext) {
          console.error("❌ [Gemini STT] AudioContext is null!");
          reject(new Error("AudioContext not available"));
          return;
        }
        console.log(`🎙️ [Gemini STT] AudioContext state: ${this.audioContext.state}, sampleRate: ${this.audioContext.sampleRate}`);

        // Use cached stream to avoid repeated permission prompts
        console.log("🎙️ [Gemini STT] Step 2: Getting microphone stream...");
        const micStart = performance.now();
        const stream = await this.requestMicrophoneAccess();
        console.log(`🎙️ [Gemini STT] Microphone access took ${(performance.now() - micStart).toFixed(0)}ms`);
        
        if (!stream) {
          console.error("❌ [Gemini STT] No microphone stream!");
          reject(new Error("Microphone access not granted"));
          return;
        }
        console.log(`🎙️ [Gemini STT] Stream active: ${stream.active}, tracks: ${stream.getTracks().length}`);

        // Create audio source from microphone
        console.log("🎙️ [Gemini STT] Step 3: Creating audio nodes...");
        const source = this.audioContext.createMediaStreamSource(stream);
        
        // Create script processor to capture raw PCM
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
            // Log every 10 chunks (~1 second at 4096 buffer)
            if (sampleCount % 10 === 0) {
              const duration = (this.recordedSamples.length * bufferSize / (this.audioContext?.sampleRate || 44100)).toFixed(1);
              console.log(`🎙️ [Recording] ${duration}s recorded (${this.recordedSamples.length} chunks)`);
            }
          }
        };

        // Connect: source -> scriptProcessor -> destination
        source.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.audioContext.destination);
        
        const setupTime = performance.now() - startTime;
        console.log(`🎙️ [Gemini STT] Recording setup complete in ${setupTime.toFixed(0)}ms - NOW RECORDING...`);
        console.log("🎙️ [Gemini STT] Will auto-stop after 10 seconds...");
        
        // Auto-stop recording after 10 seconds
        setTimeout(() => {
          if (this.isRecording) {
            console.log("⏰ [Gemini STT] Auto-stopping after 10 seconds");
            this.stopListening();
          }
        }, 10000);

      } catch (error) {
        console.error("❌ [Gemini STT] Failed to start recording:", error);
        reject(error);
      }
    });
  }

  // Process recorded audio and send to Gemini
  private async processRecordedAudio(): Promise<string> {
    const startTime = performance.now();
    console.log("📤 [Process] processRecordedAudio() started");
    
    if (this.recordedSamples.length === 0) {
      console.log("⚠️ [Process] No audio recorded (0 chunks)");
      return "";
    }

    try {
      // Combine all samples into one Float32Array
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

      // Check if audio is too short (minimum 1.5 seconds for reliable transcription)
      if (durationSec < 1.5) {
        console.log(`⚠️ [Process] Audio too short (${durationSec.toFixed(2)}s < 1.5s), skipping transcription`);
        console.log("💡 [Process] Please speak for at least 1.5 seconds for accurate recognition");
        return "";
      }

      // Convert to WAV format
      console.log("📤 [Process] Step 2: Converting to WAV...");
      const wavStart = performance.now();
      const wavData = float32ToWav(combinedSamples, sampleRate);
      console.log(`📤 [Process] WAV conversion took ${(performance.now() - wavStart).toFixed(0)}ms, size: ${(wavData.length / 1024).toFixed(1)}KB`);

      // Convert to base64
      console.log("📤 [Process] Step 3: Encoding to base64...");
      const encodeStart = performance.now();
      const base64Audio = encode(wavData);
      console.log(`📤 [Process] Base64 encoding took ${(performance.now() - encodeStart).toFixed(0)}ms, size: ${(base64Audio.length / 1024).toFixed(1)}KB`);

      // Send to Gemini for transcription
      console.log("📤 [Process] Step 4: Sending to Gemini API...");
      const result = await this.transcribeWithGemini(base64Audio);
      
      const totalTime = performance.now() - startTime;
      console.log(`✅ [Process] Total processing time: ${totalTime.toFixed(0)}ms`);
      return result;
    } catch (error) {
      console.error("❌ [Process] Error processing recorded audio:", error);
      return "";
    }
  }

  // Transcribe audio using Gemini (expects WAV base64)
  private async transcribeWithGemini(base64Audio: string): Promise<string> {
    const startTime = performance.now();
    console.log(`🤖 [Gemini API] transcribeWithGemini() started, audio size: ${(base64Audio.length / 1024).toFixed(1)}KB`);
    
    try {
      console.log("🤖 [Gemini API] Sending transcription request (model: gemini-2.5-flash)...");
      const apiStart = performance.now();
      
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
      
      const apiTime = performance.now() - apiStart;
      console.log(`🤖 [Gemini API] Response received in ${apiTime.toFixed(0)}ms`);
      
      // Log response details
      console.log("🤖 [Gemini API] Response structure:", {
        hasCandidates: !!response.candidates,
        candidatesCount: response.candidates?.length || 0,
        hasContent: !!response.candidates?.[0]?.content,
        partsCount: response.candidates?.[0]?.content?.parts?.length || 0
      });

      const transcript = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      const totalTime = performance.now() - startTime;
      console.log(`✅ [Gemini API] Transcription complete in ${totalTime.toFixed(0)}ms, result: "${transcript}"`);
      
      return transcript;
    } catch (error: any) {
      const errorTime = performance.now() - startTime;
      console.error(`❌ [Gemini API] Error after ${errorTime.toFixed(0)}ms:`, error);
      console.error("❌ [Gemini API] Error details:", {
        name: error?.name,
        message: error?.message,
        status: error?.status,
        statusText: error?.statusText,
        code: error?.code
      });
      
      // User-friendly error messages
      if (error?.message?.includes('API_KEY')) {
        console.error("❌ API Key error: Please check DEFAULT_GEMINI_API_KEY is set correctly");
      } else if (error?.status === 429 || error?.code === 429) {
        console.error("❌ Rate limit exceeded: Too many requests to Gemini API");
      } else if (error?.status === 403 || error?.code === 403) {
        console.error("❌ Permission denied: Check API key permissions and quotas");
      }
      
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
    const startTime = performance.now();
    console.log("⏹️ [Stop] stopListening() called");
    
    // Stop Live Transcription Service if active (SDK live.connect())
    if (this.useLiveAPI && this.liveTranscriptionService?.isActive()) {
      console.log("⏹️ [Stop] Stopping Live Transcription Service...");
      
      this.liveTranscriptionService.stop().then((finalTranscript) => {
        console.log(`✅ [Stop] Live Transcription stopped, transcript: "${finalTranscript}"`);
        
        // Return accumulated transcript via promise resolver
        if (this.liveTranscriptResolve) {
          this.liveTranscriptResolve(finalTranscript);
          this.liveTranscriptResolve = null;
          this.liveTranscript = "";
        }
        
        // Clear UI real-time display
        if (this.onRealtimeTranscriptCallback) {
          this.onRealtimeTranscriptCallback("");
        }
        
        const totalTime = performance.now() - startTime;
        console.log(`✅ [Stop] Total stopListening() time: ${totalTime.toFixed(0)}ms`);
      }).catch((error) => {
        console.error("❌ [Stop] Error stopping Live Transcription:", error);
        if (this.liveTranscriptResolve) {
          this.liveTranscriptResolve(this.liveTranscript.trim() || "");
          this.liveTranscriptResolve = null;
        }
      });
      return;
    }
    
    // Fallback: Stop legacy Live API streaming if active
    if (this.liveService?.isCurrentlyStreaming()) {
      console.log("⏹️ [Stop] Stopping legacy Live API streaming...");
      this.liveService.stopStreaming();
      
      if (this.liveTranscriptResolve) {
        const finalTranscript = this.liveTranscript.trim();
        console.log(`✅ [Stop] Legacy Live API transcript: "${finalTranscript}"`);
        this.liveTranscriptResolve(finalTranscript);
        this.liveTranscriptResolve = null;
        this.liveTranscript = "";
        
        if (this.onRealtimeTranscriptCallback) {
          this.onRealtimeTranscriptCallback("");
        }
      }
      return;
    }
    
    // Stop AudioContext recording (batch mode)
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

  // --- Text To Speech (Web Speech API - браузерный синтез) ---

  async speak(text: string): Promise<void> {
    if (!text) return;

    console.log("🔊 [TTS] Синтез речи через Web Speech API...");
    
    return new Promise((resolve, reject) => {
      // Check if Web Speech API is supported
      if (!('speechSynthesis' in window)) {
        console.warn("⚠️ [TTS] Web Speech API не поддерживается в этом браузере");
        resolve();
        return;
      }

      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      
      // Configure voice settings for Russian
      utterance.lang = 'ru-RU';
      utterance.rate = 1.0;  // Normal speed
      utterance.pitch = 1.0; // Normal pitch
      utterance.volume = 1.0; // Full volume

      // Try to find a Russian voice
      const voices = window.speechSynthesis.getVoices();
      const russianVoice = voices.find(v => v.lang.startsWith('ru')) || 
                          voices.find(v => v.lang === 'ru-RU') ||
                          voices[0]; // Fallback to first available
      
      if (russianVoice) {
        utterance.voice = russianVoice;
        console.log(`🔊 [TTS] Используется голос: ${russianVoice.name} (${russianVoice.lang})`);
      }

      utterance.onend = () => {
        console.log("✅ [TTS] Завершено");
        resolve();
      };

      utterance.onerror = (event) => {
        console.error("❌ [TTS] Ошибка:", event.error);
        resolve(); // Don't reject, just continue
      };

      // Start speaking
      window.speechSynthesis.speak(utterance);
    });
  }
}

export const voiceService = new VoiceService();
(window as any).voiceService = voiceService;
