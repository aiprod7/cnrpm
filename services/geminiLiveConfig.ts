/**
 * Gemini Live API Configuration
 * 
 * Все настройки для STT (Speech-to-Text) и TTS (Text-to-Speech) режимов
 * модели gemini-2.5-flash-native-audio-preview-12-2025
 * 
 * Документация: https://ai.google.dev/gemini-api/docs/live-guide
 */

import { Modality, StartSensitivity, EndSensitivity } from "@google/genai";

// Реэкспортируем для удобства использования
export { StartSensitivity, EndSensitivity };

// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 ОСНОВНЫЕ МОДЕЛИ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Доступные модели Gemini Live API
 * 
 * gemini-2.5-flash-native-audio-preview-12-2025 - Native audio с Thinking
 * gemini-live-2.5-flash-preview - Базовая Live модель
 */
export const GEMINI_MODELS = {
  // ✅ Рекомендуемая: Native audio с поддержкой Thinking
  NATIVE_AUDIO: 'gemini-2.5-flash-native-audio-preview-12-2025',
  
  // Базовая Live модель (без native audio)
  LIVE_FLASH: 'gemini-live-2.5-flash-preview',
} as const;

// Текущая модель (измените здесь для смены модели)
export const CURRENT_MODEL = GEMINI_MODELS.NATIVE_AUDIO;

// ═══════════════════════════════════════════════════════════════════════════════
// 🎤 ГОЛОСА TTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Доступные голоса для TTS
 * Слушать все голоса: https://aistudio.google.com/app/live
 * 
 * Для русского языка лучше всего: Kore, Aoede, Charon
 */
export const TTS_VOICES = {
  // Женские голоса
  KORE: 'Kore',           // ✅ Рекомендуется для русского
  AOEDE: 'Aoede',         // Хороший для русского
  PUCK: 'Puck',
  
  // Мужские голоса  
  CHARON: 'Charon',       // Хороший для русского
  FENRIR: 'Fenrir',
  ORUS: 'Orus',
} as const;

// Текущий голос (измените здесь для смены голоса)
export const CURRENT_VOICE = TTS_VOICES.KORE;

// ═══════════════════════════════════════════════════════════════════════════════
// 🔊 АУДИО ПАРАМЕТРЫ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Параметры аудио потоков
 * 
 * ВАЖНО: Gemini Live API требует:
 * - Input: 16kHz PCM (можно другой, API ресемплит)
 * - Output: всегда 24kHz PCM
 */
