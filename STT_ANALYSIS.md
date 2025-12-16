# 🎤 Анализ Speech-to-Text (STT) в VoxLux

## ✅ Текущая конфигурация

### 📊 Все модели в проекте VoxLux (ОБНОВЛЕНО v1.4.1!)

**Всего используется: 5 моделей Google Gemini**

#### 1️⃣ Потоковая транскрибация (STT Primary) 🚀
```typescript
model: "gemini-2.5-flash-native-audio-preview-12-2025"
purpose: "Real-time speech-to-text через Live API"
protocol: "SDK live.connect() (WebSocket-подобный)"
latency: "~100-300ms"
format: "16kHz PCM streaming"
file: "services/liveTranscriptionService.ts"
status: "✅ АКТИВНАЯ (Primary)"
```

#### 2️⃣ Batch транскрибация (STT Fallback) 📦
```typescript
model: "gemini-2.5-flash"
purpose: "Fallback для STT когда Live API недоступен"
protocol: "REST API"
latency: "~1-2s"
format: "WAV file upload (base64)"
file: "services/voiceService.ts (transcribeWithGemini)"
status: "✅ АКТИВНАЯ (Fallback)"
```

#### 3️⃣ Синтез речи (TTS) 🔊
```typescript
model: "gemini-2.5-flash-preview-tts"
purpose: "Text-to-Speech (озвучка ответов AI)"
protocol: "REST API"
voice: "Kore (Russian-optimized, female)"
latency: "~800ms"
format: "24kHz PCM output"
file: "services/voiceService.ts (speak)"
status: "✅ АКТИВНАЯ"
```

#### 4️⃣ Вспомогательная модель (Transcription Model для Legacy Live API) 🔧
```typescript
model: "gemini-2.0-flash-exp"
purpose: "Модель для inputAudioTranscription в старом WebSocket Live API"
protocol: "WebSocket (legacy)"
file: "services/geminiLiveService.ts (DEPRECATED)"
status: "⚠️ LEGACY (не используется, заменена на SDK live.connect())"
note: "Требовалась для native-audio-dialog модели, но больше не нужна"
```

#### 5️⃣ Legacy Live API модель (DEPRECATED) ❌
```typescript
model: "gemini-2.5-flash-native-audio-dialog"
purpose: "Старая модель для WebSocket Live API"
protocol: "WebSocket (ручная реализация)"
file: "services/geminiLiveService.ts"
status: "❌ DEPRECATED (заменена на SDK live.connect())"
reason: "Проблемы с inputTranscription, заменена на SDK метод"
```

---

### 🎯 Активные модели (3 шт):
1. ✅ **gemini-2.5-flash-native-audio-preview-12-2025** - Live STT (Primary)
2. ✅ **gemini-2.5-flash** - Batch STT (Fallback)
3. ✅ **gemini-2.5-flash-preview-tts** - TTS (голос Kore)

### 🗑️ Deprecated модели (2 шт):
4. ⚠️ **gemini-2.0-flash-exp** - Legacy transcription helper
5. ❌ **gemini-2.5-flash-native-audio-dialog** - Old WebSocket Live API

**🎯 КРИТИЧЕСКОЕ ОБНОВЛЕНИЕ**: Проект переведен на **Gemini Live API** для real-time транскрипции!

**Новый подход:**
- **WebSocket connection** к `wss://generativelanguage.googleapis.com/ws/...`
- **Streaming audio** (16kHz PCM) напрямую в Live API
- **Real-time transcript** отображается в UI мгновенно
- **Низкая задержка** (~100-300ms вместо 1-2 секунд)

**Старый подход (fallback):**
- Batch mode: запись → WAV → upload → транскрипция
- Используется только если Live API недоступен

---

## 🔄 Полный Flow: Tap to Speak → Real-time Transcription

### 1️⃣ Пользователь нажимает "Tap to Speak"

```
👆 User Click
   ↓
App.tsx:handleMicButton()
   ├─ requestMicPermission() ← Запрос доступа к микрофону
   ├─ Проверка appState
   └─ runVoiceConversation()
```

### 2️⃣ Начало записи и подключение Live API

```
runVoiceConversation()
   ├─ voiceService.startAudioAnalysis()
   │   ├─ AudioContext создаётся (24kHz)
   │   ├─ AnalyserNode для визуализации
   │   └─ MediaStream подключается
   ├─ setAppState(LISTENING)
   │   └─ UI: "Tap to Speak" → "Stop"
   └─ voiceService.listen()
       ↓
       └─ listenWithLiveAPI() 🚀 NEW!
```

