import React from 'react';

interface MicrophonePermissionModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  platform: 'ios' | 'android' | 'desktop' | 'web' | 'unknown';
}

/**
 * User-friendly modal explaining microphone permission request
 * Shows platform-specific instructions
 */
const MicrophonePermissionModal: React.FC<MicrophonePermissionModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  platform
}) => {
  if (!isOpen) return null;

  const getPlatformInstructions = () => {
    switch (platform) {
      case 'ios':
        return (
          <>
            <p className="text-sm text-gray-400 mt-2">
              После нажатия "Разрешить" появится системный запрос iOS.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Если запрос не появился, проверьте: Настройки → Telegram → Микрофон
            </p>
          </>
        );
      case 'android':
        return (
          <>
            <p className="text-sm text-gray-400 mt-2">
              После нажатия "Разрешить" появится системный запрос Android.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Если запрос не появился, проверьте: Настройки → Приложения → Telegram → Разрешения → Микрофон
            </p>
          </>
        );
      case 'desktop':
        return (
          <>
            <p className="text-sm text-gray-400 mt-2">
              Браузер запросит доступ к микрофону.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Нажмите "Разрешить" в всплывающем окне браузера.
            </p>
          </>
        );
      default:
        return (
          <p className="text-sm text-gray-400 mt-2">
            После нажатия "Разрешить" появится системный запрос.
          </p>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div 
        className="bg-gray-900 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl border border-gray-800"
        style={{
          animation: 'fadeInScale 0.2s ease-out'
        }}
      >
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center">
            <svg 
              className="w-8 h-8 text-blue-400" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" 
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-white text-center mb-2">
          Доступ к микрофону
        </h2>

        {/* Description */}
        <p className="text-gray-300 text-center mb-1">
          Для записи голосового сообщения приложению нужен доступ к микрофону.
        </p>

        {/* Platform-specific instructions */}
        <div className="text-center mb-6">
          {getPlatformInstructions()}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 px-4 rounded-xl bg-gray-800 text-gray-300 font-medium transition-colors hover:bg-gray-700 active:bg-gray-600"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 px-4 rounded-xl bg-blue-500 text-white font-medium transition-colors hover:bg-blue-600 active:bg-blue-700"
          >
            Разрешить
          </button>
        </div>

        {/* Privacy note */}
        <p className="text-xs text-gray-600 text-center mt-4">
          🔒 Аудио обрабатывается локально и не сохраняется
        </p>
      </div>

      <style>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
};

export default MicrophonePermissionModal;
