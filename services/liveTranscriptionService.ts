/**
 * Live Transcription Service
 * Uses Gemini Live API with native audio model for real-time speech-to-text
 * 
 * Model: gemini-2.5-flash-native-audio-preview (latest version)
 * Method: SDK live.connect() for minimal latency streaming
 * 
 * Documentation: https://ai.google.dev/gemini-api/docs/live
 */

import { GoogleGenAI, Modality } from "@google/genai";
import { microphoneManager } from "./microphoneManager";

// Type definitions for Live API (SDK types may be incomplete)
interface LiveServerMessage {
  setupComplete?: object;
  serverContent?: {
    inputTranscription?: {
      text?: string;
    };
    outputTranscription?: {
      text?: string;
    };
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
      }>;
    };
    turnComplete?: boolean;
    interrupted?: boolean;
    generationComplete?: boolean;
  };
  toolCall?: object;
  goAway?: {
    timeLeft?: string;
  };
}

// Callbacks interface for UI updates
interface TranscriptionCallbacks {
  onTranscriptUpdate: (text: string) => void;    // Called when transcript chunk arrives
  onTranscriptComplete: (text: string) => void;  // Called when phrase is complete
  onError: (error: Error) => void;
  onClose: () => void;
  onConnected?: () => void;
}

export class LiveTranscriptionService {
  private client: GoogleGenAI;
  private session: any = null;
  private sessionPromise: Promise<any> | null = null;
  
  // Audio context for microphone capture
  private inputAudioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;
  
  // State
  private isStreaming: boolean = false;
  private currentTranscript: string = "";
  
