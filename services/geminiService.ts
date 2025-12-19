import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";
import { microphoneManager } from './microphoneManager';
import {
  CURRENT_MODEL,
  CURRENT_VOICE,
  AUDIO_CONFIG,
  TRANSCRIPTION_CONFIG,
  THINKING_CONFIG,
  VAD_CONFIG,
  getUnifiedConfig,
  getTTSOnlyConfig,
} from './geminiLiveConfig';

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
   * Check if session is active (for external use)
   */
  public get isConnected(): boolean {
    return this.sessionPromise !== null && this.session !== null;
  }

  /**
   * Connect for TTS only (no microphone needed)
   * Use this when you just need to speak text without listening
   */
  async connectForTTS(config: LiveConfig): Promise<any> {
    // ═══════════════════════════════════════════════════════════════════════
    // 🔧 TTS НАСТРОЙКИ - Измените в geminiLiveConfig.ts
    // ═══════════════════════════════════════════════════════════════════════
    // CURRENT_MODEL - модель (gemini-2.5-flash-native-audio-preview-12-2025)
    // CURRENT_VOICE - голос (Kore, Aoede, Charon и др.)
    // TRANSCRIPTION_CONFIG.OUTPUT_TRANSCRIPTION.ENABLED - субтитры
    // ═══════════════════════════════════════════════════════════════════════
    
    const TTS_SYSTEM_PROMPT = `КРИТИЧЕСКИ ВАЖНО: Ты - TTS движок (Text-to-Speech синтезатор).

ТВОЯ ЕДИНСТВЕННАЯ ЗАДАЧА:
- Произноси ДОСЛОВНО текст который тебе передают
- НЕ добавляй НИЧЕГО от себя (приветствия, комментарии, пояснения)
- НЕ интерпретируй текст
- НЕ отвечай на вопросы в тексте
- НЕ комментируй содержание
- Работай как диктор/робот который просто читает текст

Формат работы: Получил текст → озвучил ДОСЛОВНО → всё.
Язык: Русский (используй голос ${CURRENT_VOICE}).`;

    console.log("\n" + "=".repeat(80));
    console.log("🔌 [GeminiLive TTS] ПОДКЛЮЧЕНИЕ К МОДЕЛИ");
    console.log("=".repeat(80));
    console.log(`📦 Модель: ${CURRENT_MODEL}`);
    console.log(`🎤 Голос: ${CURRENT_VOICE}`);
    console.log(`🔊 Sample Rate: ${AUDIO_CONFIG.OUTPUT.SAMPLE_RATE}Hz`);
    console.log(`📝 Output Transcription: ${TRANSCRIPTION_CONFIG.OUTPUT_TRANSCRIPTION.ENABLED}`);
    console.log("-".repeat(80) + "\n");
    
    // Initialize output AudioContext only
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
      sampleRate: AUDIO_CONFIG.OUTPUT.SAMPLE_RATE 
    });
    await this.outputAudioContext.resume();
    
    // Setup visualizer analyser
    this.analyserNode = this.outputAudioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.connect(this.outputAudioContext.destination);

    // Get TTS config from geminiLiveConfig.ts
    const ttsConfig = getTTSOnlyConfig(TTS_SYSTEM_PROMPT);

    // Connect to Gemini Live API (TTS mode)
    this.sessionPromise = this.client.live.connect({
      model: ttsConfig.model,
      config: ttsConfig.config,
      callbacks: {
        onopen: () => {
          console.log(`✅ [GeminiLive TTS] Connected (${CURRENT_MODEL})`);
        },
        onmessage: (msg: LiveServerMessage) => this.handleServerMessage(msg, config),
        onclose: () => {
          console.log("🔌 [GeminiLive TTS] Connection closed");
          this.cleanup();
          config.onClose();
        },
        onerror: (err: any) => {
          console.error("❌ [GeminiLive TTS] Error:", err);
          this.cleanup();
          config.onError(err instanceof Error ? err : new Error(err?.message || "Unknown Error"));
        }
      }
    });

    this.session = await this.sessionPromise;
    console.log("✅ [GeminiLive TTS] Session ready");
    console.log("📋 [GeminiLive TTS] Session methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(this.session)));
    return this.session;
  }

  /**
   * Send text message to active Live session.
   * Model will respond with audio stream (TTS).
   */
  public async sendText(text: string) {
    if (!this.session) {
      throw new Error("Live session is not active. Connect first.");
    }
    
    console.log("\n" + "=".repeat(80));
    console.log("📤 [GeminiLive TTS] ОТПРАВКА ТЕКСТА НА СИНТЕЗ");
    console.log("=".repeat(80));
    console.log(`📝 Текст для озвучки (${text.length} символов):`);
    console.log("-".repeat(80));
    console.log(text);
    console.log("-".repeat(80));
    console.log(`⏱️ Ожидаемая длительность: ~${Math.round(text.length * 0.1)}s\n`);
    
    // Try different methods based on SDK version
    const methods = ['sendClientContent', 'send', 'sendMessage', 'sendText'];
    
    for (const method of methods) {
      if (typeof this.session[method] === 'function') {
        console.log(`🔄 [GeminiLive] Trying method: ${method}`);
        try {
          if (method === 'sendClientContent') {
            await this.session.sendClientContent({
              turns: [{ role: "user", parts: [{ text }] }],
              turnComplete: true
            });
          } else if (method === 'send') {
            // @google/genai SDK format
            await this.session.send({ text });
          } else {
            await this.session[method](text);
          }
          console.log(`✅ [GeminiLive TTS] Текст отправлен через метод: ${method}`);
          console.log(`🔊 [GeminiLive TTS] Ожидание аудио ответа от модели...\n`);
          return;
        } catch (err: any) {
          console.warn(`⚠️ [GeminiLive] ${method} failed:`, err.message);
        }
      }
    }
    
    throw new Error("No valid send method found on session object");
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
    // ═══════════════════════════════════════════════════════════════════════
    // 🔧 STT+TTS НАСТРОЙКИ - Измените в geminiLiveConfig.ts:
    // ═══════════════════════════════════════════════════════════════════════
    // CURRENT_MODEL - модель (gemini-2.5-flash-native-audio-preview-12-2025)
    // CURRENT_VOICE - голос TTS (Kore, Aoede, Charon и др.)
    // AUDIO_CONFIG.INPUT - настройки входного аудио (микрофон)
    // AUDIO_CONFIG.OUTPUT - настройки выходного аудио (динамики)
    // TRANSCRIPTION_CONFIG.INPUT_TRANSCRIPTION - STT (распознавание речи)
    // TRANSCRIPTION_CONFIG.OUTPUT_TRANSCRIPTION - субтитры TTS
    // VAD_CONFIG - Voice Activity Detection (определение речи)
    // THINKING_CONFIG - "размышления" модели перед ответом
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log("\n" + "=".repeat(80));
    console.log("🔌 [GeminiLive] ПОДКЛЮЧЕНИЕ К UNIFIED STT+TTS");
    console.log("=".repeat(80));
    console.log(`📦 Модель: ${CURRENT_MODEL}`);
    console.log(`🎤 Голос: ${CURRENT_VOICE}`);
    console.log(`🔊 Input: ${AUDIO_CONFIG.INPUT.SAMPLE_RATE}Hz → Output: ${AUDIO_CONFIG.OUTPUT.SAMPLE_RATE}Hz`);
    console.log(`📝 STT (input transcription): ${TRANSCRIPTION_CONFIG.INPUT_TRANSCRIPTION.ENABLED}`);
    console.log(`💬 TTS captions (output transcription): ${TRANSCRIPTION_CONFIG.OUTPUT_TRANSCRIPTION.ENABLED}`);
    console.log(`🧠 Thinking budget: ${THINKING_CONFIG.THINKING_BUDGET} tokens`);
    console.log(`🎙️ VAD enabled: ${VAD_CONFIG.ENABLED}`);
    console.log("-".repeat(80) + "\n");
    
    // 1. Initialize Audio Contexts
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
      sampleRate: AUDIO_CONFIG.INPUT.SAMPLE_RATE 
    });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
      sampleRate: AUDIO_CONFIG.OUTPUT.SAMPLE_RATE 
    });

    // Wake up contexts (critical for iOS/Safari autoplay policies)
    await this.inputAudioContext.resume();
    await this.outputAudioContext.resume();
    console.log(`🔊 [GeminiLive] Audio contexts ready (Input: ${AUDIO_CONFIG.INPUT.SAMPLE_RATE}Hz, Output: ${AUDIO_CONFIG.OUTPUT.SAMPLE_RATE}Hz)`);

    // 2. Setup visualizer analyser
    this.analyserNode = this.outputAudioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.connect(this.outputAudioContext.destination);
    console.log("📊 [GeminiLive] Analyser connected for visualization");

    // 3. Get microphone access through MicrophoneManager
    console.log("🎤 [GeminiLive] Getting audio stream from MicrophoneManager...");
    const stream = await microphoneManager.getAudioStream({
      channelCount: AUDIO_CONFIG.INPUT.CHANNELS,
      sampleRate: AUDIO_CONFIG.INPUT.SAMPLE_RATE,
      echoCancellation: AUDIO_CONFIG.INPUT.ECHO_CANCELLATION,
      noiseSuppression: AUDIO_CONFIG.INPUT.NOISE_SUPPRESSION,
      autoGainControl: AUDIO_CONFIG.INPUT.AUTO_GAIN_CONTROL,
    });
    
    if (!stream) {
      throw new Error('Failed to get audio stream from MicrophoneManager');
    }
    
    console.log("✅ [GeminiLive] Audio stream obtained from cache (no permission dialog)");

    // 4. Get unified config from geminiLiveConfig.ts
    const unifiedConfig = getUnifiedConfig(SYSTEM_INSTRUCTION);

    // 5. Connect to Gemini Live API with unified model
    console.log("📡 [GeminiLive] Establishing WebSocket connection...");
    this.sessionPromise = this.client.live.connect({
      model: unifiedConfig.model,
      config: unifiedConfig.config,
      
      callbacks: {
        onopen: () => {
          console.log(`✅ [GeminiLive] Connected (model: ${CURRENT_MODEL})`);
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
    
    // Debug: log available methods on session
    console.log("✅ [GeminiLive] Session established, ready for conversation");
    console.log("📋 [GeminiLive] Session type:", typeof this.session);
    console.log("📋 [GeminiLive] Session keys:", this.session ? Object.keys(this.session) : 'null');
    console.log("📋 [GeminiLive] Session methods:", this.session ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.session)) : 'null');
    
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
                mimeType: AUDIO_CONFIG.INPUT.MIME_TYPE,
                data: this.arrayBufferToBase64(pcm16.buffer as ArrayBuffer)
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
   * Gemini returns raw PCM Int16 at OUTPUT sample rate (no WAV headers)
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
    
    // Create AudioBuffer (1 channel, OUTPUT sample rate)
    const buffer = ctx.createBuffer(
      AUDIO_CONFIG.OUTPUT.CHANNELS, 
      dataInt16.length, 
      AUDIO_CONFIG.OUTPUT.SAMPLE_RATE
    );
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