### 3️⃣ Gemini Live API Real-time Streaming 🚀

#### 🔴 Метод NEW: Gemini Live API (Primary)
```typescript
listenWithLiveAPI()
   ├─ liveService.connect() ← WebSocket к Live API
   │   ├─ ws: wss://generativelanguage.googleapis.com/ws/...
   │   ├─ Send setup message: { model: "gemini-live-2.5-flash-native-audio" }
   │   └─ Wait for setupComplete
   ├─ liveService.startStreaming()
   │   ├─ getUserMedia({ audio: { sampleRate: 16000, channels: 1 } })
   │   ├─ AudioContext(16kHz)
   │   ├─ ScriptProcessor(4096, 1, 1)
   │   └─ onaudioprocess:
   │       ├─ Float32 → Int16 PCM conversion
   │       ├─ ArrayBuffer → base64
   │       └─ ws.send({ realtimeInput: { mediaChunks: [...] } })
   └─ onTranscript callback:
       ├─ Накапливает транскрипт: liveTranscript += text
       ├─ UI update: setRealtimeTranscript(text) 🎯
       └─ Real-time display в синей карточке
```

**✅ Преимущества:**
- **Мгновенная транскрипция** (~100-300ms latency)
- **Real-time UI feedback** (пользователь видит свои слова сразу)
- **Streaming protocol** (не ждём окончания записи)
- **Лучшая точность** (native audio model)

#### 📦 Метод FALLBACK: Batch mode (если Live API недоступен)

**Метод A: Web Speech API** (браузерный, ненадёжный)
```typescript
listenWithWebSpeech()
   ├─ new SpeechRecognition()
   ├─ recognition.lang = 'ru-RU'
   ├─ recognition.start()
   └─ onresult → transcript
```

**Проблема**: В Telegram Mini Apps Web Speech API часто не работает!

**Метод B: Gemini Batch STT** (старый способ)
```typescript
listenWithGemini()
   ├─ requestMicrophoneAccess()
   │   └─ getUserMedia({ audio: true })
   ├─ createScriptProcessor(4096, 1, 1)
   │   └─ onaudioprocess → захватывает Float32Array chunks
   ├─ isRecording = true
   └─ Ждёт stopListening()
```

### 4️⃣ Пользователь нажимает "Stop"

```
👆 User Click "Stop"
   ↓
App.tsx:handleMicButton() (appState === LISTENING)
   ├─ voiceService.stopListening() ✅
   ├─ voiceService.stopAudioAnalysis()
   ├─ setAnalyser(null)
   └─ setAppState(PROCESSING) ✅
       ↓
voiceService.stopListening() 🚀 ОБНОВЛЕНО
   ├─ IF Live API:
   │   ├─ liveService.stopStreaming()
   │   ├─ scriptProcessor.disconnect()
   │   ├─ mediaStream.getTracks().stop()
   │   ├─ Return accumulated: liveTranscript.trim()
   │   └─ Clear UI: setRealtimeTranscript("")
   │
   └─ IF Batch mode:
       ├─ isRecording = false
       ├─ scriptProcessor.disconnect()
       └─ processRecordedAudio()
```

### 5️⃣ Обработка аудио

```
processRecordedAudio()
   ├─ Combine Float32Array chunks
   │   └─ totalLength = Σ chunks.length
   ├─ Calculate duration = totalLength / sampleRate
   ├─ Check: duration >= 1.5s ✅ ИСПРАВЛЕНО (было 0.5s)
   ├─ float32ToWav(samples, sampleRate)
   │   ├─ Create WAV header (RIFF, fmt, data)
   │   ├─ Convert Float32 → Int16 PCM
   │   └─ Return Uint8Array (WAV file)
   ├─ encode(wavData) → base64
   └─ transcribeWithGemini(base64Audio)
```

### 6️⃣ Транскрипция (2 режима)

#### 🚀 Live API Mode (Real-time WebSocket)

```typescript
// Транскрипция происходит в реальном времени!
WebSocket.onmessage = (event) => {
   const message = JSON.parse(event.data);
   
   if (message.serverContent) {
      message.serverContent.modelTurn.parts.forEach(part => {
         if (part.text) {
            // 📝 Real-time transcript chunk
            liveTranscript += part.text + " ";
            
            // 🎯 Instant UI update
            setRealtimeTranscript(liveTranscript);
         }
      });
   }
}
```

