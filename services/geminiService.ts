import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";

/**
 * Unified Gemini Live Service - Single Model for STT + TTS
 * 
 * Architecture: One WebSocket connection handles both speech-to-text and text-to-speech
 * Model: gemini-2.5-flash-native-audio-preview-12-2025
 * 
 * Flow:
 * 1. User speaks → Stream microphone PCM (16kHz) → Model transcribes (STT) via inputAudioTranscription
 * 2. Model generates response → Returns audio stream (TTS 24kHz) + text captions
 * 3. Play audio response through speakers with seamless buffering
 * 
 * Key Features:
 * - Real-time STT: User sees their words as they speak
 * - Real-time TTS: Model's audio response plays immediately
 * - Interruption support: Can stop model mid-speech
 * - Single connection: No need to switch between STT/TTS models
 */

// Callback interface for UI updates
export interface LiveConfig {
  onTranscriptUpdate: (text: string, isUser: boolean, isFinal: boolean) => void;
  onClose: () => void;
  onError: (err: Error) => void;
}

export class GeminiLiveService {
  private client: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private session: any = null;
  
  // Audio Contexts
  // Input: 16kHz (Gemini Live API requirement)
  // Output: 24kHz (Gemini TTS standard)
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  
  // Audio graph nodes
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  
  // Audio playback queue (seamless streaming without gaps)
  private nextStartTime: number = 0;
  private sources: Set<AudioBufferSourceNode> = new Set();

  // Text buffers for current conversation turn
  private currentInputText = "";
  private currentOutputText = "";

  constructor() {
    const apiKey = (import.meta as any).env?.VITE_API_KEY || process.env.API_KEY || '';
    this.client = new GoogleGenAI({ apiKey });
    console.log("🎤 [GeminiLive] Service initialized (Unified STT+TTS model)");
  }

