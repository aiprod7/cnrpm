# 🎤 Анализ Speech-to-Text (STT) в VoxLux

## ✅ Текущая конфигурация

### Модель для STT
```typescript
model: "gemini-2.5-flash"  // ✅ ПРАВИЛЬНО! (НЕ TTS модель)
```

**Важно**: Используется базовая модель `gemini-2.5-flash` для понимания аудио, а **НЕ** `gemini-2.5-flash-preview-tts` (которая только для генерации речи).

---

## 🔄 Полный Flow: Tap to Speak → Transcription

### 1️⃣ Пользователь нажимает "Tap to Speak"

```
👆 User Click
   ↓
App.tsx:handleMicButton()
   ├─ requestMicPermission() ← Запрос доступа к микрофону
   ├─ Проверка appState
   └─ runVoiceConversation()
```

### 2️⃣ Начало записи

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
```

### 3️⃣ Процесс распознавания (2 метода)

#### Метод A: Web Speech API (Fallback) ✅
```typescript
listenWithWebSpeech()
   ├─ new SpeechRecognition()
   ├─ recognition.lang = 'ru-RU'
   ├─ recognition.start()
   └─ onresult → transcript
```

**Проблема**: В Telegram Mini Apps Web Speech API часто не работает!

#### Метод B: Gemini Audio Understanding (Primary) ✅
```typescript
listenWithGemini()
   ├─ requestMicrophoneAccess()
   │   └─ getUserMedia({ audio: { sampleRate: 16000 } })
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
   ├─ voiceService.stopListening() ✅ ИСПРАВЛЕНО
   ├─ voiceService.stopAudioAnalysis()
   ├─ setAnalyser(null)
   └─ setAppState(PROCESSING) ✅ ИСПРАВЛЕНО
       ↓
voiceService.stopListening()
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

### 6️⃣ Gemini API Transcription

```typescript
transcribeWithGemini(base64Audio)
   ├─ ai.models.generateContent({
   │   model: "gemini-2.5-flash",  // ✅ Правильная модель!
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

## 📊 Сравнение моделей

| Задача | Используемая модель | Результат |
|--------|-------------------|-----------|
| **STT (аудио → текст)** | `gemini-2.5-flash` ✅ | Текст транскрипции |
| **TTS (текст → аудио)** | `gemini-2.5-flash-preview-tts` ✅ | Аудиофайл (PCM 24kHz) |
| **Live API (real-time)** | `gemini-2.5-flash-native-audio` | Streaming аудио |

### ⚠️ КРИТИЧНО: НЕ использовать TTS модель для STT!

```typescript
// ❌ НЕПРАВИЛЬНО:
model: "gemini-2.5-flash-preview-tts"  // Только для генерации речи!

// ✅ ПРАВИЛЬНО:
model: "gemini-2.5-flash"  // Для понимания аудио
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

## 🔍 Отладка

### Как проверить работу STT:

1. **Откройте консоль браузера** (F12)
2. **Нажмите "Tap to Speak"**
3. **Смотрите логи**:

```
🎤 [Button] handleMicButton() clicked, current state: idle
🎙️ [Flow] runVoiceConversation() started
📊 [Flow] Audio analysis ready: 123ms
🎤 [STT] listen() called at 2025-12-16T...
🎤 [STT] Trying Web Speech API first...
🎤 [STT] Web Speech API returned empty, falling back to Gemini
🎤 [STT] Starting Gemini STT...
🎙️ [Gemini STT] listenWithGemini() started
🎙️ [Gemini STT] AudioContext prepared in 45ms
🎙️ [Gemini STT] Microphone access took 12ms
🎙️ [Gemini STT] Recording setup complete - NOW RECORDING...
🎙️ [Recording] 1.0s recorded (10 chunks)
🎙️ [Recording] 2.0s recorded (20 chunks)
```

4. **Нажмите "Stop"**

```
🛑 [Button] Currently listening, stopping...
⏹️ [Stop] stopListening() called
⏹️ [Stop] Recording stopped: 20 chunks, ~2.05s audio
📤 [Process] processRecordedAudio() started
📤 [Process] Combined 20 chunks in 5ms
📤 [Process] Audio: 81920 samples, 2.05s duration, 40000Hz
📤 [Process] WAV conversion took 8ms, size: 160.5KB
📤 [Process] Base64 encoding took 3ms, size: 220.3KB
🤖 [Gemini API] Sending request to gemini-2.5-flash...
🤖 [Gemini API] Response received in 1245ms
✅ [Gemini API] Transcription complete in 1256ms, result: "ваш текст"
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

### ✅ Что работает правильно:
1. **Модель STT**: `gemini-2.5-flash` ✅
2. **Формат аудио**: WAV (PCM 16-bit, mono) ✅
3. **Промпт**: Оптимизирован для русского языка ✅
4. **Логирование**: Детальное для отладки ✅
5. **Fallback**: Web Speech API → Gemini ✅

### 🔧 Что исправлено:
1. **Кнопка Stop**: Теперь правильно останавливает запись и сбрасывает UI ✅
2. **Минимальная длительность**: 1.5s вместо 0.5s ✅
3. **Обработка ошибок**: Детальные сообщения в консоли ✅

### 🚀 Что можно улучшить:
1. Показывать таймер записи в UI
2. Toast уведомления при ошибках
3. Retry логика для временных ошибок API
4. Streaming транскрипция (real-time)

---

**Последнее обновление**: 16 декабря 2025  
**Версия**: 1.0.0 (ветка `gemini`)