**Особенности:**
- Транскрипт приходит **частями** в реальном времени
- **Не нужно ждать** окончания записи
- **Мгновенная обратная связь** для пользователя
- **Streaming protocol** через WebSocket

#### 📦 Batch Mode (Old, Fallback)

```typescript
transcribeWithGemini(base64Audio)
   ├─ ai.models.generateContent({
   │   model: "gemini-2.5-flash",  // ✅ Batch model
   │   contents: [{
   │     parts: [
   │       {
   │         inlineData: {
   │           mimeType: "audio/wav",  // ✅ WAV формат
   │           data: base64Audio
   │         }
   │       },
   │       {
   │         text: "Транскрибируй это аудио..."  // ✅ Русский промпт
   │       }
   │     ]
   │   }]
   │ })
   ├─ response.candidates[0].content.parts[0].text
   └─ return transcript
```

**Особенности:**
- Ждём **полную запись** аудио
- Конвертация в WAV → base64 → upload
- Задержка **1-2 секунды**
- Используется только как **fallback**

### 7️⃣ Обработка результата

```
runVoiceConversation() получает transcript
   ├─ stopAudioAnalysis()
   ├─ setAnalyser(null)
   ├─ if (!transcript) → setAppState(IDLE)
   └─ if (transcript) → processQuery(transcript, 'voice')
       ├─ Добавляет в UI: {role: 'user', text: transcript}
       ├─ sendQueryToN8n(transcript)
       ├─ Получает ответ от AI
       ├─ Добавляет в UI: {role: 'model', text: response}
       └─ voiceService.speak(response) → TTS озвучка
```

---

## ❌ Проблемы и решения

### 🐛 Проблема #1: Кнопка "Stop" не работала

**Симптом**: После нажатия "Stop" UI остаётся в состоянии "Listening", visualizer продолжает работать.

**Причина**:
```typescript
// ❌ БЫЛО:
if (appState === AppState.LISTENING) {
   voiceService.stopListening();
   return;  // ← state не сбрасывался!
}
```

**Решение**:
```typescript
// ✅ ИСПРАВЛЕНО:
if (appState === AppState.LISTENING) {
   voiceService.stopListening();
   voiceService.stopAudioAnalysis();  // ← остановить analyser
   setAnalyser(null);                 // ← убрать visualizer
   setAppState(AppState.PROCESSING);  // ← сменить state
   tg?.HapticFeedback.impactOccurred('medium');
   return;
}
```

---

### 🐛 Проблема #2: Аудио не распознаётся (слишком короткое)

**Симптом**: Пользователь говорит, но транскрипция пустая.

**Причина**: Минимальная длительность была 0.5s, что недостаточно для Gemini API.

```typescript
// ❌ БЫЛО:
if (durationSec < 0.5) {
  return "";
}
```

**Решение**:
```typescript
// ✅ ИСПРАВЛЕНО:
if (durationSec < 1.5) {  // ← увеличили до 1.5s
  console.log(`⚠️ Audio too short (${durationSec.toFixed(2)}s < 1.5s)`);
  console.log("💡 Please speak for at least 1.5 seconds");
  return "";
}
```

**Рекомендации пользователю**:
- Говорить минимум 1.5-2 секунды
- Чётко произносить слова
- Избегать фонового шума

---

### 🐛 Проблема #3: Нет обработки ошибок API

**Симптом**: При ошибке API (quota exceeded, wrong key) пользователь видит просто пустой ответ.

**Причина**: Ошибки логировались, но не отображались пользователю.

```typescript
// ❌ БЫЛО:
catch (error) {
  console.error("Error:", error);
  throw error;  // ← но в listen() возвращается ""
}
```

**Решение**:
```typescript
// ✅ ИСПРАВЛЕНО:
catch (error: any) {
  console.error("❌ [Gemini API] Error:", error);
  
  // User-friendly error messages
  if (error?.message?.includes('API_KEY')) {
    console.error("❌ API Key error: Check DEFAULT_GEMINI_API_KEY");
  } else if (error?.status === 429) {
    console.error("❌ Rate limit exceeded");
  } else if (error?.status === 403) {
    console.error("❌ Permission denied: Check API key permissions");
  }
  
  throw error;
}
```

