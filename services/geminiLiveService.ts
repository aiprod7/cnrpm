/**
 * Gemini Live API Service
 * Real-time audio streaming with WebSocket connection
 * 
 * Model: gemini-live-2.5-flash-native-audio
 * Documentation: https://ai.google.dev/gemini-api/docs/live
 */

interface LiveAPIConfig {
  model: string;
  apiKey: string;
}

interface AudioConfig {
  sampleRate: number;
  channels: number;
}

type LiveAPIMessage = 
  | { setup: { model: string } }
  | { clientContent: { turns: Array<{ role: string; parts: Array<any> }>; turnComplete: boolean } }
  | { realtimeInput: { mediaChunks: Array<{ mimeType: string; data: string }> } }
  | { toolResponse: { functionResponses: Array<any> } };

type ServerMessage =
  | { setupComplete: {} }
  | { serverContent: { modelTurn: { parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }; turnComplete: boolean } }
  | { toolCall: { functionCalls: Array<{ name: string; args: any; id: string }> } }
  | { toolCallCancellation: { ids: string[] } };

export class GeminiLiveService {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isStreaming: boolean = false;
  private config: LiveAPIConfig;
  private audioConfig: AudioConfig = {
    sampleRate: 16000, // Required by Gemini Live API
    channels: 1        // Mono
  };
  
  // Callbacks
  private onTranscriptCallback?: (text: string) => void;
  private onAudioResponseCallback?: (audioData: ArrayBuffer) => void;
  private onErrorCallback?: (error: Error) => void;
  private onConnectedCallback?: () => void;
  private onDisconnectedCallback?: () => void;

  constructor(apiKey: string) {
    this.config = {
      model: "gemini-live-2.5-flash-native-audio",
      apiKey: apiKey
    };
  }

  /**
   * Initialize WebSocket connection to Gemini Live API
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Construct WebSocket URL
        const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.config.apiKey}`;
        
        console.log('🔌 [Live API] Connecting to Gemini Live API...');
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('✅ [Live API] WebSocket connected');
          
          // Send setup message
          this.sendSetupMessage();
          
          if (this.onConnectedCallback) {
            this.onConnectedCallback();
          }
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleServerMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('❌ [Live API] WebSocket error:', error);
          const err = new Error('WebSocket connection failed');
          if (this.onErrorCallback) {
            this.onErrorCallback(err);
          }
          reject(err);
        };

        this.ws.onclose = () => {
          console.log('🔌 [Live API] WebSocket closed');
          this.cleanup();
          if (this.onDisconnectedCallback) {
            this.onDisconnectedCallback();
          }
        };

      } catch (error) {
        console.error('❌ [Live API] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Send initial setup message
   */
  private sendSetupMessage(): void {
    const setupMessage: LiveAPIMessage = {
      setup: {
        model: `models/${this.config.model}`
      }
    };
    
    this.sendMessage(setupMessage);
    console.log('📤 [Live API] Setup message sent');
  }

  /**
   * Start streaming audio from microphone
   */
  async startStreaming(): Promise<void> {
    if (this.isStreaming) {
      console.warn('⚠️ [Live API] Already streaming');
      return;
    }

    try {
      // Get microphone access with required format
      console.log('🎤 [Live API] Requesting microphone access...');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.audioConfig.sampleRate,
          channelCount: this.audioConfig.channels,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Create AudioContext
      this.audioContext = new AudioContext({ sampleRate: this.audioConfig.sampleRate });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create ScriptProcessor for audio capture
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this.isStreaming) return;

        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0); // Float32Array

        // Convert Float32 to Int16 PCM (required format)
        const pcmData = this.float32ToInt16(inputData);
        
        // Convert to base64
        const base64Audio = this.arrayBufferToBase64(pcmData.buffer);