export const AUDIO_CONFIG = {
  // Входной аудио поток (микрофон → Gemini)
  INPUT: {
    SAMPLE_RATE: 16000,        // 16kHz - нативный для Gemini
    CHANNELS: 1,               // Моно
    MIME_TYPE: 'audio/pcm;rate=16000',
    
    // Настройки микрофона
    ECHO_CANCELLATION: true,
    NOISE_SUPPRESSION: true,
    AUTO_GAIN_CONTROL: true,
  },
  
  // Выходной аудио поток (Gemini → динамики)
  OUTPUT: {
    SAMPLE_RATE: 24000,        // 24kHz - фиксировано Gemini
    CHANNELS: 1,               // Моно
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 🎙️ VOICE ACTIVITY DETECTION (VAD)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Конфигурация VAD (Voice Activity Detection)
 * 
 * Автоматическое определение когда пользователь говорит
 * 
 * Доступные значения чувствительности:
 * - StartSensitivity.START_SENSITIVITY_HIGH - высокая (срабатывает на тихие звуки)
 * - StartSensitivity.START_SENSITIVITY_LOW - низкая (только громкая речь)
 * - EndSensitivity.END_SENSITIVITY_HIGH - высокая (быстро определяет конец речи)
 * - EndSensitivity.END_SENSITIVITY_LOW - низкая (дольше ждет перед определением конца)
 * 
 * ВАЖНО для качественного STT:
 * - prefix_padding_ms: 200-500мс для захвата начала слов
 * - silence_duration_ms: 500-1500мс для естественных пауз в речи
 * - END_SENSITIVITY_LOW: дольше ждёт тишины (меньше обрывов)
 */
export const VAD_CONFIG = {
  // Включить/выключить автоматический VAD
  ENABLED: true,
  
  // Чувствительность к началу речи
  // HIGH = срабатывает на тихие звуки, LOW = только громкая речь
  START_SENSITIVITY: StartSensitivity.START_SENSITIVITY_HIGH,
  
  // Чувствительность к концу речи  
  // LOW = дольше ждёт тишины (рекомендуется для STT - меньше обрывов на паузах!)
  // HIGH = быстро определяет конец (плохо для длинных фраз с паузами)
  END_SENSITIVITY: EndSensitivity.END_SENSITIVITY_LOW,
  
  // Префиксный буфер в мс (сколько аудио ДО начала речи сохранять)
  // КРИТИЧНО: слишком маленькое значение = обрезанные начала слов!
  // Рекомендуется: 300-500мс для надёжного захвата начала
  PREFIX_PADDING_MS: 300,
  
  // Длительность тишины для определения конца речи (мс)
  // КРИТИЧНО: слишком маленькое значение = речь обрывается на паузах!
  // Рекомендуется: 1000-1500мс для естественных пауз между фразами
  SILENCE_DURATION_MS: 1000,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 🧠 THINKING (Размышления модели)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Конфигурация Thinking
 * 
 * Native audio модель поддерживает "thinking" - модель может "думать"
 * перед ответом для более качественных ответов
 */
export const THINKING_CONFIG = {
  // Бюджет токенов на размышления (0 = отключить thinking)
  // Рекомендуется: 1024-4096 для сложных задач
  THINKING_BUDGET: 0,
  
  // Включать краткое содержание размышлений в ответ
  INCLUDE_THOUGHTS: false,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 🎭 AFFECTIVE DIALOG (Эмоциональный диалог)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Конфигурация эмоционального диалога
 * 
 * ВНИМАНИЕ: Требует api_version: 'v1alpha'
 * 
 * Позволяет модели адаптировать стиль ответа под тон и эмоции пользователя
 */
export const AFFECTIVE_DIALOG_CONFIG = {
  // Включить эмоциональный диалог
  ENABLED: false,
  
  // API версия (должна быть v1alpha для этой функции)
  API_VERSION: 'v1alpha',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 🔔 PROACTIVE AUDIO (Проактивное аудио)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Конфигурация проактивного аудио
 * 
 * ВНИМАНИЕ: Требует api_version: 'v1alpha'
 * 
 * Модель сама решает когда отвечать (может не отвечать на нерелевантный контент)
 */
export const PROACTIVE_AUDIO_CONFIG = {
  // Включить проактивное аудио
  ENABLED: false,
  
  // API версия (должна быть v1alpha для этой функции)
  API_VERSION: 'v1alpha',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 📝 ТРАНСКРИПЦИЯ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Конфигурация транскрипции
 */
export const TRANSCRIPTION_CONFIG = {
  // STT: Транскрипция входного аудио (что сказал пользователь)
  INPUT_TRANSCRIPTION: {
    ENABLED: true,
  },
  
  // TTS Captions: Транскрипция выходного аудио (что говорит модель)
  OUTPUT_TRANSCRIPTION: {
    ENABLED: true,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 📺 MEDIA RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Разрешение медиа (для видео/изображений)
 */
export const MEDIA_RESOLUTION = {
  LOW: 'MEDIA_RESOLUTION_LOW',
  MEDIUM: 'MEDIA_RESOLUTION_MEDIUM',
  HIGH: 'MEDIA_RESOLUTION_HIGH',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// ⚙️ ГОТОВЫЕ КОНФИГУРАЦИИ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Конфигурация для режима STT+TTS (полный диалог)
 * Используется в connect() - голосовой режим с ответами
 */
export function getUnifiedConfig(systemInstruction: string) {
  return {
    // Модель
    model: CURRENT_MODEL,
    
    config: {
      // Режим ответа: AUDIO для TTS, TEXT для текстовых ответов
      responseModalities: [Modality.AUDIO],
      
      // STT: Включить транскрипцию входного аудио
      ...(TRANSCRIPTION_CONFIG.INPUT_TRANSCRIPTION.ENABLED && {
        inputAudioTranscription: {},
      }),
      
      // TTS Captions: Включить транскрипцию выходного аудио
      ...(TRANSCRIPTION_CONFIG.OUTPUT_TRANSCRIPTION.ENABLED && {
        outputAudioTranscription: {},
      }),
      
      // Голос для TTS
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: CURRENT_VOICE,
          },
        },
      },
      
      // Thinking (размышления)
      ...(THINKING_CONFIG.THINKING_BUDGET > 0 && {
        thinkingConfig: {
          thinkingBudget: THINKING_CONFIG.THINKING_BUDGET,
          includeThoughts: THINKING_CONFIG.INCLUDE_THOUGHTS,
        },
      }),
      
      // VAD настройки
      ...(VAD_CONFIG.ENABLED && {
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: VAD_CONFIG.START_SENSITIVITY,
            endOfSpeechSensitivity: VAD_CONFIG.END_SENSITIVITY,
            prefixPaddingMs: VAD_CONFIG.PREFIX_PADDING_MS,
            silenceDurationMs: VAD_CONFIG.SILENCE_DURATION_MS,
          },
        },
      }),
      
      // Системный промпт
      systemInstruction,
    },
  };
}

/**
 * Конфигурация для режима TTS Only (только синтез речи)
 * Используется в connectForTTS() - озвучка текста без микрофона
 */
export function getTTSOnlyConfig(systemInstruction: string) {
  return {
    model: CURRENT_MODEL,
    
    config: {
      // Только аудио ответ
      responseModalities: [Modality.AUDIO],
      
      // Транскрипция выхода (что модель говорит)
      ...(TRANSCRIPTION_CONFIG.OUTPUT_TRANSCRIPTION.ENABLED && {
        outputAudioTranscription: {},
      }),
      
      // Голос
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: CURRENT_VOICE,
          },
        },
      },
      
      // Системный промпт
      systemInstruction,
    },
  };
}

/**
 * Конфигурация для режима STT Only (только распознавание речи)
 * Для транскрипции без генерации ответа
 */
export function getSTTOnlyConfig() {
  return {
    model: CURRENT_MODEL,
    
    config: {
      // Текстовый ответ (не аудио)
      responseModalities: [Modality.TEXT],
      
      // STT: Транскрипция входного аудио
      inputAudioTranscription: {},
      
      // VAD настройки
      ...(VAD_CONFIG.ENABLED && {
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: VAD_CONFIG.START_SENSITIVITY,
            endOfSpeechSensitivity: VAD_CONFIG.END_SENSITIVITY,
            prefixPaddingMs: VAD_CONFIG.PREFIX_PADDING_MS,
            silenceDurationMs: VAD_CONFIG.SILENCE_DURATION_MS,
          },
        },
      }),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 ЛИМИТЫ И ОГРАНИЧЕНИЯ
// ═══════════════════════════════════════════════════════════════════════════════

export const LIMITS = {
  // Максимальная длительность сессии
  SESSION_DURATION: {
    AUDIO_ONLY: 15 * 60,      // 15 минут
    AUDIO_VIDEO: 2 * 60,      // 2 минуты
  },
  
  // Контекстное окно (в токенах)
  CONTEXT_WINDOW: {
    NATIVE_AUDIO: 128_000,    // 128k токенов
    OTHER_MODELS: 32_000,     // 32k токенов
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 🌍 ПОДДЕРЖИВАЕМЫЕ ЯЗЫКИ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Языки поддерживаемые Gemini Live API
 * 
 * ВАЖНО: Native audio модели автоматически определяют язык
 * и НЕ поддерживают явное указание language code
 * 
 * * - НЕ доступны для Native Audio
 */
export const SUPPORTED_LANGUAGES = {
  'de-DE': 'German (Germany)',
  'en-AU': 'English (Australia)*',
  'en-GB': 'English (UK)*',
  'en-IN': 'English (India)',
  'en-US': 'English (US)',
  'es-US': 'Spanish (US)',
  'fr-FR': 'French (France)',
  'hi-IN': 'Hindi (India)',
  'pt-BR': 'Portuguese (Brazil)',
  'ar-XA': 'Arabic (Generic)',
  'es-ES': 'Spanish (Spain)*',
  'fr-CA': 'French (Canada)*',
  'id-ID': 'Indonesian (Indonesia)',
  'it-IT': 'Italian (Italy)',
  'ja-JP': 'Japanese (Japan)',
  'tr-TR': 'Turkish (Turkey)',
  'vi-VN': 'Vietnamese (Vietnam)',
  'bn-IN': 'Bengali (India)',
  'nl-NL': 'Dutch (Netherlands)',
  'ko-KR': 'Korean (South Korea)',
  'cmn-CN': 'Mandarin Chinese (China)*',
  'pl-PL': 'Polish (Poland)',
  'ru-RU': 'Russian (Russia)',     // ✅ Русский поддерживается!
  'th-TH': 'Thai (Thailand)',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 📤 ЭКСПОРТ
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  GEMINI_MODELS,
  CURRENT_MODEL,
  TTS_VOICES,
  CURRENT_VOICE,
  AUDIO_CONFIG,
  VAD_CONFIG,
  THINKING_CONFIG,
  AFFECTIVE_DIALOG_CONFIG,
  PROACTIVE_AUDIO_CONFIG,
  TRANSCRIPTION_CONFIG,
  MEDIA_RESOLUTION,
  LIMITS,
  SUPPORTED_LANGUAGES,
  getUnifiedConfig,
  getTTSOnlyConfig,
  getSTTOnlyConfig,
};
