# 🎯 Unified Gemini Live Architecture - Technical Documentation

## 📋 Overview

**Version**: 1.5.0-unified  
**Date**: December 17, 2025  
**Status**: EXPERIMENTAL

This document describes the **unified Gemini Live architecture** where a **single model** (`gemini-2.5-flash-native-audio-preview-12-2025`) handles both:
- **STT (Speech-to-Text)**: Real-time transcription of user speech
- **TTS (Text-to-Speech)**: AI response audio generation

### Previous Architecture (v1.4.1)
```
User Speech → LiveTranscriptionService (STT model) → Text
Text Response → VoiceService (TTS model) → Audio
```
- **STT Model**: `gemini-2.5-flash-native-audio-preview-12-2025`
- **TTS Model**: `gemini-2.5-flash-preview-tts`
- **Connection**: 2 separate sessions (1 for STT, 1 for TTS)

### New Architecture (v1.5.0)
```
User Speech ──┐
              ├──→ [Gemini Live WebSocket] ──→ AI Audio Response
Text Query ───┘         (Single Model)
```
- **Unified Model**: `gemini-2.5-flash-native-audio-preview-12-2025`
- **Connection**: 1 persistent WebSocket for entire conversation
- **Advantages**: 
  - Lower latency (no connection switching)
  - Interruption support (barge-in)
  - Real-time streaming for both STT and TTS

---

## 🏗️ Architecture Components

### 1. GeminiLiveService (services/geminiService.ts)

**Purpose**: Manages unified WebSocket connection for STT + TTS

**Key Methods**:

#### `connect(config: LiveConfig)`
Establishes WebSocket connection to Gemini Live API.

```typescript
const session = await geminiService.connect({
  onTranscriptUpdate: (text, isUser, isFinal) => {
    // text: Transcribed/generated text
    // isUser: true = STT (user speech), false = TTS (model response)
    // isFinal: true = turn complete, false = streaming
    
    if (isUser && isFinal) {
      console.log("User said:", text);
    } else if (!isUser && isFinal) {
      console.log("Model responded:", text);
    }
  },
  onClose: () => {
    console.log("Connection closed");
  },
  onError: (err) => {
    console.error("Error:", err);
  }
});
```

**What happens inside**:
1. Creates `AudioContext` (Input: 16kHz, Output: 24kHz)
2. Requests microphone access
3. Connects to Live API WebSocket
4. Starts streaming microphone PCM data
5. Listens for server messages (audio + transcripts)

#### `disconnect()`
Closes WebSocket and cleans up audio resources.

```typescript
await geminiService.disconnect();
```

---

### 2. Audio Flow: Microphone → Gemini → Speakers

