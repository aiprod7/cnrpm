/**
 * Telegram Mini App Service
 * Comprehensive adapter for iOS/Android/Desktop Telegram Mini Apps
 * Based on official documentation: https://core.telegram.org/bots/webapps
 * 
 * Features:
 * - Safe area handling (notches, navigation bars)
 * - Theme synchronization
 * - Viewport management
 * - HapticFeedback support
 * - Platform detection
 * - Microphone permission handling with user-friendly prompts
 */

// Type definitions for Telegram WebApp
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
      photo_url?: string;
    };
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  bottomBarColor?: string;
  isClosingConfirmationEnabled: boolean;
  isVerticalSwipesEnabled?: boolean;
  isFullscreen?: boolean;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: ContentSafeAreaInset;
  
  // Methods
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  enableVerticalSwipes?(): void;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  showPopup(params: PopupParams, callback?: (id: string) => void): void;
  showAlert(message: string, callback?: () => void): void;
  showConfirm(message: string, callback?: (confirmed: boolean) => void): void;
  
  // Objects
  MainButton: BottomButton;
  SecondaryButton?: BottomButton;
  BackButton: BackButton;
  HapticFeedback: HapticFeedback;
  CloudStorage?: CloudStorage;
  
  // Events
  onEvent(eventType: string, eventHandler: Function): void;
  offEvent(eventType: string, eventHandler: Function): void;
}

interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

interface SafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface ContentSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface PopupParams {
  title?: string;
  message: string;
  buttons?: PopupButton[];
}

interface PopupButton {
  id?: string;
  type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
  text?: string;
}

interface BottomButton {
  text: string;
  color: string;
  textColor: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText(text: string): BottomButton;
  onClick(callback: () => void): BottomButton;
  offClick(callback: () => void): BottomButton;
  show(): BottomButton;
  hide(): BottomButton;
  enable(): BottomButton;
  disable(): BottomButton;
  showProgress(leaveActive?: boolean): BottomButton;
  hideProgress(): BottomButton;
  setParams(params: { 
    text?: string; 
    color?: string; 
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
  }): BottomButton;
}

interface BackButton {
  isVisible: boolean;
  onClick(callback: () => void): BackButton;
  offClick(callback: () => void): BackButton;
  show(): BackButton;
  hide(): BackButton;
}

interface HapticFeedback {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): HapticFeedback;
  notificationOccurred(type: 'error' | 'success' | 'warning'): HapticFeedback;
  selectionChanged(): HapticFeedback;
}

interface CloudStorage {
  setItem(key: string, value: string, callback?: (error: Error | null) => void): void;
  getItem(key: string, callback: (error: Error | null, value?: string) => void): void;
  removeItem(key: string, callback?: (error: Error | null) => void): void;
  getKeys(callback: (error: Error | null, keys?: string[]) => void): void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export type PlatformType = 'ios' | 'android' | 'desktop' | 'web' | 'unknown';

export interface DiagnosticInfo {
  platform: PlatformType;
  telegramVersion: string;
  botApiVersion: string;
  isTelegramApp: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset: SafeAreaInset;
  contentSafeAreaInset: ContentSafeAreaInset;
  colorScheme: 'light' | 'dark';
  isExpanded: boolean;
  isFullscreen: boolean;
  userAgent: string;
  performanceClass?: 'LOW' | 'AVERAGE' | 'HIGH';
}

export class TelegramWebAppService {
  private webApp: TelegramWebApp | null = null;
  private platform: PlatformType = 'unknown';
  private initialized = false;
  private eventHandlers: Map<string, Function[]> = new Map();
  
  constructor() {
    this.detectPlatform();
  }

