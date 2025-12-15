import React, { useEffect, useState, useRef } from 'react';
import Background from './components/Background';
import Visualizer from './components/Visualizer';
import Transcript from './components/Transcript';
import { TelegramWebApp, ChatMessage, AppState } from './types';
import { voiceService } from './services/voiceService';
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
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Refs for stability in effects (Stale closure prevention)
  const inputTextRef = useRef(inputText);
  const hasGreetingPlayed = useRef(false);

  useEffect(() => { inputTextRef.current = inputText; }, [inputText]);

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

    // 2. Show greeting text only
    setMessages([{
      id: 'init',
      role: 'model',
      text: GREETING_TEXT,
      timestamp: new Date()
    }]);
  }, []);

  // --- Shared Processing Logic ---
  const processQuery = async (text: string, inputType: 'voice' | 'text') => {
    if (!text.trim()) return;

    // 1. Update Transcript (User)
    const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        text: text,
        timestamp: new Date(),
        inputType
    };
    setMessages(prev => [...prev, userMsg]);

    // 2. Send to n8n (Processing)
    setAppState(AppState.PROCESSING);
    
    // Clear text input if in text mode
    if (inputType === 'text') {
        setInputText("");
    }

    try {
        const result = await sendQueryToN8n(text, tg?.initDataUnsafe?.user?.id?.toString(), inputType);
        
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
            try {
                // If in text mode, visualizer works on 'SPEAKING' state automatically via simulation
                await voiceService.speak(result.aiResponse);
            } catch (speakError) {
                console.error("Speaking failed:", speakError);
            }
        }
    } catch (e) {
        console.error("Processing Error", e);
        setAppState(AppState.ERROR);
        setTimeout(() => setAppState(AppState.IDLE), 3000);
        return;
    }

    setAppState(AppState.IDLE);
    tg?.HapticFeedback.notificationOccurred('success');
  };

  // State for speech recognition support warning
  const [showSpeechWarning, setShowSpeechWarning] = useState(false);

  // --- Voice Handlers ---
  const handleMicButton = async () => {
    if (appState === AppState.LISTENING) {
       voiceService.stopListening();
       return;
    }
    if (appState === AppState.IDLE) {
       // Check if speech recognition is supported
       if (!voiceService.isSpeechRecognitionSupported()) {
         console.warn("Speech Recognition not supported, showing warning");
         setShowSpeechWarning(true);
         tg?.HapticFeedback.notificationOccurred('warning');
         setTimeout(() => setShowSpeechWarning(false), 5000);
         return;
       }
       await runVoiceConversation();
    }
  };

  const runVoiceConversation = async () => {
    try {
      // AudioContext is initialized/resumed here (direct click)
      const audioAnalyser = await voiceService.startAudioAnalysis();
      if (audioAnalyser) {
        setAnalyser(audioAnalyser);
      }
      setAppState(AppState.LISTENING);
      tg?.HapticFeedback.impactOccurred('medium');

      let transcript = "";
      try {
        transcript = await voiceService.listen();
      } catch (err) {
        console.warn("Speech recognition error:", err);
      }

      voiceService.stopAudioAnalysis();
      setAnalyser(null);

      if (!transcript) {
        setAppState(AppState.IDLE);
        return;
      }

      await processQuery(transcript, 'voice');

    } catch (e) {
      console.error("Voice Conversation Flow Error", e);
      voiceService.stopAudioAnalysis();
      setAnalyser(null);
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
          <h1 className="text-xl font-light tracking-[0.2em] uppercase">VoxLux</h1>
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
                <div className="flex items-center justify-center space-x-6 w-full max-w-xs mx-auto animate-fadeIn">
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
                            appState === AppState.PROCESSING ? 'Thinking...' :
                            appState === AppState.SPEAKING ? 'Speaking...' :
                            'Tap to Speak'}
                        </span>
                        {appState === AppState.IDLE && (
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent translate-x-[-100%] group-hover:animate-shine" />
                        )}
                    </button>
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
      
      {/* Speech Recognition Warning */}
      {showSpeechWarning && (
         <div className="absolute top-0 left-0 w-full p-4 bg-yellow-700/90 text-white text-center text-sm z-50 backdrop-blur-sm">
            Голосовой ввод недоступен в этом браузере. Используйте текстовый режим.
         </div>
      )}
    </div>
  );
};

export default App;