  /**
   * Get analyser node for audio visualization
   */
  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  /**
   * Connect to Gemini Live API (Unified STT+TTS)
   */
  async connect(config: LiveConfig) {
    console.log("🔌 [GeminiLive] Connecting to unified model...");
    
    // 1. Initialize Audio Contexts
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
      sampleRate: 16000 
    });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
      sampleRate: 24000 
    });

    // Wake up contexts (critical for iOS/Safari autoplay policies)
    await this.inputAudioContext.resume();
    await this.outputAudioContext.resume();
    console.log("🔊 [GeminiLive] Audio contexts ready (Input: 16kHz, Output: 24kHz)");

    // 2. Setup visualizer analyser
    this.analyserNode = this.outputAudioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.connect(this.outputAudioContext.destination);
    console.log("📊 [GeminiLive] Analyser connected for visualization");

    // 3. Get microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
    console.log("🎤 [GeminiLive] Microphone access granted");

    // 4. Connect to Gemini Live API with unified model
    console.log("📡 [GeminiLive] Establishing WebSocket connection...");
    this.sessionPromise = this.client.live.connect({
      // ✅ Unified model for both STT and TTS
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      
      config: {
        // Request AUDIO response (enables TTS)
        responseModalities: [Modality.AUDIO], 
        
        // Enable input transcription (STT) - shows what user said
        inputAudioTranscription: {}, 
        
        // Enable output transcription (Captions) - shows model's text
        outputAudioTranscription: {},
        
        // Voice configuration for TTS
        speechConfig: {
          voiceConfig: { 
            prebuiltVoiceConfig: { 
              voiceName: 'Kore' // Russian-optimized female voice
            } 
          }
        },
        
        systemInstruction: SYSTEM_INSTRUCTION,
      },
      
      callbacks: {
        onopen: () => {
          console.log("✅ [GeminiLive] Connected (model: gemini-2.5-flash-native-audio-preview-12-2025)");
          // Start streaming microphone audio
          this.startAudioInputStreaming(stream);
        },
        onmessage: (msg: LiveServerMessage) => this.handleServerMessage(msg, config),
        onclose: () => {
          console.log("🔌 [GeminiLive] Connection closed");
          this.cleanup();
          config.onClose();
        },
        onerror: (err: any) => {
          console.error("❌ [GeminiLive] Error:", err);
          this.cleanup();
          const error = err instanceof Error ? err : new Error(err?.message || "Unknown Error");
          config.onError(error);
        }
      }
    });

    this.session = await this.sessionPromise;
    console.log("✅ [GeminiLive] Session established, ready for conversation");
    return this.session;
  }

  /**
   * Disconnect from Live API
   */
  async disconnect() {
    console.log("⏹️ [GeminiLive] Disconnecting...");
    
    // Close session
    if (this.session) {
      try {
        await this.session.close();
      } catch (e) {
        console.warn("⚠️ [GeminiLive] Error closing session:", e);
      }
      this.session = null;
    }
    
    this.sessionPromise = null;
    this.cleanup();
  }

  // --- Input Streaming (Microphone → Gemini) ---

  private startAudioInputStreaming(stream: MediaStream) {
    if (!this.inputAudioContext) return;

    console.log("🎤 [GeminiLive] Starting audio input streaming...");
    
    this.inputSource = this.inputAudioContext.createMediaStreamSource(stream);
    // Use ScriptProcessor to get raw PCM data
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    let chunkCount = 0;
    this.processor.onaudioprocess = (e) => {
      if (!this.sessionPromise) return;

      const inputData = e.inputBuffer.getChannelData(0);
      // Convert Float32 (WebAudio) → Int16 (Gemini API requirement)
      const pcm16 = this.float32ToInt16(inputData);
      
      chunkCount++;
      if (chunkCount % 10 === 0) {
        console.log(`📤 [GeminiLive] Sent ${chunkCount} audio chunks`);
      }

      this.sessionPromise!.then(session => {
        if (session) {
          try {
            session.sendRealtimeInput({
              media: {
                mimeType: "audio/pcm;rate=16000",
                data: this.arrayBufferToBase64(pcm16.buffer)
              }
            });
          } catch (err) {
            console.debug("⚠️ [GeminiLive] Error sending frame:", err);
          }
        }
      }).catch(err => {
        console.debug("⚠️ [GeminiLive] Session promise error:", err);
      });
    };

    this.inputSource.connect(this.processor);
    // Connect to destination to keep processor active (but won't hear self - buffer is silent)
    this.processor.connect(this.inputAudioContext.destination);
    
    console.log("✅ [GeminiLive] Audio streaming started");
  }

  // --- Output Handling (Gemini → Speakers + UI) ---

  private async handleServerMessage(message: LiveServerMessage, config: LiveConfig) {
    const content = message.serverContent;
    if (!content) return;

    // 1. Handle Audio Response (TTS)
    const audioData = content.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && this.outputAudioContext) {
      // Schedule playback without gaps
      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      
      const audioBuffer = await this.decodeAudioData(audioData, this.outputAudioContext);
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Connect to analyser (for visualization) then to speakers
      if (this.analyserNode) {
        source.connect(this.analyserNode);
      } else {
        source.connect(this.outputAudioContext.destination);
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      
      source.onended = () => this.sources.delete(source);
      this.sources.add(source);
      
      console.log(`🔊 [GeminiLive] Playing audio chunk (${audioBuffer.duration.toFixed(2)}s)`);
    }

    // 2. Handle Interruption (User interrupted model)
    if (content.interrupted) {
      console.log("⚠️ [GeminiLive] Interrupted - stopping playback");
      // Stop all playing audio
      this.sources.forEach(s => s.stop());
      this.sources.clear();
      this.nextStartTime = 0;
      this.currentOutputText = "";
    }

    // 3. Handle Input Transcription (STT - what user said)
    if (content.inputTranscription) {
      const text = content.inputTranscription.text;
      if (text) {
        this.currentInputText += text;
        // isFinal = false (user still might be speaking)
        config.onTranscriptUpdate(this.currentInputText, true, false);
        console.log(`📝 [GeminiLive] STT: "${this.currentInputText}"`);
      }
    }

    // 4. Handle Output Transcription (Captions - model's text)
    if (content.outputTranscription) {
      const text = content.outputTranscription.text;
      if (text) {
        this.currentOutputText += text;
        // isFinal = false (model still generating)
        config.onTranscriptUpdate(this.currentOutputText, false, false);
        console.log(`💬 [GeminiLive] TTS Text: "${this.currentOutputText}"`);
      }
    }

    // 5. Handle Turn Complete (Conversation turn finished)
    if (content.turnComplete) {
      console.log("✅ [GeminiLive] Turn complete");
      
      // Finalize user message
      if (this.currentInputText.trim()) {
        config.onTranscriptUpdate(this.currentInputText, true, true);
        this.currentInputText = "";
      }
      
      // Finalize model message
      if (this.currentOutputText.trim()) {
        config.onTranscriptUpdate(this.currentOutputText, false, true);
        this.currentOutputText = "";
      }
    }
  }

  // --- Cleanup ---

  private cleanup() {
    console.log("🧹 [GeminiLive] Cleaning up resources...");
    
    // Stop all playing audio
    this.sources.forEach(s => s.stop());
    this.sources.clear();
    
    // Disconnect audio nodes
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    
    // Close audio contexts
    if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
      this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
      this.outputAudioContext.close();
      this.outputAudioContext = null;
    }
    
    this.analyserNode = null;
    
    // Reset buffers
    this.currentInputText = "";
    this.currentOutputText = "";
    this.nextStartTime = 0;
  }

  // --- Audio Utilities ---

  /**
   * Convert Float32Array (WebAudio) to Int16Array (Gemini API)
   */
  private float32ToInt16(float32: Float32Array): Int16Array {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  /**
   * Convert ArrayBuffer to Base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Decode Gemini audio response (Base64 PCM) to AudioBuffer
   * Gemini returns raw PCM 24kHz Int16 (no WAV headers)
   */
  private async decodeAudioData(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
    // Decode base64 to binary
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Convert to Int16Array (PCM format)
    const dataInt16 = new Int16Array(bytes.buffer);
    
    // Create AudioBuffer (1 channel, 24kHz sample rate)
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    
    // Convert Int16 to Float32 (WebAudio format)
    for (let i = 0; i < dataInt16.length; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    
    return buffer;
  }
}

// Export singleton instance
export const geminiService = new GeminiLiveService();
