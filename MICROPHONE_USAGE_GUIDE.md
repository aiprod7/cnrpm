# Краткая инструкция: Использование обновленного MicrophoneManager

## Для разработчиков

### Получение аудио потока в сервисах

**Старый способ (❌ НЕ использовать)**:
```typescript
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
```

**Новый способ (✅ использовать)**:
```typescript
import { microphoneManager } from './microphoneManager';

// Простое получение потока
const stream = await microphoneManager.getAudioStream({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 16000,
  channelCount: 1
});

if (!stream) {
  throw new Error('Failed to get audio stream');
}
```

**С повторными попытками**:
```typescript
const stream = await microphoneManager.getAudioStreamWithRetry(3, {
  sampleRate: 16000
});
```

**Web Audio API**:
```typescript
const audioSetup = await microphoneManager.initializeAudioRecording();
if (audioSetup) {
  const { audioContext, mediaSource, stream } = audioSetup;
  // Используем audioContext и mediaSource
}
```

### Инициализация в компоненте

```typescript
import { microphoneManager } from './services/microphoneManager';

useEffect(() => {
  const initMicrophone = async () => {
    const granted = await microphoneManager.initialize();
    if (granted) {
      console.log('✅ Microphone permission granted');
    } else {
      console.error('❌ Microphone permission denied');
    }
  };
  
  initMicrophone();
  
  // Очистка при размонтировании компонента (НЕ вызывать при обычных переключениях!)
  return () => {
    // microphoneManager.cleanupAudio(); // Только при полном выходе из приложения
  };
}, []);
```

### Проверки состояния

```typescript
// Проверка разрешения
if (microphoneManager.isReady()) {
  console.log('Microphone ready to use');
}

// Проверка активности потока
if (microphoneManager.isStreamActive()) {
  console.log('Audio stream is active');
}

// Проверка статуса разрешения через API
const status = await microphoneManager.checkMicrophonePermission();
// status: 'granted' | 'denied' | 'prompt' | null
```

### Управление потоком

```typescript
// Приостановка записи (поток остается активным)
microphoneManager.pauseRecording();

// Полная очистка (только при выходе из приложения)
microphoneManager.cleanupAudio();

// Сброс разрешения (для тестирования)
microphoneManager.clearPermission();
```

## Важные заметки

### ✅ ДО (правильно):
- Вызывать `getAudioStream()` каждый раз при необходимости
- Возвращается кэшированный поток - нет повторных запросов
- Вызывать `pauseRecording()` при остановке записи
- Вызывать `cleanupAudio()` только при `beforeunload`

### ❌ НЕ ДЕЛАТЬ:
- ❌ НЕ вызывать `stream.getTracks().forEach(track => track.stop())` во время сессии
- ❌ НЕ вызывать `cleanupAudio()` при переключении между режимами
- ❌ НЕ создавать новый AudioContext каждый раз
- ❌ НЕ вызывать `navigator.mediaDevices.getUserMedia()` напрямую

## Примеры использования

### Пример 1: Запись голоса
```typescript
async function startVoiceRecording() {
  // Получаем поток (из кэша или создаем новый)
  const stream = await microphoneManager.getAudioStream();
  
  if (!stream) {
    console.error('No audio stream available');
    return;
  }
  
  // Используем поток для записи
  const mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.start();
  
  // ... запись ...
  
  // Остановка без закрытия потока
  mediaRecorder.stop();
  microphoneManager.pauseRecording(); // Поток остается активным!
}
```

### Пример 2: Live транскрипция
```typescript
async function startLiveTranscription() {
  const audioSetup = await microphoneManager.initializeAudioRecording();
  
  if (!audioSetup) {
    throw new Error('Audio initialization failed');
  }
  
  const { audioContext, mediaSource, stream } = audioSetup;
  
  // Создаем processor
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  mediaSource.connect(processor);
  processor.connect(audioContext.destination);
  
  processor.onaudioprocess = (event) => {
    const inputData = event.inputBuffer.getChannelData(0);
    // Обрабатываем аудио данные
  };
  
  // Остановка
  processor.disconnect();
  microphoneManager.pauseRecording(); // Контекст и поток остаются!
}
```

### Пример 3: Обработка ошибок
```typescript
async function safeGetMicrophone() {
  try {
    // Проверяем разрешение
    const status = await microphoneManager.checkMicrophonePermission();
    
    if (status === 'denied') {
      console.error('Microphone permission denied');
      alert(microphoneManager.getPermissionInstructions());
      return null;
    }
    
    // Получаем поток с retry
    const stream = await microphoneManager.getAudioStreamWithRetry(3);
    
    if (!stream) {
      throw new Error('Failed to get audio stream after 3 attempts');
    }
    
    return stream;
  } catch (error) {
    console.error('Microphone error:', error);
    return null;
  }
}
```

## FAQ

**Q: Как часто можно вызывать `getAudioStream()`?**  
A: Сколько угодно! Метод возвращает кэшированный поток, не создавая новые запросы.

**Q: Когда вызывать `cleanupAudio()`?**  
A: Только при полном выходе из приложения (`beforeunload` событие).

**Q: Что делать при ошибке "NotReadableError"?**  
A: Используйте `getAudioStreamWithRetry()` с несколькими попытками.

**Q: Будет ли работать на iOS?**  
A: Да! Решение протестировано на iOS, Android и Desktop.

**Q: Как сбросить разрешение для тестирования?**  
A: Вызовите `microphoneManager.clearPermission()`.