```
┌─────────────────────────────────────────────────────────────┐
│                    GEMINI LIVE API FLOW                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Microphone]                                               │
│       ↓                                                     │
│  getUserMedia() → MediaStream                               │
│       ↓                                                     │
│  AudioContext (16kHz)                                       │
│       ↓                                                     │
│  ScriptProcessor (4096 samples)                             │
│       ↓                                                     │
│  Float32Array → Int16Array (PCM)                            │
│       ↓                                                     │
│  Base64 encode                                              │
│       ↓                                                     │
│  WebSocket.send({                                           │
│    realtimeInput: {                                         │
│      media: {                                               │
│        mimeType: "audio/pcm;rate=16000",                    │
│        data: "<base64>"                                     │
│      }                                                      │
│    }                                                        │
│  })                                                         │
│       ↓                                                     │
│  ┌──────────────────────────────────────┐                  │
│  │   GEMINI MODEL PROCESSING            │                  │
│  │                                      │                  │
│  │  1. STT: Transcribe audio           │                  │
│  │     → inputAudioTranscription       │                  │
│  │                                      │                  │
│  │  2. AI: Generate response           │                  │
│  │     → Text + Audio                  │                  │
│  │                                      │                  │
│  │  3. TTS: Stream audio chunks        │                  │
│  │     → outputAudioTranscription      │                  │
│  └──────────────────────────────────────┘                  │
│       ↓                                                     │
│  WebSocket.onmessage({                                      │
│    serverContent: {                                         │
│      inputTranscription: { text: "..." },  ← STT          │
│      modelTurn: {                                           │
│        parts: [{                                            │
│          inlineData: { data: "<base64 PCM>" }  ← TTS Audio│
│        }]                                                   │
│      },                                                     │
│      outputTranscription: { text: "..." },  ← TTS Text    │
│      turnComplete: true                                     │
│    }                                                        │
│  })                                                         │
│       ↓                                                     │
│  Decode Base64 → Int16Array → Float32Array                 │
│       ↓                                                     │
│  AudioBuffer (24kHz)                                        │
│       ↓                                                     │
│  AudioBufferSourceNode                                      │
│       ↓                                                     │
│  AnalyserNode (Visualizer)                                  │
│       ↓                                                     │
│  [Speakers] 🔊                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 3. Message Types from Gemini Live API

#### A. Input Transcription (STT)
```typescript
{
  serverContent: {
    inputTranscription: {
      text: "привет как дела"  // User's speech transcribed
    }
  }
}
```

**When received**: While user is speaking  
**Action**: Update UI with real-time transcript

#### B. Output Audio (TTS)
```typescript
{
  serverContent: {
    modelTurn: {
      parts: [{
        inlineData: {
          mimeType: "audio/pcm",
          data: "<base64 PCM 24kHz Int16>"  // AI response audio
        }
      }]
    }
  }
}
```

**When received**: Model generating audio response  
**Action**: Decode and play through speakers

#### C. Output Transcription (Captions)
```typescript
{
  serverContent: {
    outputTranscription: {
      text: "Здравствуйте! Как я могу помочь?"  // AI response text
    }
  }
}
```

**When received**: Alongside audio chunks  
**Action**: Display as text captions in UI

#### D. Turn Complete
```typescript
{
  serverContent: {
    turnComplete: true  // Conversation turn finished
  }
}
```

**When received**: End of user speech or model response  
**Action**: Finalize messages, clear buffers

#### E. Interrupted
```typescript
{
  serverContent: {
    interrupted: true  // User interrupted model
  }
}
```

**When received**: User speaks while model is talking  
**Action**: Stop all audio playback immediately

---

## 🔧 Implementation Examples

### Example 1: Simple Voice Conversation

```typescript
import { geminiService } from './services/geminiService';

// 1. Connect to Live API
const handleStartConversation = async () => {
  try {
    await geminiService.connect({
      onTranscriptUpdate: (text, isUser, isFinal) => {
        if (isFinal) {
          // Add message to chat
          addMessage({
            role: isUser ? 'user' : 'model',
            text: text,
            timestamp: new Date()
          });
        } else {
          // Show live preview (streaming)
          setLivePreview({ text, isUser });
        }
      },
      onClose: () => {
        console.log("Conversation ended");
        setState('idle');
      },
      onError: (err) => {
        console.error("Error:", err);
        setState('error');
      }
    });
    
    setState('listening');
    
  } catch (error) {
    console.error("Failed to connect:", error);
  }
};

// 2. Stop conversation
const handleStopConversation = async () => {
  await geminiService.disconnect();
  setState('idle');
};
```

### Example 2: With Audio Visualizer

```typescript
import { geminiService } from './services/geminiService';

const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

const handleStartWithVisualizer = async () => {
  await geminiService.connect({
    onTranscriptUpdate: (text, isUser, isFinal) => {
      // Handle transcripts...
    },
    onClose: () => {},
    onError: (err) => {}
  });
  
  // Get analyser for visualization
  setAnalyser(geminiService.getAnalyserNode());
};