---

## 📊 Сравнение моделей и режимов

| Задача | Модель | Режим | Задержка | Результат |
|--------|--------|-------|----------|-----------|
| **STT Real-time** 🚀 | `gemini-2.5-flash-native-audio-preview-12-2025` | WebSocket streaming | ~100-300ms | Real-time транскрипт |
| **STT Batch** 📦 | `gemini-2.5-flash` | REST API (fallback) | ~1-2s | Финальный текст |
| **TTS** 🔊 | `gemini-2.5-flash-preview-tts` (voice: Kore) | REST API | ~800ms | Аудио (PCM 24kHz) |

### 🚀 НОВАЯ АРХИТЕКТУРА: Live API + Specialized TTS

```typescript
// 🎤 STT PRIMARY: Real-time streaming (распознавание речи)
model: "gemini-2.5-flash-native-audio-preview-12-2025"
protocol: "WebSocket"
latency: "~100-300ms"
features: ["real-time transcript", "streaming", "barge-in", "affective dialog"]

// 📦 STT FALLBACK: Batch mode
model: "gemini-2.5-flash"
protocol: "REST API"
latency: "~1-2s"
features: ["single request", "WAV upload"]

// 🔊 TTS: Text-to-Speech (озвучка ответов)
model: "gemini-2.5-flash-preview-tts"
voice: "Kore" (Russian-optimized, female)
protocol: "REST API"
latency: "~800ms"
features: ["natural speech", "emotional tone", "24kHz PCM output"]
```

### ⚠️ КРИТИЧНО: НЕ использовать TTS модель для STT!

```typescript
// ❌ НЕПРАВИЛЬНО:
model: "gemini-2.5-flash-preview-tts"  // Только для генерации речи!

// ✅ ПРАВИЛЬНО для STT:
model: "gemini-live-2.5-flash-native-audio"  // Live API (primary)
model: "gemini-2.5-flash"  // Batch mode (fallback)
```

---

## 🎯 Поддерживаемые форматы аудио

### Для Gemini API:
✅ **WAV** (audio/wav) ← Используется в проекте  
✅ MP3 (audio/mp3)  
✅ FLAC (audio/flac)  
✅ OGG Vorbis (audio/ogg)  
✅ AAC (audio/aac)  
✅ AIFF (audio/aiff)  

### Текущая конфигурация:
```typescript
{
  inlineData: {
    mimeType: "audio/wav",  // ✅
    data: base64Audio       // ✅ base64-encoded WAV
  }
}
```

---

## 🔧 Технические детали

### AudioContext конфигурация
```typescript
new AudioContext({ sampleRate: 24000 })  // Для TTS (вывод)
getUserMedia({ audio: { sampleRate: 16000 } })  // Для STT (ввод)
```

### ScriptProcessor (STT запись)
```typescript
createScriptProcessor(
  4096,  // bufferSize (samples)
  1,     // inputChannels
  1      // outputChannels
)
```

**Производительность**:
- 1 chunk = 4096 samples
- При 16kHz: 4096 / 16000 = 0.256s на chunk
- 10 chunks ≈ 2.56s аудио
- Логирование каждые 10 chunks (~1s реального времени)

### WAV формат
```
WAV Header (44 bytes):
├─ RIFF chunk (12 bytes)
├─ fmt chunk (24 bytes)
└─ data chunk (8 bytes header + PCM data)

PCM Data:
├─ Sample rate: 16000 Hz (или sampleRate AudioContext)
├─ Channels: 1 (mono)
├─ Bits per sample: 16
└─ Format: PCM (Linear PCM, no compression)
```

---

## 🚀 Оптимизации

### Выполнено:
✅ Кэширование MediaStream (избегаем повторных разрешений)  
✅ Минимальная длительность 1.5s (фильтруем шум)  
✅ Детальное логирование для отладки  
✅ Graceful degradation (Web Speech → Gemini)  

### Планируется:
🔄 Показывать таймер записи в UI  
🔄 Toast/Alert при ошибках API  
🔄 Retry логика для временных ошибок  
🔄 Streaming транскрипция (real-time feedback)  

---

## 📝 Промпт для Gemini STT

```typescript
"Транскрибируй это аудио. Верни ТОЛЬКО текст того, что было сказано на русском языке, без пояснений и комментариев. Если речь не распознана или аудио пустое, верни пустую строку."
```

