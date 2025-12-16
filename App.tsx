import React, { useEffect, useState, useRef } from 'react';
import Background from './components/Background';
import Visualizer from './components/Visualizer';
import Transcript from './components/Transcript';
import { TelegramWebApp, ChatMessage, AppState } from './types';
import { voiceService } from './services/voiceService'; // Legacy - for text mode TTS
import { geminiService } from './services/geminiService'; // NEW - Unified STT+TTS
import { sendQueryToN8n } from './services/n8nService';
import { GREETING_TEXT } from './constants';

const App: React.FC = () => {
  const [tg, setTg] = useState<TelegramWebApp | undefined>(undefined);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  
  // Text Input State
  const [isTextMode, setIsTextMode] = useState(false);
  const [inputText, setInputText] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [realtimeTranscript, setRealtimeTranscript] = useState<string>(""); // Live API real-time display
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  
  // Debug logs (visible in UI for Telegram Mini Apps debugging)
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const addDebugLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    const logEntry = `[${timestamp}] ${message}`;
    setDebugLogs(prev => [...prev.slice(-20), logEntry]); // Keep last 20 logs
    console.log(message); // Still log to console too
  };

  // Refs for stability in effects (Stale closure prevention)
  const inputTextRef = useRef(inputText);
  const hasGreetingPlayed = useRef(false);

  useEffect(() => { inputTextRef.current = inputText; }, [inputText]);

  // Setup real-time transcript callback for Live API
  useEffect(() => {
    voiceService.setOnRealtimeTranscript((transcript) => {
      setRealtimeTranscript(transcript);
    });
  }, []);

  // Initialize Telegram WebApp & Greeting
  useEffect(() => {
    // 1. Setup Telegram if available
    if (window.Telegram?.WebApp) {
      const app = window.Telegram.WebApp;
      app.ready();
      app.expand();
      
      try {
        // Set Header to Black to match app theme (Native TMA behavior)
        app.setHeaderColor('#000000');
        app.setBackgroundColor('#000000');
        
        // Ensure MainButton defaults
        app.MainButton.setParams({
            text: 'ОТПРАВИТЬ',
            color: '#ffffff',
            text_color: '#000000'
        });
      } catch (e) {
        console.warn("Failed to set TG colors", e);
      }
      
      document.body.style.backgroundColor = '#000000';
      setTg(app);
    }
    
    if (hasGreetingPlayed.current) return;
    hasGreetingPlayed.current = true;

    // 2. Initialize microphone permission manager early (prevents repeated dialogs)
    (async () => {
      try {
        addDebugLog('🎤 Инициализация разрешений микрофона...');
        const { microphoneManager } = await import('./services/microphoneManager');
        const granted = await microphoneManager.initialize();
        if (granted) {
          addDebugLog('✅ Разрешение микрофона кешировано');
        } else {
          addDebugLog('⚠️ Разрешение микрофона не получено (будет запрошено при использовании)');
        }
      } catch (error: any) {
        console.error('Failed to initialize microphone manager:', error);
        addDebugLog(`❌ Ошибка инициализации микрофона: ${error.message}`);
      }
    })();

    // 3. Show greeting text only
    setMessages([{
      id: 'init',
      role: 'model',
      text: GREETING_TEXT,
      timestamp: new Date()
    }]);
  }, []);

  // --- Shared Processing Logic ---
  const processQuery = async (text: string, inputType: 'voice' | 'text') => {
    addDebugLog(`📝 Обработка запроса (${inputType})`);
    console.log(`📝 [Process] Query text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
    
    if (!text.trim()) return;

    // 1. Update Transcript (User) - only for text mode (voice already added in runVoiceConversation)
    if (inputType === 'text') {
      const userMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          text: text,
          timestamp: new Date(),
          inputType
      };
      setMessages(prev => [...prev, userMsg]);
    }

    // 2. Send to n8n (Processing)
    console.log("🔄 [Process] Sending to n8n...");
    const n8nStart = performance.now();
    setAppState(AppState.PROCESSING);
    
    // Clear text input if in text mode
    if (inputType === 'text') {
        setInputText("");
    }

    try {
        const result = await sendQueryToN8n(text, tg?.initDataUnsafe?.user?.id?.toString(), inputType);
        addDebugLog(`✅ Ответ получен за ${Math.round(performance.now() - n8nStart)}ms`);
        
        // 3. Update Transcript (Model)
        const botMsg: ChatMessage = {
            id: Date.now().toString() + '_bot',
            role: 'model',
            text: result.aiResponse,
            timestamp: new Date(),
            inputType: 'voice'
        };
        setMessages(prev => [...prev, botMsg]);

        // 4. Speak Response (TTS)
        if (result.meta.shouldSpeak) {
            setAppState(AppState.SPEAKING);
            addDebugLog(`🔊 TTS: gemini-2.5-flash-preview-tts (голос Kore)`);
            try {
                // If in text mode, visualizer works on 'SPEAKING' state automatically via simulation
                await voiceService.speak(result.aiResponse);
                addDebugLog(`✅ TTS завершён`);
            } catch (speakError: any) {
                addDebugLog(`❌ TTS ошибка: ${speakError?.message || speakError}`);
            }
        }
    } catch (e: any) {
        addDebugLog(`❌ Ошибка обработки: ${e?.message || e}`);
        setAppState(AppState.ERROR);
        setTimeout(() => setAppState(AppState.IDLE), 3000);
        return;
    }

    setAppState(AppState.IDLE);
    tg?.HapticFeedback.notificationOccurred('success');
  };

  // State for speech recognition support warning
  const [showSpeechWarning, setShowSpeechWarning] = useState(false);
  const [micPermissionRequested, setMicPermissionRequested] = useState(false);

  // Request microphone permission on first user interaction
  const requestMicPermission = async () => {
    if (micPermissionRequested) return;
    setMicPermissionRequested(true);
    
    // This will prompt for permission only once, then cache the stream
    const stream = await voiceService.requestMicrophoneAccess();
    if (stream) {
      console.log("Microphone permission granted on first interaction");
      tg?.HapticFeedback.impactOccurred('light');
    }
  };

  // --- Voice Handlers (NEW: Unified Gemini Live) ---
  const handleMicButton = async () => {
    addDebugLog(`🎤 [Button] Нажата кнопка, состояние: ${appState}`);
    
    // 1. Stop mode (if already listening or speaking)
    if (appState === AppState.LISTENING || appState === AppState.SPEAKING) {
       addDebugLog("⏹️ [Button] Остановка Gemini Live...");
       await geminiService.disconnect();
       setAppState(AppState.IDLE);
       setAnalyser(null);
       setRealtimeTranscript("");
       tg?.HapticFeedback.impactOccurred('medium');
       return;
    }

    // 2. Start mode (connect to Gemini Live)
    if (appState === AppState.IDLE) {
       await runVoiceConversation();
    }
  };

  const runVoiceConversation = async () => {
    addDebugLog("🚀 [GeminiLive] Подключение к unified model...");
    
    try {
      // Connect to Gemini Live (Unified STT+TTS)
      await geminiService.connect({
        // Callback for transcript updates (both STT and TTS text)
        onTranscriptUpdate: (text: string, isUser: boolean, isFinal: boolean) => {
          if (!isFinal) {
            // Real-time streaming (not final yet)
            if (isUser) {
              addDebugLog(`📝 [STT] "${text}"`);
              setRealtimeTranscript(text);
              setAppState(AppState.LISTENING);
            } else {
              addDebugLog(`💬 [TTS Text] "${text}"`);
              setAppState(AppState.SPEAKING);
            }
          } else {
            // Final message (turn complete)
            addDebugLog(`✅ [${isUser ? 'User' : 'Model'}] Final: "${text}"`);
            
            // Add to chat
            setMessages(prev => {
              // Check if last message is same role (update it)
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === (isUser ? 'user' : 'model') && !lastMsg.id.endsWith('_final')) {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...lastMsg,
                  text: text,
                  id: lastMsg.id + '_final'
                };
                return updated;
              }
              
              // Create new message
              return [...prev, {
                id: Date.now().toString() + (isUser ? '_user' : '_model') + '_final',
                role: isUser ? 'user' : 'model',
                text: text,
                timestamp: new Date(),
                inputType: 'voice'
              }];
            });
            
            // Clear real-time preview after final
            if (isUser) {
              setRealtimeTranscript("");
            }
          }
        },
        
        onClose: () => {
          addDebugLog("🔌 [GeminiLive] Соединение закрыто");
          setAppState(AppState.IDLE);
          setAnalyser(null);
          setRealtimeTranscript("");
        },
        
        onError: (err: Error) => {
          addDebugLog(`❌ [GeminiLive] Ошибка: ${err.message}`);
          setAppState(AppState.ERROR);
          setTimeout(() => setAppState(AppState.IDLE), 3000);
        }
      });

      // Get analyser for visualizer
      setAnalyser(geminiService.getAnalyserNode());
      setAppState(AppState.LISTENING);
      tg?.HapticFeedback.impactOccurred('medium');
      addDebugLog("✅ [GeminiLive] Подключено, готово к разговору");

    } catch (e: any) {
      addDebugLog(`❌ [GeminiLive] Ошибка подключения: ${e.message}`);
      setAppState(AppState.ERROR);
      setTimeout(() => setAppState(AppState.IDLE), 3000);
    }
  };

  // --- Text Handlers ---
  const toggleTextMode = () => {
    setIsTextMode(!isTextMode);
    setInputError(null);
    if (!isTextMode) {
        // Delay focus slightly to allow render
        setTimeout(() => textInputRef.current?.focus(), 100);
    }
  };

  const handleTextSubmit = async () => {
      // CRITICAL FIX: "Warm up" AudioContext immediately inside the user event handler.
      // This ensures the browser allows audio playback later when the network request finishes.
      await voiceService.prepareForSpeech();

      // Use ref to get current value inside closures/callbacks
      const text = inputTextRef.current;
      if (!text.trim()) return;

      // Cyrillic Validation: Check if string contains at least one Cyrillic character
      const hasCyrillic = /[а-яА-ЯёЁ]/.test(text);
      if (!hasCyrillic) {
          setInputError("Пожалуйста, введите вопрос на русском языке.");
          tg?.HapticFeedback.notificationOccurred('warning');
          return;
      }
      
      setInputError(null);
      await processQuery(text, 'text');
  };

  // Keep a stable ref to the submit handler for the useEffect below
  const submitHandlerRef = useRef(handleTextSubmit);
  useEffect(() => { submitHandlerRef.current = handleTextSubmit; }, [handleTextSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleTextSubmit();
      }
  };

  // --- Telegram MainButton Integration ---
  
  // Effect: Control MainButton Visibility and Progress
  useEffect(() => {
    if (!tg) return;
    const mainBtn = tg.MainButton;

    // Show progress if processing
    if (appState === AppState.PROCESSING) {
        mainBtn.showProgress(false); // keep active? false usually means just spinner
    } else {
        mainBtn.hideProgress();
    }

    // Update visibility based on text content only in text mode
    if (isTextMode && inputText.trim().length > 0) {
        if (appState === AppState.IDLE) {
            mainBtn.enable();
            mainBtn.show();
        }
    } else {
        if (appState !== AppState.PROCESSING) {
             mainBtn.hide(); 
        }
    }
  }, [tg, isTextMode, inputText, appState]);

  // Effect: Bind Click Listener
  useEffect(() => {
    if (!tg) return;
    const mainBtn = tg.MainButton;

    const onMainBtnClick = () => {
        submitHandlerRef.current();
    };

    if (isTextMode) {
        mainBtn.onClick(onMainBtnClick);
    } else {
        mainBtn.offClick(onMainBtnClick);
        mainBtn.hide();
    }

    return () => {
        mainBtn.offClick(onMainBtnClick);
    };
  }, [tg, isTextMode]);


  return (
    <div className="relative h-screen w-screen flex flex-col font-sans overflow-hidden text-white">
      <Background />

      <div className="relative z-10 flex flex-col h-full pt-[var(--tg-content-safe-area-inset-top)] pb-[var(--tg-content-safe-area-inset-bottom)]">
        
        {/* Header */}
        <header className="px-6 pt-6 pb-2 flex justify-between items-center opacity-80">
          <div className="flex flex-col">
            <h1 className="text-xl font-light tracking-[0.2em] uppercase">
              VoxLux <span className="text-xs text-gray-600 font-normal">v{process.env.APP_VERSION}</span>
            </h1>
            <div className="text-[9px] text-gray-500 font-mono mt-0.5 tracking-tight">
              {process.env.BRANCH_NAME} • {process.env.TTS_MODEL_NAME}
            </div>
          </div>
          <div className={`w-2 h-2 rounded-full transition-colors duration-500
            ${appState === AppState.LISTENING ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]' : 
              appState === AppState.PROCESSING ? 'bg-purple-500 animate-pulse' :
              appState === AppState.SPEAKING ? 'bg-blue-400' : 'bg-gray-500'}`} 
          />
        </header>

        {/* Visualizer (Hero) - De-emphasize when in Text Mode */}
        <div className={`flex-none h-[35vh] flex items-center justify-center transition-all duration-500 ${isTextMode ? 'opacity-30 scale-90 blur-sm' : 'opacity-100 scale-100'}`}>
          <Visualizer 
            analyser={analyser} 
            state={appState} 
          />
        </div>

        {/* Transcript */}
        <Transcript messages={messages} tg={tg} />

        {/* Controls Area */}
        <div className="flex-none p-6 w-full flex flex-col justify-end pb-8 min-h-[140px] transition-all duration-300">
            
            {/* Text Input UI */}
            {isTextMode ? (
                <div className="w-full max-w-sm mx-auto animate-fadeInUp">
                    <div className="relative bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 overflow-hidden shadow-2xl">
                         <textarea
                            ref={textInputRef}
                            value={inputText}
                            onChange={(e) => {
                                setInputText(e.target.value);
                                if (inputError) setInputError(null);
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder="Напишите ваш вопрос на русском..."
                            className="w-full bg-transparent text-white p-4 text-base outline-none resize-none h-24 placeholder-gray-400 font-light"
                         />
                         {/* Validation Message */}
                         <div className="flex justify-between items-center px-4 pb-3 min-h-[1.5rem]">
                             <span className="text-xs text-red-400 w-full truncate">{inputError}</span>
                             {/* Native MainButton replaces the HTML button */}
                         </div>
                    </div>
                    <button 
                        onClick={toggleTextMode} 
                        className="mx-auto mt-4 text-xs text-gray-500 hover:text-white uppercase tracking-widest block transition-colors"
                    >
                        Back to Voice
                    </button>
                </div>
            ) : (
                /* Voice Input UI */
                <div className="flex flex-col items-center justify-center w-full max-w-xs mx-auto animate-fadeIn space-y-3">
                    {/* Real-time Transcript Display (Live API) */}
                    {appState === AppState.LISTENING && realtimeTranscript && (
                        <div className="w-full bg-blue-500/20 backdrop-blur-sm rounded-lg p-3 border border-blue-400/30 animate-fadeIn">
                            <p className="text-sm text-blue-100 text-center font-light">
                                🎙️ {realtimeTranscript}
                            </p>
                        </div>
                    )}
                    
                    <div className="flex items-center justify-center space-x-6 w-full">
                         {/* Text Mode Toggle */}
                        <button
                            onClick={toggleTextMode}
                            className="p-4 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white hover:scale-105 active:scale-95 transition-all"
                            aria-label="Switch to Text Mode"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                            </svg>
                        </button>

                        {/* Main Mic Button */}
                        <button
                            onClick={handleMicButton}
                            disabled={appState === AppState.PROCESSING || appState === AppState.SPEAKING}
                            className={`
                                group relative px-8 py-4 rounded-full font-medium tracking-wide text-lg flex-1
                                shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all overflow-hidden
                                ${appState === AppState.LISTENING 
                                    ? 'bg-red-900/80 text-white border border-red-500/50 hover:bg-red-800' 
                                    : 'bg-white text-black hover:scale-105 active:scale-95'}
                                ${(appState === AppState.PROCESSING || appState === AppState.SPEAKING) ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                        >
                            <span className="relative z-10 whitespace-nowrap">
                                {appState === AppState.LISTENING ? 'Stop' : 
                                appState === AppState.SPEAKING ? 'Interrupt' :
                                appState === AppState.PROCESSING ? 'Thinking...' :
                                'Start Live'}
                            </span>
                            {appState === AppState.IDLE && (
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent translate-x-[-100%] group-hover:animate-shine" />
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
      </div>
      
      {/* Error Toast */}
      {appState === AppState.ERROR && (
         <div className="absolute top-0 left-0 w-full p-4 bg-red-900/90 text-white text-center text-sm z-50 backdrop-blur-sm">
            Operation failed. Please check permissions or network.
         </div>
      )}
      
      {/* Speech Recognition / Microphone Warning */}
      {showSpeechWarning && (
         <div className="absolute top-0 left-0 w-full p-4 bg-yellow-700/90 text-white text-center text-sm z-50 backdrop-blur-sm">
            {microphoneError || (voiceService.hasMicrophonePermission() 
              ? "Голосовой ввод недоступен. Используйте текстовый режим."
              : "Разрешите доступ к микрофону для голосового ввода или используйте текст.")}
         </div>
      )}
      
      {/* Debug Panel Toggle Button (bottom-right) */}
      <button
        onClick={() => setShowDebugPanel(!showDebugPanel)}
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full bg-purple-600/80 hover:bg-purple-500 text-white font-mono text-xs flex items-center justify-center shadow-lg backdrop-blur-sm border border-purple-400/30 transition-all"
        aria-label="Toggle Debug Panel"
      >
        {showDebugPanel ? '✕' : '🐛'}
      </button>
      
      {/* Debug Panel (Telegram Mini Apps console replacement) */}
      {showDebugPanel && (
        <div className="fixed bottom-20 right-4 w-[90vw] max-w-md h-64 bg-black/95 border border-purple-500/50 rounded-lg shadow-2xl z-40 flex flex-col">
          <div className="px-3 py-2 bg-purple-900/50 border-b border-purple-500/30 flex justify-between items-center">
            <span className="text-purple-300 font-mono text-xs font-bold">🐛 Debug Logs</span>
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  const logsText = debugLogs.join('\n');
                  navigator.clipboard.writeText(logsText).then(() => {
                    addDebugLog('📋 Логи скопированы в буфер');
                    setTimeout(() => {
                      setDebugLogs(prev => prev.filter(log => !log.includes('скопированы в буфер')));
                    }, 2000);
                  }).catch(err => {
                    addDebugLog('❌ Ошибка копирования: ' + err.message);
                  });
                }}
                className="text-purple-400 hover:text-white text-xs font-mono px-2 py-1 rounded bg-purple-800/50 hover:bg-purple-700"
                title="Копировать в буфер"
              >
                📋
              </button>
              <button 
                onClick={() => setDebugLogs([])}
                className="text-purple-400 hover:text-white text-xs font-mono px-2 py-1 rounded bg-purple-800/50 hover:bg-purple-700"
              >
                Очистить
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-xs text-green-400 space-y-1">
            {debugLogs.length === 0 ? (
              <div className="text-gray-500 italic">Логи появятся здесь...</div>
            ) : (
              debugLogs.map((log, idx) => (
                <div key={idx} className="break-words">{log}</div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