        // Send to Live API
        this.sendAudioChunk(base64Audio);
      };

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      this.isStreaming = true;
      console.log('✅ [Live API] Streaming started');

    } catch (error) {
      console.error('❌ [Live API] Failed to start streaming:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error as Error);
      }
      throw error;
    }
  }

  /**
   * Stop streaming audio
   */
  stopStreaming(): void {
    if (!this.isStreaming) return;

    console.log('⏹️ [Live API] Stopping stream...');
    this.isStreaming = false;

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    console.log('✅ [Live API] Stream stopped');
  }

  /**
   * Send audio chunk to Live API
   */
  private sendAudioChunk(base64Audio: string): void {
    const message: LiveAPIMessage = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: "audio/pcm",
          data: base64Audio
        }]
      }
    };

    this.sendMessage(message);
  }

  /**
   * Handle incoming server messages
   */
  private handleServerMessage(data: string): void {
    try {
      const message: ServerMessage = JSON.parse(data);

      if ('setupComplete' in message) {
        console.log('✅ [Live API] Setup complete');
      } 
      else if ('serverContent' in message) {
        const parts = message.serverContent.modelTurn.parts;
        
        for (const part of parts) {
          // Handle text transcript
          if (part.text && this.onTranscriptCallback) {
            console.log('📝 [Live API] Transcript received:', part.text);
            this.onTranscriptCallback(part.text);
          }
          
          // Handle audio response
          if (part.inlineData?.mimeType === 'audio/pcm' && this.onAudioResponseCallback) {
            const audioData = this.base64ToArrayBuffer(part.inlineData.data);
            console.log('🔊 [Live API] Audio response received');
            this.onAudioResponseCallback(audioData);
          }
        }
      }
      else if ('toolCall' in message) {
        console.log('🔧 [Live API] Tool call received:', message.toolCall);
        // Handle function calling if needed
      }
      else if ('toolCallCancellation' in message) {
        console.log('🔧 [Live API] Tool call cancelled:', message.toolCallCancellation.ids);
      }

    } catch (error) {
      console.error('❌ [Live API] Error parsing message:', error);
    }
  }

  /**
   * Send message to WebSocket
   */
  private sendMessage(message: LiveAPIMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ [Live API] WebSocket not connected');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect from Live API
   */
  disconnect(): void {
    this.stopStreaming();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.cleanup();
    console.log('🔌 [Live API] Disconnected');
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.isStreaming = false;
    this.scriptProcessor = null;
    this.audioContext = null;
    this.mediaStream = null;
  }

  // ==================== Callbacks ====================

  onTranscript(callback: (text: string) => void): void {
    this.onTranscriptCallback = callback;
  }

  onAudioResponse(callback: (audioData: ArrayBuffer) => void): void {
    this.onAudioResponseCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  onConnected(callback: () => void): void {
    this.onConnectedCallback = callback;
  }

  onDisconnected(callback: () => void): void {
    this.onDisconnectedCallback = callback;
  }

  // ==================== Audio Utilities ====================

  /**
   * Convert Float32Array to Int16 PCM
   */
  private float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  /**
   * Convert ArrayBuffer to base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Play audio response (24kHz PCM)
   */
  async playAudio(audioData: ArrayBuffer): Promise<void> {
    try {
      const audioContext = new AudioContext({ sampleRate: 24000 }); // Output at 24kHz
      
      // Convert Int16 PCM to Float32
      const int16Array = new Int16Array(audioData);
      const float32Array = new Float32Array(int16Array.length);
      
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
      }

      // Create audio buffer
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      // Play
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);

      console.log('🔊 [Live API] Playing audio response');

      // Wait for playback to complete
      return new Promise((resolve) => {
        source.onended = () => {
          audioContext.close();
          resolve();
        };
      });

    } catch (error) {
      console.error('❌ [Live API] Error playing audio:', error);
      throw error;
    }
  }

  // ==================== Getters ====================

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  isCurrentlyStreaming(): boolean {
    return this.isStreaming;
  }
}

export default GeminiLiveService;