  /**
   * Initialize Telegram WebApp
   * Call this EARLY in your app lifecycle
   */
  initialize(): boolean {
    if (this.initialized) {
      console.log('📱 [TGWebApp] Already initialized');
      return true;
    }

    console.log('📱 [TGWebApp] Initializing Telegram Mini App adapter...');
    
    if (!window.Telegram?.WebApp) {
      console.warn('⚠️ [TGWebApp] Not running in Telegram - using web fallback');
      this.setupWebFallback();
      this.initialized = true;
      return false;
    }

    this.webApp = window.Telegram.WebApp;
    
    // 1. Signal readiness ASAP (hides loading placeholder)
    this.webApp.ready();
    console.log('✅ [TGWebApp] ready() called');

    // 2. Expand to full height
    this.webApp.expand();
    console.log('✅ [TGWebApp] expand() called');

    // 3. Setup CSS variables for viewport and safe areas
    this.setupCSSVariables();
    
    // 4. Apply theme
    this.applyTheme();
    
    // 5. Setup event listeners
    this.setupEventListeners();
    
    // 6. Log diagnostic info
    this.logDiagnostics();
    
    this.initialized = true;
    console.log('✅ [TGWebApp] Initialization complete');
    
    return true;
  }

  /**
   * Detect current platform (iOS/Android/Desktop/Web)
   */
  private detectPlatform(): void {
    const ua = navigator.userAgent.toLowerCase();
    
    // Check Telegram-specific UA (Android adds extra info)
    if (ua.includes('telegram-android')) {
      this.platform = 'android';
    } else if (ua.includes('telegram-ios') || (ua.includes('telegram') && ua.includes('iphone'))) {
      this.platform = 'ios';
    } else if (window.Telegram?.WebApp) {
      // Telegram WebApp exists but not mobile - likely desktop
      const tgPlatform = window.Telegram.WebApp.platform?.toLowerCase() || '';
      if (tgPlatform.includes('ios') || tgPlatform === 'iphone' || tgPlatform === 'ipad') {
        this.platform = 'ios';
      } else if (tgPlatform.includes('android')) {
        this.platform = 'android';
      } else if (tgPlatform.includes('tdesktop') || tgPlatform.includes('macos') || tgPlatform.includes('windows')) {
        this.platform = 'desktop';
      } else if (tgPlatform.includes('web') || tgPlatform === 'weba' || tgPlatform === 'webk') {
        this.platform = 'web';
      } else {
        this.platform = 'unknown';
      }
    } else {
      // Not in Telegram at all
      if (ua.includes('iphone') || ua.includes('ipad')) {
        this.platform = 'ios';
      } else if (ua.includes('android')) {
        this.platform = 'android';
      } else {
        this.platform = 'desktop';
      }
    }
    
    console.log(`📱 [TGWebApp] Detected platform: ${this.platform}`);
  }

  /**
   * Setup CSS variables for viewport and safe areas
   * These are critical for iOS notches and Android nav bars
   */
  private setupCSSVariables(): void {
    if (!this.webApp) return;

    const root = document.documentElement;
    
    // Viewport height (updates in real-time but not smoothly)
    root.style.setProperty('--tg-viewport-height', `${this.webApp.viewportHeight}px`);
    
    // Stable viewport height (best for pinning elements)
    root.style.setProperty('--tg-viewport-stable-height', `${this.webApp.viewportStableHeight}px`);
    
    // Safe area insets (system UI: notches, nav bars)
    const safeArea = this.webApp.safeAreaInset || { top: 0, bottom: 0, left: 0, right: 0 };
    root.style.setProperty('--tg-safe-area-inset-top', `${safeArea.top}px`);
    root.style.setProperty('--tg-safe-area-inset-bottom', `${safeArea.bottom}px`);
    root.style.setProperty('--tg-safe-area-inset-left', `${safeArea.left}px`);
    root.style.setProperty('--tg-safe-area-inset-right', `${safeArea.right}px`);
    
    // Content safe area (Telegram UI overlap)
    const contentSafe = this.webApp.contentSafeAreaInset || { top: 0, bottom: 0, left: 0, right: 0 };
    root.style.setProperty('--tg-content-safe-area-inset-top', `${contentSafe.top}px`);
    root.style.setProperty('--tg-content-safe-area-inset-bottom', `${contentSafe.bottom}px`);
    root.style.setProperty('--tg-content-safe-area-inset-left', `${contentSafe.left}px`);
    root.style.setProperty('--tg-content-safe-area-inset-right', `${contentSafe.right}px`);
    
    // Color scheme
    root.style.setProperty('--tg-color-scheme', this.webApp.colorScheme);
    
    console.log(`📐 [TGWebApp] CSS variables set:
      - viewport: ${this.webApp.viewportHeight}px / stable: ${this.webApp.viewportStableHeight}px
      - safeArea: top=${safeArea.top}, bottom=${safeArea.bottom}
      - contentSafe: top=${contentSafe.top}, bottom=${contentSafe.bottom}`);
  }

