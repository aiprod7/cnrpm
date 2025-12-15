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

  constructor() {
    // Initialize Google GenAI
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    console.log("VoiceService init, API Key present:", !!apiKey, "Key length:", apiKey.length);
    this.ai = new GoogleGenAI({ apiKey });
    
    // Initialize Speech Recognition (Browser Native)
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'ru-RU';
      this.recognition.maxAlternatives = 1;
      console.log("SpeechRecognition API available");
    } else {
      console.warn("SpeechRecognition API NOT available in this browser/WebView");
    }
  }

  // Check if speech recognition is supported
  isSpeechRecognitionSupported(): boolean {
    return this.recognition !== null;
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

  // --- Speech To Text ---

  listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.recognition) {
        reject(new Error("Speech Recognition API not supported in this browser."));
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
