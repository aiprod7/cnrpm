import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";

export type AudioDataCallback = (audioBuffer: AudioBuffer) => void;
export type TranscriptCallback = (text: string, isUser: boolean) => void;

interface LiveSessionConfig {
  onAudioData: AudioDataCallback;
  onTranscript: TranscriptCallback;
  onClose: () => void;
  onError: (err: any) => void;
}

export class GeminiLiveService {
  private client: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextStartTime: number = 0;
  private sources: Set<AudioBufferSourceNode> = new Set();
  
  // Buffers for transcript aggregation
  private currentInputTranscription: string = '';
  private currentOutputTranscription: string = '';

  constructor() {
    this.client = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  // Public property to expose analyser to UI
  public analyserNode: AnalyserNode | null = null;

  async connect(config: LiveSessionConfig) {
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    // Ensure contexts are running (vital for mobile/some browsers)
    await this.inputAudioContext.resume();
    await this.outputAudioContext.resume();

    // Setup Visualizer Analyser
    this.analyserNode = this.outputAudioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.connect(this.outputAudioContext.destination);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    this.sessionPromise = this.client.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        onopen: () => {
          console.log("Gemini Live Session Opened");
          this.startAudioInput(stream);
        },
        onmessage: async (message: LiveServerMessage) => {
            this.handleMessage(message, config);
        },
        onclose: () => {
          console.log("Gemini Live Session Closed");
          this.sessionPromise = null;
          config.onClose();
        },
        onerror: (err) => {
          console.error("Gemini Live Error", err);
          this.sessionPromise = null;
          config.onError(err);
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM_INSTRUCTION,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }, // Soft female voice
        },
        inputAudioTranscription: {}, 
        outputAudioTranscription: {}, 
      }
    });

    return this.sessionPromise;
  }

  private startAudioInput(stream: MediaStream) {
    if (!this.inputAudioContext) return;

    this.inputSource = this.inputAudioContext.createMediaStreamSource(stream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      // If session is closed/null, stop processing
      if (!this.sessionPromise) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = this.createPcmBlob(inputData);
      
      this.sessionPromise.then(session => {
        // Double check in case it closed while waiting for promise
        if (session) {
            try {
                session.sendRealtimeInput({ media: pcmBlob });
            } catch (err) {
                console.debug("Error sending frame:", err);
            }
        }
      }).catch(err => {
        // Session initialization failed or session closed
        console.debug("Session promise error:", err);
      });
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async handleMessage(message: LiveServerMessage, config: LiveSessionConfig) {
    // 1. Audio Handling
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && this.outputAudioContext) {
      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      const audioBuffer = await this.decodeAudioData(audioData, this.outputAudioContext);
      
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Connect to Analyser (Visualizer) and then Destination
      if (this.analyserNode) {
        source.connect(this.analyserNode);
      } else {
        source.connect(this.outputAudioContext.destination);
      }
      
      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.sources.add(source);
    }

    // 2. Interruption Handling
    if (message.serverContent?.interrupted) {
        this.sources.forEach(source => source.stop());
        this.sources.clear();
        this.nextStartTime = 0;
        this.currentOutputTranscription = ''; // Reset partial
    }

    // 3. Transcript Handling
    if (message.serverContent?.outputTranscription) {
        this.currentOutputTranscription += message.serverContent.outputTranscription.text;
    }
    if (message.serverContent?.inputTranscription) {
        this.currentInputTranscription += message.serverContent.inputTranscription.text;
    }

    if (message.serverContent?.turnComplete) {
        if (this.currentInputTranscription.trim()) {
             config.onTranscript(this.currentInputTranscription, true);
        }
        if (this.currentOutputTranscription.trim()) {
            config.onTranscript(this.currentOutputTranscription, false);
        }
        
        this.currentInputTranscription = '';
        this.currentOutputTranscription = '';
    }
  }

  async disconnect() {
    this.sessionPromise = null; // Prevent new sends
    
    // Cleanup Audio
    this.sources.forEach(s => s.stop());
    this.sources.clear();
    
    if (this.processor) {
        this.processor.disconnect();
        this.processor = null;
    }
    if (this.inputSource) {
        this.inputSource.disconnect();
        this.inputSource = null;
    }
    if (this.inputAudioContext) {
        if (this.inputAudioContext.state !== 'closed') await this.inputAudioContext.close();
        this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
        if (this.outputAudioContext.state !== 'closed') await this.outputAudioContext.close();
        this.outputAudioContext = null;
    }
  }

  // --- Helpers ---

  private createPcmBlob(data: Float32Array): { data: string, mimeType: string } {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    const uint8 = new Uint8Array(int16.buffer);
    let binary = '';
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8[i]);
    }
    const b64 = btoa(binary);
    
    return {
      data: b64,
      mimeType: 'audio/pcm;rate=16000',
    };
  }

  private async decodeAudioData(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const dataInt16 = new Int16Array(bytes.buffer);
    const frameCount = dataInt16.length; 
    const buffer = ctx.createBuffer(1, frameCount, 24000);
    const channelData = buffer.getChannelData(0);
    
    for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
  }
}

export const geminiService = new GeminiLiveService();