  /**
   * Apply Telegram theme colors
   */
  private applyTheme(): void {
    if (!this.webApp) return;

    const theme = this.webApp.themeParams;
    const root = document.documentElement;
    
    // Apply theme colors as CSS variables
    if (theme.bg_color) root.style.setProperty('--tg-theme-bg-color', theme.bg_color);
    if (theme.text_color) root.style.setProperty('--tg-theme-text-color', theme.text_color);
    if (theme.hint_color) root.style.setProperty('--tg-theme-hint-color', theme.hint_color);
    if (theme.link_color) root.style.setProperty('--tg-theme-link-color', theme.link_color);
    if (theme.button_color) root.style.setProperty('--tg-theme-button-color', theme.button_color);
    if (theme.button_text_color) root.style.setProperty('--tg-theme-button-text-color', theme.button_text_color);
    if (theme.secondary_bg_color) root.style.setProperty('--tg-theme-secondary-bg-color', theme.secondary_bg_color);
    if (theme.header_bg_color) root.style.setProperty('--tg-theme-header-bg-color', theme.header_bg_color);
    if (theme.accent_text_color) root.style.setProperty('--tg-theme-accent-text-color', theme.accent_text_color);
    if (theme.destructive_text_color) root.style.setProperty('--tg-theme-destructive-text-color', theme.destructive_text_color);
    
    // Set body colors
    document.body.style.backgroundColor = theme.bg_color || '#000000';
    document.body.style.color = theme.text_color || '#ffffff';
    
    // Set header/background colors via WebApp API
    try {
      this.webApp.setHeaderColor(theme.header_bg_color || theme.bg_color || '#000000');
      this.webApp.setBackgroundColor(theme.bg_color || '#000000');
      
      // Bottom bar (Bot API 7.10+)
      if (this.webApp.setBottomBarColor && theme.bottom_bar_bg_color) {
        this.webApp.setBottomBarColor(theme.bottom_bar_bg_color);
      }
    } catch (e) {
      console.warn('⚠️ [TGWebApp] Failed to set colors:', e);
    }
    
    console.log(`🎨 [TGWebApp] Theme applied: ${this.webApp.colorScheme} mode`);
  }

  /**
   * Setup event listeners for dynamic updates
   */
  private setupEventListeners(): void {
    if (!this.webApp) return;

    // Viewport changes (user pulling/collapsing)
    this.webApp.onEvent('viewportChanged', ({ isStateStable }: { isStateStable: boolean }) => {
      this.setupCSSVariables();
      this.emit('viewportChanged', { isStateStable, height: this.webApp?.viewportHeight });
      
      if (isStateStable) {
        console.log(`📐 [TGWebApp] Viewport stable at ${this.webApp?.viewportStableHeight}px`);
      }
    });

    // Theme changes (user switches light/dark mode)
    this.webApp.onEvent('themeChanged', () => {
      this.applyTheme();
      this.emit('themeChanged', { colorScheme: this.webApp?.colorScheme });
      console.log(`🎨 [TGWebApp] Theme changed to ${this.webApp?.colorScheme}`);
    });

    // Safe area changes (orientation change, etc.)
    if (this.webApp.isVersionAtLeast('8.0')) {
      this.webApp.onEvent('safeAreaChanged', () => {
        this.setupCSSVariables();
        this.emit('safeAreaChanged', this.webApp?.safeAreaInset);
      });

      this.webApp.onEvent('contentSafeAreaChanged', () => {
        this.setupCSSVariables();
        this.emit('contentSafeAreaChanged', this.webApp?.contentSafeAreaInset);
      });
    }
  }