### Улучшенный промпт (опционально):
```typescript
`Пожалуйста, создайте подробную транскрибацию этого русскоязычного аудио.

Требования:
1. Транскрибируйте полный текст на русском языке
2. Используйте правильную пунктуацию
3. Если несколько говорящих, разделяйте их (Говорящий 1:, Говорящий 2:)
4. Обращайте внимание на:
   - Правильное ударение в словах
   - Спряжение глаголов
   - Род и число существительных
   - Русские идиоматические выражения`
```

---

## 🚀 Gemini Live API: Техническая документация

### WebSocket Protocol

**Endpoint:**
```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=YOUR_API_KEY
```

### Формат сообщений

#### 1. Setup Message (Client → Server)
```json
{
  "setup": {
    "model": "models/gemini-live-2.5-flash-native-audio"
  }
}
```

#### 2. Real-time Input (Client → Server)
```json
{
  "realtimeInput": {
    "mediaChunks": [
      {
        "mimeType": "audio/pcm",
        "data": "<base64-encoded PCM 16kHz mono Int16>"
      }
    ]
  }
}
```

#### 3. Server Content (Server → Client)
```json
{
  "serverContent": {
    "modelTurn": {
      "parts": [
        {
          "text": "транскрибированный текст"
        }
      ]
    },
    "turnComplete": false
  }
}
```

### Аудио спецификации

| Параметр | Значение | Обязательно |
|----------|----------|-------------|
| Format | Raw PCM (Int16) | ✅ |
| Sample Rate | 16000 Hz | ✅ |
| Channels | 1 (mono) | ✅ |
| Encoding | Little-endian | ✅ |
| Chunk Size | 4096 samples (~256ms) | Recommended |
| MIME Type | `audio/pcm` | ✅ |

### Преимущества Live API

1. **Ultra-low latency**: ~100-300ms вместо 1-2s
2. **Real-time feedback**: пользователь видит транскрипт мгновенно
3. **Streaming protocol**: не нужно ждать окончания записи
4. **Native audio model**: лучшая точность распознавания
5. **Affective Dialog**: понимание эмоций и интонации
6. **Multilingual**: автоматическое определение языка
7. **Barge-in**: можно прерывать модель в любой момент

### Сравнение: Live API vs Batch Mode

| Характеристика | Live API 🚀 | Batch Mode 📦 |
|----------------|-------------|---------------|
| Protocol | WebSocket | REST API |
| Latency | ~100-300ms | ~1-2s |
| UI Feedback | Real-time | После записи |
| Audio Format | PCM streaming | WAV upload |
| Max Duration | 10+ minutes | Limited by file size |
| Connection | Persistent | Request/Response |
| Complexity | Medium | Simple |

### Обработка ошибок Live API

```typescript
// WebSocket errors
ws.onerror = (error) => {
   // Network issues, invalid URL, auth failure
   console.error("WebSocket error:", error);
   // → Fallback to batch mode
};

ws.onclose = (event) => {
   // Connection closed (normal or abnormal)
   console.log("Closed:", event.code, event.reason);
   // → Reconnect or fallback
};

// Message parsing errors
try {
   const message = JSON.parse(event.data);
} catch (error) {
   console.error("Invalid JSON:", error);
}
```

## 🔍 Отладка

### Как проверить работу Live API:

1. **Откройте консоль браузера** (F12)
2. **Нажмите "Tap to Speak"**
3. **Смотрите логи Live API**:

```
🎤 [Button] handleMicButton() clicked, current state: idle
🎙️ [Flow] runVoiceConversation() started
📊 [Flow] Audio analysis ready: 45ms
🎤 [STT] listen() called at 2025-12-16T...
🎤 [STT] Using Gemini Live API (real-time streaming)
🔴 [Live API] Starting real-time streaming...
🔌 [Live API] Connecting to Gemini Live API...
✅ [Live API] WebSocket connected
📤 [Live API] Setup message sent
✅ [Live API] Setup complete
✅ [Live API] Connected and ready
🎤 [Live API] Requesting microphone access...
✅ Microphone access granted, stream cached
✅ [Live API] Streaming started
📝 [Live API] Real-time transcript: "привет"
📝 [Live API] Real-time transcript: "привет как"
📝 [Live API] Real-time transcript: "привет как дела"
```