  // Model configuration
  // Use the December 2025 native audio preview model for best transcription quality
  private readonly MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
  private readonly SAMPLE_RATE = 16000; // Required by Live API

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
    console.log("🎙️ [LiveTranscription] Service initialized with model:", this.MODEL);
  }

  /**
   * Start transcription session
   * Connects to Gemini Live API and begins streaming audio from microphone
   */
  async start(callbacks: TranscriptionCallbacks): Promise<void> {
    console.log(`🚀 [LiveTranscription] Starting session with ${this.MODEL}...`);
    
    // Check if MicrophoneManager has cached permission
    if (!microphoneManager.isReady()) {
      console.log("🎤 [LiveTranscription] Initializing microphone permission...");
      const granted = await microphoneManager.initialize();
      if (!granted) {
        const error = new Error("Microphone permission denied");
        callbacks.onError(error);
        throw error;
      }
    }

    try {
      // 1. Initialize AudioContext with required sample rate (16kHz)
      console.log("🔊 [LiveTranscription] Creating AudioContext at 16kHz...");
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
        sampleRate: this.SAMPLE_RATE 
      });

      // 2. Get microphone access through MicrophoneManager
      console.log("🎤 [LiveTranscription] Getting audio stream from MicrophoneManager...");
      this.mediaStream = await microphoneManager.getAudioStream({
        sampleRate: this.SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      });
      
      if (!this.mediaStream) {
        throw new Error('Failed to get audio stream from MicrophoneManager');
      }
      
      console.log("✅ [LiveTranscription] Audio stream obtained from cache (no permission dialog)");

      // 3. Connect to Gemini Live API using SDK
      console.log("🔌 [LiveTranscription] Connecting to Gemini Live API...");
      this.sessionPromise = this.client.live.connect({
        // Native audio model for transcription
        model: this.MODEL,
        
        // Session configuration
        config: {
          // Response modalities - SDK requires this even for transcription
          responseModalities: [Modality.AUDIO],
          
          // CRITICAL: Enable input audio transcription
          // This is the key setting that returns text from user's speech
          inputAudioTranscription: {},
          
          // System instruction - tell model to focus on listening
          systemInstruction: {
            parts: [{
              text: "Ты транскрибируешь речь пользователя на русском языке. Слушай внимательно и точно передавай сказанное."
            }]
          },
          
          // Speech config for Russian voice (if model responds)
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore" // Russian-optimized voice
              }
            }
          }
        },

        // Callbacks for Live API events
        callbacks: {
          onopen: () => {
            console.log(`✅ [LiveTranscription] Connected to ${this.MODEL}`);
            this.isStreaming = true;
            
            // Start streaming audio to the API
            this.startAudioStreaming();
            
            if (callbacks.onConnected) {
              callbacks.onConnected();
            }
          },
          
          onmessage: (message: LiveServerMessage) => {
            this.handleServerMessage(message, callbacks);
          },
          
          onclose: (event: any) => {
            console.log("🔌 [LiveTranscription] Connection closed", event);
            this.stopAudioStreaming();
            this.isStreaming = false;
            callbacks.onClose();
          },
          
          onerror: (error: any) => {
            console.error("❌ [LiveTranscription] Error:", error);
            callbacks.onError(new Error(error?.message || "Live API error"));
          }
        }
      });

      // Wait for connection to establish
      this.session = await this.sessionPromise;
      console.log(`✅ [LiveTranscription] Session ready (model: ${this.MODEL})`);

    } catch (error: any) {
      console.error("❌ [LiveTranscription] Failed to start:", error);
      this.cleanup();
      callbacks.onError(error);
      throw error;
    }
  }

  /**
   * Stop transcription session
   */
  async stop(): Promise<string> {
    console.log("⏹️ [LiveTranscription] Stopping session...");
    
    this.stopAudioStreaming();
    
    // Close the session
    if (this.session) {
      try {
        await this.session.close();
      } catch (e) {
        console.warn("⚠️ [LiveTranscription] Error closing session:", e);
      }
      this.session = null;
    }
    
    this.sessionPromise = null;
    
    // Cleanup audio context
    if (this.inputAudioContext) {
      try {
        await this.inputAudioContext.close();
      } catch (e) {
        console.warn("⚠️ [LiveTranscription] Error closing AudioContext:", e);
      }
      this.inputAudioContext = null;
    }
    
    // Release media stream reference (but don't stop tracks - MicrophoneManager owns them)
    // Stopping tracks here would break the cached stream for subsequent recordings
    this.mediaStream = null;
    
    this.isStreaming = false;
    
    const finalTranscript = this.currentTranscript.trim();
    console.log("✅ [LiveTranscription] Session stopped. Final transcript:", finalTranscript);
    
    // Reset transcript for next session
    const result = this.currentTranscript;
    this.currentTranscript = "";
    
    return result;
  }

  /**
   * Start streaming audio from microphone to Live API
   */
  private startAudioStreaming(): void {
    if (!this.inputAudioContext || !this.mediaStream) {
      console.error("❌ [LiveTranscription] Cannot start streaming - no audio context or stream");
      return;
    }

    console.log("🎤 [LiveTranscription] Starting audio streaming...");

    // Create source from microphone stream
    this.inputSource = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
    
    // Create script processor for real-time audio processing
    // Buffer size 4096 provides good balance between latency and performance
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      if (!this.isStreaming || !this.sessionPromise) return;

      // Get raw audio data (Float32) from first channel
      const inputData = event.inputBuffer.getChannelData(0);
      
      // Convert to PCM16 Base64 format required by Gemini
      const pcmBase64 = this.convertFloat32ToPCM16Base64(inputData);

      // Send audio chunk to Live API
      this.sessionPromise.then(session => {
        if (session && this.isStreaming) {
          session.sendRealtimeInput({ 
            media: {
              mimeType: `audio/pcm;rate=${this.SAMPLE_RATE}`,
              data: pcmBase64
            }
          });
        }
      }).catch(err => {
        console.error("❌ [LiveTranscription] Error sending audio:", err);
      });
    };

    // Connect audio nodes
    this.inputSource.connect(this.processor);
    // Processor must be connected to destination for onaudioprocess to fire
    this.processor.connect(this.inputAudioContext.destination);
    
    console.log("✅ [LiveTranscription] Audio streaming started");
  }

  /**
   * Stop audio streaming
   */
  private stopAudioStreaming(): void {
    console.log("⏹️ [LiveTranscription] Stopping audio streaming...");
    
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    
    console.log("✅ [LiveTranscription] Audio streaming stopped");
  }

  /**
   * Handle incoming messages from Live API server
   */
  private handleServerMessage(message: LiveServerMessage, callbacks: TranscriptionCallbacks): void {
    // Debug: log message structure
    console.log("📨 [LiveTranscription] Message keys:", Object.keys(message));

    // Setup complete
    if (message.setupComplete) {
      console.log("✅ [LiveTranscription] Setup complete");
      return;
    }

    const content = message.serverContent;
    if (!content) return;

    // Debug: log serverContent structure
    console.log("📦 [LiveTranscription] serverContent keys:", Object.keys(content));

    // CRITICAL: Check for INPUT transcription (user's speech → text)
    if (content.inputTranscription?.text) {
      const text = content.inputTranscription.text;
      console.log("🎤 [LiveTranscription] ✅ Input transcription:", text);
      
      // Accumulate transcript
      this.currentTranscript += text;
      
      // Notify UI about transcript update
      callbacks.onTranscriptUpdate(this.currentTranscript);
    }

    // Check for OUTPUT transcription (model's response → text)
    if (content.outputTranscription?.text) {
      console.log("🤖 [LiveTranscription] Output transcription:", content.outputTranscription.text);
    }

    // Handle model turn (if model responds with text/audio)
    if (content.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.text) {
          console.log("📝 [LiveTranscription] Model text:", part.text);
        }
        if (part.inlineData) {
          console.log("🔊 [LiveTranscription] Model audio received");
        }
      }
    }

    // Turn complete - phrase finished
    if (content.turnComplete) {
      console.log("✅ [LiveTranscription] Turn complete");
      callbacks.onTranscriptComplete(this.currentTranscript);
    }

    // Interrupted (user spoke while model was responding)
    if (content.interrupted) {
      console.log("⏸️ [LiveTranscription] Interrupted");
    }

    // Generation complete
    if (content.generationComplete) {
      console.log("✅ [LiveTranscription] Generation complete");
    }

    // GoAway - connection will close soon
    if (message.goAway) {
      console.warn("⚠️ [LiveTranscription] GoAway received, connection closing in:", message.goAway.timeLeft);
    }
  }

  /**
   * Convert Float32 audio to PCM16 Base64
   * Web Audio API uses Float32 (-1.0 to 1.0), Gemini expects Int16 PCM
   */
  private convertFloat32ToPCM16Base64(float32Array: Float32Array): string {
    const len = float32Array.length;
    const int16Array = new Int16Array(len);

    for (let i = 0; i < len; i++) {
      // Clamp and convert to 16-bit integer
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Convert to Base64
    const uint8Array = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }

    return btoa(binary);
  }

  /**
   * Cleanup all resources
   */
  private cleanup(): void {
    this.stopAudioStreaming();
    
    if (this.inputAudioContext) {
      this.inputAudioContext.close().catch(() => {});
      this.inputAudioContext = null;
    }
    
    // Release media stream reference (but don't stop tracks - MicrophoneManager owns them)
    this.mediaStream = null;
    
    this.session = null;
    this.sessionPromise = null;
    this.isStreaming = false;
  }

  // ==================== Getters ====================

  isActive(): boolean {
    return this.isStreaming;
  }

  getCurrentTranscript(): string {
    return this.currentTranscript;
  }
}

// Singleton instance
let liveTranscriptionInstance: LiveTranscriptionService | null = null;

export function getLiveTranscriptionService(apiKey?: string): LiveTranscriptionService {
  if (!liveTranscriptionInstance && apiKey) {
    liveTranscriptionInstance = new LiveTranscriptionService(apiKey);
  }
  if (!liveTranscriptionInstance) {
    throw new Error("LiveTranscriptionService not initialized - provide API key");
  }
  return liveTranscriptionInstance;
}

export default LiveTranscriptionService;