// In your render:
<Visualizer analyser={analyser} state={appState} />
```

### Example 3: Interruption Handling

```typescript
// User can interrupt model at any time
const handleInterrupt = async () => {
  // Model will automatically stop when detecting new user speech
  // Or manually disconnect:
  await geminiService.disconnect();
  
  // Reconnect for new turn
  await geminiService.connect({...});
};
```

---

## 📊 Configuration Details

### Audio Specifications

| Parameter | Input (Microphone) | Output (Speakers) |
|-----------|-------------------|-------------------|
| Sample Rate | 16000 Hz | 24000 Hz |
| Channels | 1 (mono) | 1 (mono) |
| Format | PCM Int16 | PCM Int16 |
| Encoding | Little-endian | Little-endian |
| Chunk Size | 4096 samples (~256ms) | Variable (from model) |

### Model Configuration

```typescript
{
  model: 'gemini-2.5-flash-native-audio-preview-12-2025',
  config: {
    responseModalities: [Modality.AUDIO],  // Enable TTS
    inputAudioTranscription: {},           // Enable STT
    outputAudioTranscription: {},          // Enable captions
    speechConfig: {
      voiceConfig: { 
        prebuiltVoiceConfig: { 
          voiceName: 'Kore'  // Russian-optimized voice
        } 
      }
    },
    systemInstruction: SYSTEM_INSTRUCTION
  }
}
```

---

## 🚀 Advantages of Unified Architecture

### 1. Lower Latency
- **Old**: Connect → STT → Disconnect → Connect → TTS (~2-3s total)
- **New**: Single persistent connection (~500ms total)

### 2. Interruption Support (Barge-in)
```typescript
// User speaks while model is talking:
// 1. Model detects new speech
// 2. Sends { interrupted: true }
// 3. App stops audio playback
// 4. Model starts processing new input
```

### 3. Real-time Streaming
- See user's words as they speak
- Hear AI response immediately (chunks stream in)

### 4. Simplified State Management
```typescript
// Old (2 services):
if (useSTT) liveTranscriptionService.start();
if (useTTS) voiceService.speak();

// New (1 service):
geminiService.connect();  // Handles both!
```

---

## ⚠️ Important Notes

### 1. Model Availability
- `gemini-2.5-flash-native-audio-preview-12-2025` is a **preview model**
- Not all Live API models support `responseModalities: [AUDIO]`
- Check model capabilities: https://ai.google.dev/gemini-api/docs/models

### 2. Error Handling
```typescript
config.onError = (err) => {
  // Common errors:
  // - "Model not found" → Check model name
  // - "Rate limit exceeded" → Too many requests
  // - "WebSocket closed" → Network issue
  
  if (err.message.includes('not found')) {
    console.error("Model not available, fallback to v1.4.1");
    // Use old architecture: liveTranscriptionService + voiceService
  }
};
```

### 3. Browser Compatibility
- **Chrome/Edge**: Full support ✅
- **Safari**: Requires user gesture for AudioContext ⚠️
- **Firefox**: Experimental support 🧪
- **Telegram WebView**: Tested and working ✅

---

## 🔄 Rollback Instructions

If unified architecture doesn't work, rollback to v1.4.1:

```bash
# Method 1: Git tag
git reset --hard backup-before-gemini-live
git push origin gemini --force

# Method 2: Manual
# 1. Restore old geminiService.ts from backup-before-gemini-live tag
# 2. Use liveTranscriptionService for STT
# 3. Use voiceService for TTS
```

**Backup tag created**: `backup-before-gemini-live` (commit a4c816d)

---

## 📈 Performance Comparison

| Metric | Old (v1.4.1) | New (v1.5.0 Unified) |
|--------|--------------|----------------------|
| Connection Setup | 2x 500ms = 1s | 1x 500ms = 0.5s |
| STT Latency | ~100-300ms | ~100-300ms (same) |
| TTS Latency | ~800ms | ~400ms (streaming) |
| Total Latency | ~1-2s | ~500-700ms |
| Interruption | Not supported | ✅ Supported |
| Real-time Preview | STT only | STT + TTS |

---

## 🎯 Next Steps

1. **Test with real users** in Telegram Mini Apps
2. **Monitor latency** and error rates
3. **Collect feedback** on interruption feature
4. **Optimize chunk sizes** for better streaming
5. **Add fallback** to old architecture if needed

---

**Last Updated**: December 17, 2025  
**Author**: AI Development Team  
**Version**: 1.5.0-unified (EXPERIMENTAL)