4. **Наблюдайте в UI**: Синяя карточка с real-time транскриптом

5. **Нажмите "Stop"**

```
🛑 [Button] Currently listening, stopping...
⏹️ [Stop] stopListening() called
⏹️ [Stop] Stopping Live API streaming...
✅ [Stop] Live API transcript: "привет как дела"
✅ [STT] Live API completed in 2145ms, result: "привет как дела"
```

### Fallback на Batch Mode (если Live API недоступен):

```
🎤 [STT] Using Gemini Live API (real-time streaming)
❌ [STT] Live API failed, falling back to batch mode: WebSocket connection failed
🎤 [STT] Trying Web Speech API first...
🎤 [STT] Web Speech API returned empty, falling back to Gemini
🎤 [STT] Starting Gemini STT (batch mode)...
🎙️ [Gemini STT] listenWithGemini() started
🎙️ [Gemini STT] AudioContext prepared in 45ms
🎙️ [Gemini STT] Microphone access took 12ms
🎙️ [Gemini STT] Recording setup complete - NOW RECORDING...
```

### Типичные ошибки:

```
❌ Audio too short (0.8s < 1.5s)
→ Говорите дольше!

❌ API Key error: Check DEFAULT_GEMINI_API_KEY
→ Проверьте .env.local или vite.config.ts

❌ Rate limit exceeded
→ Превышен лимит запросов к API

❌ Permission denied: Check API key permissions
→ API ключ не имеет прав на Gemini API
```

---

## 🎯 Итоги

### ✅ Что работает (NEW Architecture!):
1. **Модель STT**: `gemini-2.5-flash-native-audio-preview-12-2025` 🚀 (Live API)
2. **Модель TTS**: `gemini-2.5-flash-preview-tts` 🔊 (voice: Kore, Russian)
3. **Протокол**: WebSocket streaming для real-time транскрипции ✅
4. **Real-time UI**: Мгновенное отображение текста в синей карточке ✅
5. **Формат аудио**: PCM 16kHz mono → streaming chunks (input), PCM 24kHz (output) ✅
6. **Fallback цепочка**: Live API → Web Speech → Gemini Batch ✅
7. **Debug Panel**: Видимые логи в UI для отладки в Telegram Mini Apps ✅
8. **Транскрипт в чате**: Текст пользователя отображается перед обработкой ✅

### 🔧 Исправлено ранее:
1. **Кнопка Stop**: Правильно останавливает запись и сбрасывает UI ✅
2. **Минимальная длительность**: 1.5s для batch mode ✅
3. **Обработка ошибок**: Детальные сообщения для всех типов ошибок ✅
4. **Микрофон в Telegram**: Simplified constraints + auto-switch to text ✅

### 🚀 НОВЫЕ ВОЗМОЖНОСТИ (Live API):
1. **Real-time транскрипция** - текст появляется мгновенно ✅
2. **WebSocket streaming** - низкая задержка (~100-300ms) ✅
3. **Affective Dialog** - понимание эмоций ✅
4. **Barge-in support** - можно прерывать модель ✅
5. **Multilingual** - автоматическое переключение языков ✅

### 📈 Будущие улучшения:
1. ~~Streaming транскрипция (real-time)~~ ✅ РЕАЛИЗОВАНО!
2. Таймер записи в UI
3. Toast уведомления для ошибок
4. Retry логика для WebSocket reconnection
5. Voice activity detection (VAD) для автостопа

**Последнее обновление**: 16 декабря 2025  
**Версия**: 1.4.1 (ветка `gemini`)  

**Архитектура (5 моделей, 3 активных):**
- **STT Primary**: `gemini-2.5-flash-native-audio-preview-12-2025` (SDK live.connect(), real-time)
- **STT Fallback**: `gemini-2.5-flash` (REST API, batch mode)
- **TTS**: `gemini-2.5-flash-preview-tts` (REST API, voice: Kore)
- **Legacy**: `gemini-2.0-flash-exp` (deprecated transcription helper)
- **Legacy**: `gemini-2.5-flash-native-audio-dialog` (deprecated WebSocket model)

**Дополнительно:**
- **Permission Manager**: MicrophoneManager (Telegram Storage API + localStorage)
- **Debug Panel**: UI логирование для Telegram Mini Apps
- **Fallback Chain**: Live API → Web Speech API → Batch Gemini
