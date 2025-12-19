# CHANGELOG - История изменений VoxLux

## [1.0.4] - 2025-12-19

### 🎯 Критическое исправление: Повторные запросы разрешения микрофона

#### Проблема
В Telegram Mini App на мобильных устройствах браузер запрашивал разрешение на микрофон **при каждом использовании** в рамках одной сессии. Это сильно ухудшало UX, так как пользователь вынужден был постоянно подтверждать доступ к микрофону.

#### Решение: Централизованное кэширование аудио потока

**Основные изменения:**

1. **MicrophoneManager - кэширование потока** (`services/microphoneManager.ts`)
   - ✅ Добавлено кэширование `MediaStream` - поток запрашивается **один раз** за сессию
   - ✅ Реализован `getAudioStream()` - возвращает кэшированный поток без повторных запросов
   - ✅ Добавлен `getAudioStreamWithRetry()` - retry-механизм с 3 попытками
   - ✅ Реализован `initializeAudioRecording()` - переиспользование AudioContext
   - ✅ Добавлена интеграция с Telegram Web App SDK (события viewport, popup, beforeunload)
   - ✅ Добавлен `checkMicrophonePermission()` - проверка через Permissions API перед запросом
   - ✅ Методы `pauseRecording()` и `cleanupAudio()` для правильного управления жизненным циклом

2. **Обновлены все сервисы использующие микрофон**
   - ✅ `VoiceService` - теперь использует `microphoneManager.getAudioStream()`
   - ✅ `LiveTranscriptionService` - получает поток из MicrophoneManager
   - ✅ `GeminiLiveService` - получает поток из MicrophoneManager
   - ✅ `GeminiService` - получает поток из MicrophoneManager

3. **Убраны прямые вызовы `getUserMedia()`**
   - ❌ Все прямые вызовы `navigator.mediaDevices.getUserMedia()` заменены на централизованный метод
   - ✅ Теперь поток запрашивается **один раз** и переиспользуется

#### Результат
- 🎉 **Один запрос разрешения** вместо множественных
- ⚡ **Мгновенное переключение** между режимами записи
- 📱 **Работает на iOS, Android, Desktop**
- 🔄 **Retry-механизмы** при сбоях
- 💾 **Экономия ресурсов** через переиспользование AudioContext

**Файлы с изменениями:**
- `services/microphoneManager.ts` - основная логика кэширования
- `services/voiceService.ts` - использование централизованного потока
- `services/liveTranscriptionService.ts` - использование централизованного потока
- `services/geminiLiveService.ts` - использование централизованного потока
- `services/geminiService.ts` - использование централизованного потока

**Документация:**
- `MICROPHONE_PERMISSION_FIX.md` - детальное описание решения
- `MICROPHONE_USAGE_GUIDE.md` - инструкция для разработчиков

#### Тестирование
1. Откройте приложение в Telegram на мобильном
2. Дайте разрешение на микрофон при первом запросе
3. Запишите несколько голосовых сообщений
4. ✅ **Разрешение больше не должно запрашиваться**

---

## [1.0.3] - 2025-12-15

### Исправлено (Bugfixes)

#### 1. Чёрный экран после деплоя - отсутствие API ключа Gemini
**Файлы:** `vite.config.ts`, `.github/workflows/azure-static-web-apps-salmon-forest-009edfa10.yml`

**Проблема:** После деплоя приложение показывало чёрный экран, потому что:
1. В `vite.config.ts` читалась переменная `GEMINI_API_KEY`, но в `.env` ключ назывался `API_KEY`
2. В GitHub Actions workflow не передавалась переменная окружения при сборке

**Решение:** 
- `vite.config.ts`: Добавлен fallback `env.GEMINI_API_KEY || env.API_KEY`
- Workflow: Добавлена передача `GEMINI_API_KEY` и `API_KEY` из GitHub Secrets

**Важно:** Необходимо добавить секрет `GEMINI_API_KEY` в GitHub Repository Settings → Secrets

---

## [1.0.2] - 2025-12-15

### Исправлено (Bugfixes)

#### 1. Дублирование `export default App`
**Файл:** `App.tsx`

**Проблема:** В файле было два `export default App`, что вызывало ошибку сборки:
```
ERROR: Multiple exports with the same name "default"
```

**Решение:** Удалён дублирующий экспорт.

---

## [1.0.1] - 2025-12-15

### Исправлено (Bugfixes)

#### 1. Отсутствующий экспорт `voiceService`
**Файл:** services/voiceService.ts

**Проблема:** Класс VoiceService был объявлен, но экземпляр не экспортировался. Это приводило к ошибке импорта в App.tsx:
```
import { voiceService } from './services/voiceService';
//  Error: voiceService is not exported
```

**Решение:** Добавлен экспорт экземпляра класса в конец файла:
```typescript
export const voiceService = new VoiceService();
```

---

#### 2. Отсутствующий export default App
**Файл:** App.tsx

**Проблема:** Компонент App был объявлен как const App: React.FC, но не экспортировался по умолчанию. Это приводило к ошибке при импорте в index.tsx:
```
import App from './App';
//  Error: Module has no default export
```

**Решение:** Добавлен экспорт по умолчанию в конец файла:
```typescript
export default App;
```

---

## Статус проекта после исправлений

 Все критические ошибки исправлены  
 Приложение готово к запуску  
 Код соответствует документации в TECHNICAL_DOCS.md
