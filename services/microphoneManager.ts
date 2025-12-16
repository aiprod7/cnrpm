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

  /**
   * Initialize microphone manager and check/request permission
   * @returns Promise<boolean> - true if permission granted
   */
  async initialize(): Promise<boolean> {
    console.log('🎤 [MicManager] Initializing MicrophoneManager');

    // Check if permission already cached
    const hasStoredPermission = await this.getStoredPermission();
    if (hasStoredPermission) {
      console.log('✅ [MicManager] Permission found in storage (no dialog needed)');
      this.permissionGranted = true;
      return true;
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
   * Check if microphone is ready to use (permission granted)
   */
  isReady(): boolean {
    return this.permissionGranted;
  }

  /**
   * Clear cached permission (for testing or if user revokes permission)
   */
  clearPermission(): void {
    console.log('🗑️ [MicManager] Clearing cached permission');
    this.permissionGranted = false;
    
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