  /**
   * Log diagnostic information
   */
  private logDiagnostics(): void {
    if (!this.webApp) return;

    const info = this.getDiagnosticInfo();
    
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('📱 TELEGRAM MINI APP DIAGNOSTICS');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`Platform: ${info.platform}`);
    console.log(`Telegram Version: ${info.telegramVersion}`);
    console.log(`Bot API Version: ${info.botApiVersion}`);
    console.log(`Color Scheme: ${info.colorScheme}`);
    console.log(`Viewport: ${info.viewportHeight}px (stable: ${info.viewportStableHeight}px)`);
    console.log(`Safe Area: top=${info.safeAreaInset.top}, bottom=${info.safeAreaInset.bottom}`);
    console.log(`Content Safe Area: top=${info.contentSafeAreaInset.top}, bottom=${info.contentSafeAreaInset.bottom}`);
    console.log(`Expanded: ${info.isExpanded}`);
    console.log(`Fullscreen: ${info.isFullscreen}`);
    if (info.performanceClass) {
      console.log(`Performance Class: ${info.performanceClass}`);
    }
    console.log('═══════════════════════════════════════════════════════════════════');
  }

  /**
   * Setup fallback for non-Telegram browsers
   */
  private setupWebFallback(): void {
    const root = document.documentElement;
    
    root.style.setProperty('--tg-viewport-height', '100vh');
    root.style.setProperty('--tg-viewport-stable-height', '100vh');
    root.style.setProperty('--tg-safe-area-inset-top', '0px');
    root.style.setProperty('--tg-safe-area-inset-bottom', '0px');
    root.style.setProperty('--tg-safe-area-inset-left', '0px');
    root.style.setProperty('--tg-safe-area-inset-right', '0px');
    root.style.setProperty('--tg-content-safe-area-inset-top', '0px');
    root.style.setProperty('--tg-content-safe-area-inset-bottom', '0px');
    root.style.setProperty('--tg-color-scheme', 'dark');
    
    document.body.style.backgroundColor = '#000000';
    document.body.style.color = '#ffffff';
  }

  // ===============================
  // PUBLIC API
  // ===============================

  /**
   * Get diagnostic information about current environment
   */
  getDiagnosticInfo(): DiagnosticInfo {
    const defaultSafeArea = { top: 0, bottom: 0, left: 0, right: 0 };
    
    // Parse performance class from User-Agent (Android only)
    let performanceClass: 'LOW' | 'AVERAGE' | 'HIGH' | undefined;
    const ua = navigator.userAgent;
    if (ua.includes('LOW')) performanceClass = 'LOW';
    else if (ua.includes('AVERAGE')) performanceClass = 'AVERAGE';
    else if (ua.includes('HIGH')) performanceClass = 'HIGH';
    
    return {
      platform: this.platform,
      telegramVersion: this.webApp?.version || 'N/A',
      botApiVersion: this.webApp?.version || 'N/A',
      isTelegramApp: !!this.webApp,
      viewportHeight: this.webApp?.viewportHeight || window.innerHeight,
      viewportStableHeight: this.webApp?.viewportStableHeight || window.innerHeight,
      safeAreaInset: this.webApp?.safeAreaInset || defaultSafeArea,
      contentSafeAreaInset: this.webApp?.contentSafeAreaInset || defaultSafeArea,
      colorScheme: this.webApp?.colorScheme || 'dark',
      isExpanded: this.webApp?.isExpanded || false,
      isFullscreen: this.webApp?.isFullscreen || false,
      userAgent: navigator.userAgent,
      performanceClass
    };
  }

  /**
   * Get current platform
   */
  getPlatform(): PlatformType {
    return this.platform;
  }

  /**
   * Check if running in Telegram app
   */
  isTelegramApp(): boolean {
    return !!this.webApp;
  }

