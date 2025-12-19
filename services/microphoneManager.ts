/**
 * Microphone Permission Manager
 * Handles microphone permission caching for Telegram Mini App
 * Prevents repeated permission dialogs by storing permission state
 */

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready(): void;
        cloudStorage?: {
          setItem(key: string, value: string, callback?: (error: Error | null) => void): void;
          getItem(key: string, callback: (error: Error | null, value?: string) => void): void;
          removeItem(key: string, callback?: (error: Error | null) => void): void;
        };
      };
    };
  }
}

export class MicrophoneManager {
  private permissionGranted = false;
  private readonly STORAGE_KEY = 'voxlux_mic_permission';
  private readonly LOCAL_STORAGE_KEY = 'voxlux_mic_permission_local';
  
  // Кэшированный аудио поток - главное решение проблемы
  private audioStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private isStreamActive = false;

  /**
   * Проверяем состояние разрешения микрофона через Permissions API
   * @returns Promise<string> - 'granted', 'denied', 'prompt' или null если API не поддерживается
   */
  async checkMicrophonePermission(): Promise<string | null> {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' });
      console.log('🔍 [MicManager] Permission status:', result.state);
      return result.state;
    } catch (error) {
      console.error('⚠️ [MicManager] Permissions API не поддерживается:', error);
      return null;
    }
  }

  /**
   * Initialize microphone manager and check/request permission
   * @returns Promise<boolean> - true if permission granted
   */
  async initialize(): Promise<boolean> {
    console.log('🎤 [MicManager] Initializing MicrophoneManager');
    
    // Инициализируем Telegram Web App SDK
    this.initializeTelegramWebApp();

    // Проверяем статус разрешения через Permissions API
    const permissionStatus = await this.checkMicrophonePermission();
    
    if (permissionStatus === 'granted') {
      console.log('✅ [MicManager] Permission already granted by browser');
      this.permissionGranted = true;
      await this.storePermission();
      return true;
    }
    
    // Check if permission already cached
    const hasStoredPermission = await this.getStoredPermission();
    if (hasStoredPermission && permissionStatus !== 'denied') {
      console.log('✅ [MicManager] Permission found in storage (no dialog needed)');
      this.permissionGranted = true;
      return true;
    }
    
    if (permissionStatus === 'denied') {
      console.warn('❌ [MicManager] Permission denied by user');
      return false;
    }

    // Request permission for the first time
    console.log('🎤 [MicManager] No cached permission, requesting access...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        }
      });

      // IMPORTANT: Stop the stream immediately
      // This "probes" the permission without actually using the microphone
      stream.getTracks().forEach(track => {
        track.stop();
        console.log('✅ [MicManager] Probe track stopped');
      });

      // Store permission for future use
      this.permissionGranted = true;
      await this.storePermission();

      console.log('✅ [MicManager] Permission granted and cached');
      return true;

    } catch (error: any) {
      console.error(`❌ [MicManager] Permission denied: ${error.message}`);
      
      // Log specific error types
      if (error.name === 'NotAllowedError') {
        console.error('❌ [MicManager] User denied permission or OS-level permission missing');
      } else if (error.name === 'NotFoundError') {
        console.error('❌ [MicManager] No microphone device found');
      } else if (error.name === 'NotReadableError') {
        console.error('❌ [MicManager] Microphone is already in use by another app');
      }
      
      return false;
    }
  }

  /**
   * Store permission state in Telegram Storage (with localStorage fallback)
   */
  private async storePermission(): Promise<void> {
    // Try Telegram Storage first (persistent across sessions)
    if (window.Telegram?.WebApp?.cloudStorage) {
      console.log('💾 [MicManager] Storing permission in Telegram Storage');
      return new Promise((resolve) => {
        window.Telegram!.WebApp!.cloudStorage!.setItem(
          this.STORAGE_KEY,
          'granted',
          (error) => {
            if (error) {
              console.error('⚠️ [MicManager] Telegram Storage error:', error);
              // Fallback to localStorage
              this.storeInLocalStorage();
            } else {
              console.log('✅ [MicManager] Permission stored in Telegram Storage');
            }
            resolve();
          }
        );
      });
    } else {
      // Fallback to localStorage if Telegram Storage unavailable
      console.log('💾 [MicManager] Telegram Storage unavailable, using localStorage');
      this.storeInLocalStorage();
    }
  }

  /**
   * Store in localStorage (fallback)
   */
  private storeInLocalStorage(): void {
    try {
      localStorage.setItem(this.LOCAL_STORAGE_KEY, 'granted');
      console.log('✅ [MicManager] Permission stored in localStorage');
    } catch (error) {
      console.error('❌ [MicManager] localStorage error:', error);
    }
  }

  /**
   * Get stored permission from Telegram Storage or localStorage
   */
  private async getStoredPermission(): Promise<boolean> {
    // Try Telegram Storage first
    if (window.Telegram?.WebApp?.cloudStorage) {
      console.log('🔍 [MicManager] Checking Telegram Storage');
      return new Promise((resolve) => {
        window.Telegram!.WebApp!.cloudStorage!.getItem(
          this.STORAGE_KEY,
          (error, value) => {
            if (!error && value === 'granted') {
              console.log('✅ [MicManager] Permission found in Telegram Storage');
              resolve(true);
            } else {
              // Fallback to localStorage
              console.log('🔍 [MicManager] Not in Telegram Storage, checking localStorage');
              resolve(this.getFromLocalStorage());
            }
          }
        );
      });
    } else {
      // Fallback to localStorage
      console.log('🔍 [MicManager] Telegram Storage unavailable, checking localStorage');
      return this.getFromLocalStorage();
    }
  }

  /**
   * Get from localStorage (fallback)
   */
  private getFromLocalStorage(): boolean {
    try {
      const value = localStorage.getItem(this.LOCAL_STORAGE_KEY);
      const granted = value === 'granted';
      if (granted) {
        console.log('✅ [MicManager] Permission found in localStorage');
      }
      return granted;
    } catch (error) {
      console.error('❌ [MicManager] localStorage read error:', error);
      return false;
    }
  }

  /**
   * Получаем кэшированный аудио поток (главное решение проблемы)
   * Если поток уже получен, возвращаем его без нового запроса getUserMedia
   * @param constraints - дополнительные ограничения аудио
   * @returns Promise<MediaStream | null>
   */
  async getAudioStream(constraints?: MediaStreamConstraints['audio']): Promise<MediaStream | null> {
    console.log('🎤 [MicManager] Getting audio stream...');
    
    // Проверяем, активен ли кэшированный поток
    // ВАЖНО: проверяем stream.active - треки могли быть остановлены внешним кодом
    if (this.audioStream && this.isStreamActive && this.audioStream.active) {
      // Дополнительная проверка: хотя бы один трек должен быть enabled и live
      const hasActiveTracks = this.audioStream.getTracks().some(
        track => track.enabled && track.readyState === 'live'
      );
      
      if (hasActiveTracks) {
        console.log('✅ [MicManager] Returning cached audio stream (no new permission request)');
        return this.audioStream;
      } else {
        console.log('⚠️ [MicManager] Cached stream has no active tracks, creating new one...');
        this.isStreamActive = false;
      }
    } else if (this.audioStream && (!this.audioStream.active || !this.isStreamActive)) {
      console.log('⚠️ [MicManager] Cached stream is inactive, will create new one...');
      this.isStreamActive = false;
    }
    
    // Проверяем разрешение перед запросом
    if (!this.permissionGranted) {
      console.error('❌ [MicManager] Permission not granted, cannot get audio stream');
      return null;
    }
    
    try {
      console.log('🔄 [MicManager] Creating new audio stream...');
      
      const audioConstraints = constraints || {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
        channelCount: 1
      };
      
      this.audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: audioConstraints
      });
      
      this.isStreamActive = true;
      
      // Слушаем событие окончания потока
      this.audioStream.addEventListener('ended', () => {
        console.log('🛑 [MicManager] Audio stream ended');
        this.isStreamActive = false;
      });
      
      console.log('✅ [MicManager] New audio stream created and cached');
      return this.audioStream;
      
    } catch (error: any) {
      console.error('❌ [MicManager] Failed to get audio stream:', error);
      this.audioStream = null;
      this.isStreamActive = false;
      
      // Если ошибка разрешения, сбрасываем кэш
      if (error.name === 'NotAllowedError') {
        this.permissionGranted = false;
        this.clearPermission();
      }
      
      return null;
    }
  }
  
  /**
   * Получаем аудио поток с повторными попытками
   * @param maxRetries - максимальное количество попыток
   * @param constraints - ограничения аудио
   * @returns Promise<MediaStream | null>
   */
  async getAudioStreamWithRetry(maxRetries: number = 3, constraints?: MediaStreamConstraints['audio']): Promise<MediaStream | null> {
    if (this.audioStream && this.isStreamActive) {
      return this.audioStream;
    }
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const stream = await this.getAudioStream(constraints);
        if (stream) {
          return stream;
        }
      } catch (error) {
        console.error(`❌ [MicManager] Attempt ${i + 1}/${maxRetries} failed:`, error);
        
        if (i === maxRetries - 1) {
          throw new Error(`Не удалось получить доступ к микрофону: ${error}`);
        }
        
        // Небольшая задержка перед повторной попыткой
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
      }
    }
    
    return null;
  }
  
  /**
   * Инициализация Web Audio API с сохранением контекста
   * @returns Promise<{audioContext: AudioContext, mediaSource: MediaStreamAudioSourceNode, stream: MediaStream} | null>
   */
  async initializeAudioRecording(): Promise<{audioContext: AudioContext, mediaSource: MediaStreamAudioSourceNode, stream: MediaStream} | null> {
    try {
      // Создаем контекст один раз
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('🎵 [MicManager] AudioContext created');
      }
      
      // Получаем или переиспользуем поток
      const stream = await this.getAudioStream();
      if (!stream) {
        console.error('❌ [MicManager] No audio stream available');
        return null;
      }
      
      // Подключаем к mediaSource если еще не подключено
      if (!this.mediaSource) {
        this.mediaSource = this.audioContext.createMediaStreamSource(stream);
        console.log('🔗 [MicManager] MediaSource created and connected');
      }
      
      return { audioContext: this.audioContext, mediaSource: this.mediaSource, stream };
    } catch (error) {
      console.error('❌ [MicManager] Error initializing audio recording:', error);
      return null;
    }
  }
  
  /**
   * Остановка записи без закрытия потока (для сохранения в рамках сессии)
   * В отличие от полного закрытия, поток остается доступным
   */
  pauseRecording(): void {
    console.log('⏸️ [MicManager] Pausing recording (stream remains active)');
    // НЕ вызываем audioStream.getTracks().forEach(track => track.stop())
    // во время активной сессии Mini App
  }
  
  /**
   * Check if microphone is ready to use (permission granted)
   */
  isReady(): boolean {
    return this.permissionGranted;
  }
  
  /**
   * Проверяем, активен ли аудио поток
   */
  hasActiveStream(): boolean {
    return this.isStreamActive && this.audioStream !== null;
  }

  /**
   * Полная очистка аудио ресурсов (вызывать только при выходе из приложения)
   */
  cleanupAudio(): void {
    console.log('🧹 [MicManager] Cleaning up audio resources');
    
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => {
        track.stop();
        console.log('🛑 [MicManager] Audio track stopped');
      });
      this.audioStream = null;
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      console.log('🔒 [MicManager] AudioContext closed');
    }
    
    this.audioContext = null;
    this.mediaSource = null;
    this.isStreamActive = false;
  }
  
  /**
   * Clear cached permission (for testing or if user revokes permission)
   */
  clearPermission(): void {
    console.log('🗑️ [MicManager] Clearing cached permission');
    this.permissionGranted = false;
    
    // Также очищаем аудио ресурсы
    this.cleanupAudio();
    
    // Clear localStorage
    try {
      localStorage.removeItem(this.LOCAL_STORAGE_KEY);
      console.log('✅ [MicManager] localStorage cleared');
    } catch (error) {
      console.error('❌ [MicManager] localStorage clear error:', error);
    }
    
    // Clear Telegram Storage
    if (window.Telegram?.WebApp?.cloudStorage) {
      window.Telegram.WebApp.cloudStorage.removeItem(this.STORAGE_KEY, (error) => {
        if (error) {
          console.error('❌ [MicManager] Telegram Storage clear error:', error);
        } else {
          console.log('✅ [MicManager] Telegram Storage cleared');
        }
      });
    }
  }

  /**
   * Инициализация Telegram Web App SDK
   */
  private initializeTelegramWebApp(): void {
    if (window.Telegram?.WebApp) {
      console.log('📱 [MicManager] Initializing Telegram Web App');
      window.Telegram.WebApp.ready();
      
      // Обрабатываем события изменения viewport
      window.Telegram.WebApp.onEvent?.('viewportChanged', () => {
        console.log('📱 [MicManager] Viewport changed');
        // Переинициализируем аудио поток если нужно
        if (!this.isStreamActive && this.permissionGranted) {
          console.log('🔄 [MicManager] Re-checking audio stream after viewport change');
        }
      });
      
      // Обрабатываем событие скрытия приложения
      window.Telegram.WebApp.onEvent?.('popupClosed', () => {
        console.log('📱 [MicManager] Popup closed');
        // НЕ очищаем ресурсы, так как пользователь может вернуться
      });
      
      // Обрабатываем событие закрытия приложения
      window.addEventListener('beforeunload', () => {
        console.log('📱 [MicManager] App is closing - cleaning up audio resources');
        this.cleanupAudio();
      });
      
    } else {
      console.log('⚠️ [MicManager] Telegram Web App not available');
    }
  }
  
  /**
   * Get user-friendly error instruction
   */
  getPermissionInstructions(): string {
    return `
Для использования микрофона:
1. Откройте Settings → Apps → Telegram
2. Нажмите Permissions
3. Найдите Microphone и нажмите "Allow"
4. Выберите "Allow only while using the app"
5. Перезапустите VoxLux
    `.trim();
  }
}

// Export singleton instance
export const microphoneManager = new MicrophoneManager();

export default MicrophoneManager;
