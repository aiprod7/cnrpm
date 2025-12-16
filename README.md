<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# VoxLux - Голосовой ассистент с Google Gemini

[![Version](https://img.shields.io/badge/version-1.4.0-blue.svg)](https://github.com/aiprod7/cnrpm)
[![Branch](https://img.shields.io/badge/branch-gemini-green.svg)](https://github.com/aiprod7/cnrpm/tree/gemini)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)

VoxLux — это современный голосовой ассистент с **потоковой транскрибацией в реальном времени** через **Gemini Live API** (native audio mode). Приложение использует последние модели Google Gemini для STT и TTS, работает как Telegram Mini App с интеллектуальным кешированием разрешений микрофона.

> **Текущая версия**: v1.4.0 (ветка `gemini`)  
> 🎉 **Новое**: Нативный аудио-режим с минимальной задержкой транскрибации!  
> Для OpenRouter версии переключитесь на ветку [`main`](https://github.com/aiprod7/cnrpm/tree/main)

## 🎤 Возможности

- **🎙️ Потоковая транскрибация в реальном времени**: Использует **Gemini Live API** с моделью `gemini-2.5-flash-native-audio-preview` для минимальной задержки STT
- **🔊 Синтез речи (TTS)**: Генерирует естественную речь через **Gemini 2.5 Flash Preview TTS** с голосом **Kore**
- **📱 Telegram Mini App**: Нативная интеграция с Telegram для мобильных устройств
- **🔐 Интеллектуальное кеширование**: MicrophoneManager предотвращает повторные запросы доступа к микрофону (Telegram Storage API + localStorage)
- **⚡ Двухрежимный ввод**: Голосовой (Live API) и текстовый режимы общения
- **🎨 Визуализатор звука**: Динамическая анимация во время записи и воспроизведения
- **🔗 N8N интеграция**: Подключение к внешним workflow через n8n

## 🚀 Быстрый старт

### Требования

- Node.js 16+
- Google Gemini API ключ ([получить здесь](https://aistudio.google.com/apikey))

### Локальная установка

1. **Клонировать репозиторий**:
   ```bash
   git clone https://github.com/aiprod7/cnrpm.git
   cd cnrpm
   git checkout gemini
   ```

2. **Установить зависимости**:
   ```bash
   npm install
   ```

3. **Настроить API ключ** (выберите один из способов):

   **Способ 1: Через переменные окружения (рекомендуется)**
   
   Создайте файл `.env.local` в корне проекта:
   ```env
   GEMINI_API_KEY=ваш_api_ключ_здесь
   ```

   **Способ 2: Через конфигурацию**
   
   Откройте `vite.config.ts` и замените дефолтный ключ на свой:
   ```typescript
   'process.env.DEFAULT_GEMINI_API_KEY': JSON.stringify('ваш_api_ключ_здесь')
   ```

   **Способ 3: Для GitHub Actions (деплой)**
   
   Добавьте секрет `DEFAULT_GEMINI_API_KEY` в настройках репозитория:
   - GitHub → Settings → Secrets and variables → Actions
   - New repository secret: `DEFAULT_GEMINI_API_KEY`

4. **Запустить приложение**:
   ```bash
   npm run dev
   ```

   Откройте [http://localhost:3000](http://localhost:3000)

## 📦 Деплой

### Azure Static Web Apps (автоматический)

Проект настроен для автоматического деплоя через GitHub Actions при пуше в ветку `gemini`.

1. Добавьте секрет `DEFAULT_GEMINI_API_KEY` в GitHub (см. выше)
2. Сделайте push в ветку `gemini`:
   ```bash
   git push origin gemini
   ```
3. GitHub Actions автоматически соберёт и задеплоит приложение

### Ручная сборка

```bash
npm run build
```

Статические файлы будут в папке `dist/`.

## 🔧 Конфигурация

### Модели Gemini

**STT (Speech-to-Text)**:
- Модель: `gemini-2.5-flash-native-audio-preview`
- Метод: SDK `live.connect()` через Live API
- Частота: 16kHz PCM
- Задержка: Минимальная (real-time streaming)
- Сервис: `services/liveTranscriptionService.ts`

**TTS (Text-to-Speech)**:
- Модель: `gemini-2.5-flash-preview-tts`
- Голос: **Kore** (женский, чёткий голос)
- Формат: 24kHz PCM

Для смены голоса откройте `services/voiceService.ts` и измените `voiceName`:

```typescript
speechConfig: {
  voiceConfig: {
    prebuiltVoiceConfig: { voiceName: 'Puck' }, // или другой голос
  },
}
```

Доступные голоса: Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe, Enceladus, Iapetus и другие ([полный список](https://ai.google.dev/gemini-api/docs/speech-generation?hl=ru#voice-options)).

### N8N Backend

Для интеграции с n8n измените `constants.ts`:

```typescript
export const BACKEND_API_URL = 'https://your-n8n-instance.com/webhook/...';
export const USE_MOCK_BACKEND = false; // отключить моковый режим
```

## 🌿 Ветки проекта

Проект поддерживает две основные ветки для разных реализаций:

| Ветка | TTS Движок | STT Движок | API Ключ | Версия | Статус |
|-------|-----------|-----------|----------|--------|--------|
| **`gemini`** | Gemini 2.5 Flash TTS | **Gemini Live API (native-audio-preview)** | `DEFAULT_GEMINI_API_KEY` | v1.4.0 | ✅ Активная |
| **`main`** | Web Speech API | OpenRouter API | `OPENROUTER_API_KEY` | v0.5.0 | ✅ Стабильная |

**Подробная документация**: См. [BRANCHES.md](BRANCHES.md) для полной информации о структуре веток.

### Быстрое переключение:

```bash
# Gemini версия (текущая, лучшее качество TTS)
git checkout gemini
npm install && npm run dev

# OpenRouter версия (кросс-платформенная)
git checkout main
npm install && npm run dev
```

## 📖 Документация

- [Google Gemini TTS Documentation](https://ai.google.dev/gemini-api/docs/speech-generation?hl=ru)
- [Google Gemini API Key](https://aistudio.google.com/apikey)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)

## 🔑 Где вставить API ключ?

**Для локальной разработки:**
1. Создайте `.env.local` в корне проекта
2. Добавьте строку: `API_KEY=ваш_новый_api_ключ_из_google_ai_studio`

**Для деплоя на GitHub:**
1. Перейдите в Settings → Secrets → Actions
2. Создайте секрет `DEFAULT_GEMINI_API_KEY` со значением вашего ключа

**Для быстрого теста (НЕ рекомендуется для продакшена):**
1. Откройте `vite.config.ts`
2. Замените значение в строке `'process.env.DEFAULT_GEMINI_API_KEY'`

## 📝 Лицензия

MIT