  /**
   * Get Telegram WebApp object (for direct access)
   */
  getWebApp(): TelegramWebApp | null {
    return this.webApp;
  }

  /**
   * Trigger haptic feedback
   * NOTE: May not work on all devices/platforms
   */
  haptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection'): void {
    if (!this.webApp?.HapticFeedback) {
      console.log('⚠️ [TGWebApp] HapticFeedback not available');
      return;
    }

    try {
      switch (type) {
        case 'light':
        case 'medium':
        case 'heavy':
          this.webApp.HapticFeedback.impactOccurred(type);
          break;
        case 'success':
        case 'error':
        case 'warning':
          this.webApp.HapticFeedback.notificationOccurred(type);
          break;
        case 'selection':
          this.webApp.HapticFeedback.selectionChanged();
          break;
      }
    } catch (e) {
      console.warn('⚠️ [TGWebApp] Haptic feedback failed:', e);
    }
  }

  /**
   * Show native popup
   */
  showPopup(params: PopupParams): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.webApp) {
        // Fallback to browser alert
        alert(params.message);
        resolve(null);
        return;
      }

      this.webApp.showPopup(params, (buttonId) => {
        resolve(buttonId || null);
      });
    });
  }

  /**
   * Show native alert
   */
  showAlert(message: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.webApp) {
        alert(message);
        resolve();
        return;
      }

      this.webApp.showAlert(message, () => resolve());
    });
  }

  /**
   * Show native confirm dialog
   */
  showConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.webApp) {
        resolve(confirm(message));
        return;
      }

      this.webApp.showConfirm(message, (confirmed) => resolve(confirmed));
    });
  }

  /**
   * Configure Main Button
   */
  configureMainButton(params: {
    text?: string;
    color?: string;
    textColor?: string;
    isActive?: boolean;
    isVisible?: boolean;
    onClick?: () => void;
  }): void {
    if (!this.webApp) return;

    const button = this.webApp.MainButton;
    
    if (params.text) button.setText(params.text);
    if (params.onClick) button.onClick(params.onClick);
    
    button.setParams({
      text: params.text,
      color: params.color,
      text_color: params.textColor,
      is_active: params.isActive,
      is_visible: params.isVisible
    });
  }

  /**
   * Show/hide Main Button
   */
  showMainButton(show: boolean = true): void {
    if (!this.webApp) return;
    show ? this.webApp.MainButton.show() : this.webApp.MainButton.hide();
  }

  /**
   * Enable/disable closing confirmation
   */
  setClosingConfirmation(enabled: boolean): void {
    if (!this.webApp) return;
    enabled ? this.webApp.enableClosingConfirmation() : this.webApp.disableClosingConfirmation();
  }

  /**
   * Enable/disable vertical swipes (Bot API 7.7+)
   */
  setVerticalSwipes(enabled: boolean): void {
    if (!this.webApp?.enableVerticalSwipes) return;
    enabled ? this.webApp.enableVerticalSwipes() : this.webApp.disableVerticalSwipes?.();
  }

  /**
   * Request fullscreen mode (Bot API 8.0+)
   */
  requestFullscreen(): void {
    if (!this.webApp?.requestFullscreen) {
      console.warn('⚠️ [TGWebApp] Fullscreen not supported');
      return;
    }
    this.webApp.requestFullscreen();
  }

  /**
   * Exit fullscreen mode
   */
  exitFullscreen(): void {
    if (!this.webApp?.exitFullscreen) return;
    this.webApp.exitFullscreen();
  }

  /**
   * Close Mini App
   */
  close(): void {
    if (!this.webApp) {
      window.close();
      return;
    }
    this.webApp.close();
  }

  // ===============================
  // EVENT SYSTEM
  // ===============================

  /**
   * Subscribe to events
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * Unsubscribe from events
   */
  off(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    
    const index = handlers.indexOf(handler);
    if (index > -1) handlers.splice(index, 1);
  }

  /**
   * Emit event
   */
  private emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    handlers.forEach(handler => handler(data));
  }
}

// Export singleton instance
export const telegramWebApp = new TelegramWebAppService();
