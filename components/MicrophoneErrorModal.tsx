import React from 'react';

interface MicrophoneErrorModalProps {
  isOpen: boolean;
  errorType: 'NotAllowedError' | 'NotFoundError' | 'NotReadableError' | 'Unknown';
  errorMessage?: string;
  onClose: () => void;
  onRetry?: () => void;
  platform: 'ios' | 'android' | 'desktop' | 'web' | 'unknown';
}

/**
 * Error modal with user-friendly instructions for fixing microphone issues
 */
const MicrophoneErrorModal: React.FC<MicrophoneErrorModalProps> = ({
  isOpen,
  errorType,
  errorMessage,
  onClose,
  onRetry,
  platform
}) => {
  if (!isOpen) return null;

  const getErrorContent = () => {
    switch (errorType) {
      case 'NotAllowedError':
        return {
          icon: (
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          ),
          title: 'Доступ запрещён',
          description: 'Вы отклонили запрос на доступ к микрофону.',
          instructions: getPermissionInstructions()
        };
      
      case 'NotFoundError':
        return {
          icon: (
            <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          title: 'Микрофон не найден',
          description: 'На вашем устройстве не обнаружен микрофон.',
          instructions: (
            <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
              <li>Проверьте подключение наушников/гарнитуры</li>
              <li>Убедитесь, что микрофон не отключён физически</li>
              <li>Попробуйте перезагрузить устройство</li>
            </ul>
          )
        };
      
      case 'NotReadableError':
        return {
          icon: (
            <svg className="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          title: 'Микрофон занят',
          description: 'Микрофон используется другим приложением.',
          instructions: (
            <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
              <li>Закройте другие приложения, использующие микрофон</li>
              <li>Проверьте, нет ли активных звонков</li>
              <li>Перезапустите Telegram</li>
            </ul>
          )
        };
      
      default:
        return {
          icon: (
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 12h.01M12 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          title: 'Ошибка микрофона',
          description: errorMessage || 'Произошла неизвестная ошибка при доступе к микрофону.',
          instructions: (
            <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
              <li>Перезагрузите приложение</li>
              <li>Проверьте разрешения в настройках</li>
              <li>Попробуйте использовать текстовый режим</li>
            </ul>
          )
        };
    }
  };

  const getPermissionInstructions = () => {
    switch (platform) {
      case 'ios':
        return (
          <div className="text-sm text-gray-400 space-y-2">
            <p className="font-medium text-gray-300">Как разрешить доступ на iOS:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Откройте <span className="text-white">Настройки</span></li>
              <li>Найдите <span className="text-white">Telegram</span></li>
              <li>Включите <span className="text-white">Микрофон</span></li>
              <li>Вернитесь в приложение и попробуйте снова</li>
            </ol>
          </div>
        );
      
      case 'android':
        return (
          <div className="text-sm text-gray-400 space-y-2">
            <p className="font-medium text-gray-300">Как разрешить доступ на Android:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Откройте <span className="text-white">Настройки</span></li>
              <li>Перейдите в <span className="text-white">Приложения → Telegram</span></li>
              <li>Нажмите <span className="text-white">Разрешения</span></li>
              <li>Включите <span className="text-white">Микрофон</span></li>
              <li>Вернитесь в приложение и попробуйте снова</li>
            </ol>
          </div>
        );
      
      case 'desktop':
        return (
          <div className="text-sm text-gray-400 space-y-2">
            <p className="font-medium text-gray-300">Как разрешить доступ в браузере:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Нажмите на иконку 🔒 слева от адресной строки</li>
              <li>Найдите <span className="text-white">Микрофон</span></li>
              <li>Выберите <span className="text-white">Разрешить</span></li>
              <li>Обновите страницу</li>
            </ol>
          </div>
        );
      
      default:
        return (
          <div className="text-sm text-gray-400">
            <p>Проверьте настройки разрешений в вашем устройстве и разрешите доступ к микрофону для Telegram.</p>
          </div>
        );
    }
  };

  const content = getErrorContent();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div 
        className="bg-gray-900 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl border border-gray-800 max-h-[85vh] overflow-y-auto"
        style={{
          animation: 'fadeInScale 0.2s ease-out'
        }}
      >
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
            {content.icon}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-white text-center mb-2">
          {content.title}
        </h2>

        {/* Description */}
        <p className="text-gray-300 text-center mb-4">
          {content.description}
        </p>

        {/* Instructions */}
        <div className="bg-gray-800/50 rounded-xl p-4 mb-6">
          {content.instructions}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-gray-800 text-gray-300 font-medium transition-colors hover:bg-gray-700 active:bg-gray-600"
          >
            Понятно
          </button>
          {onRetry && errorType !== 'NotFoundError' && (
            <button
              onClick={onRetry}
              className="flex-1 py-3 px-4 rounded-xl bg-blue-500 text-white font-medium transition-colors hover:bg-blue-600 active:bg-blue-700"
            >
              Попробовать снова
            </button>
          )}
        </div>
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

export default MicrophoneErrorModal;
