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
  
  // Ref to prevent double greeting in React Strict Mode (dev)
  const hasGreetingPlayed = useRef(false);

  // Initialize Telegram WebApp & Greeting
  useEffect(() => {
    // 1. Setup Telegram if available
    if (window.Telegram?.WebApp) {
      const app = window.Telegram.WebApp;
      app.ready();
      app.expand();
      document.body.style.backgroundColor = '#000000';
      setTg(app);
    }
    
    if (hasGreetingPlayed.current) return;
    hasGreetingPlayed.current = true;

    // 2. Always show greeting, regardless of platform
    setMessages([{
      id: 'init',
      role: 'model',
      text: GREETING_TEXT,
      timestamp: new Date()
    }]);

    // 3. Attempt to speak the greeting
    // Note: Autoplay policies might block this without user interaction on some browsers.
    const speakGreeting = async () => {
        // Small delay to ensure UI mount
        await new Promise(resolve => setTimeout(resolve, 500));
        
        setAppState(AppState.SPEAKING);
        try {
            await voiceService.speak(GREETING_TEXT);
        } catch (e) {
            console.warn("Auto-greeting might be blocked by browser policy:", e);
        } finally {
            setAppState(AppState.IDLE);
        }
    };

    speakGreeting();
  }, []);

  const handleMicButton = async () => {
    // Case 1: Manual Stop
    if (appState === AppState.LISTENING) {
       voiceService.stopListening();
       // The 'listen' promise in runConversation will resolve (empty), handling the state transition.
       return;
    }

    // Case 2: Start
    if (appState === AppState.IDLE) {
       await runConversation();
    }
  };

  const runConversation = async () => {
    try {
      // 1. Setup Audio Analysis for Visualizer
      // Note: We start this before recognition to ensure visualizer is ready
      const audioAnalyser = await voiceService.startAudioAnalysis();
      setAnalyser(audioAnalyser);
      setAppState(AppState.LISTENING);
      tg?.HapticFeedback.impactOccurred('medium');

      // 2. Listen for Speech
      let transcript = "";
      try {
        transcript = await voiceService.listen();
      } catch (err) {
        console.warn("Speech recognition error:", err);
        // Do not go to ERROR state for simple recognition aborts/no-speech
      }

      // Cleanup Mic Analysis immediately after listening stops
      voiceService.stopAudioAnalysis();
      setAnalyser(null);

      // If no speech was detected or stopped manually
      if (!transcript) {
        setAppState(AppState.IDLE);
        return;
      }

      // 3. Update Transcript (User)
      const userMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          text: transcript,
          timestamp: new Date()
      };
      setMessages(prev => [...prev, userMsg]);

      // 4. Send to n8n (Processing)
      setAppState(AppState.PROCESSING);
      const result = await sendQueryToN8n(transcript, tg?.initDataUnsafe?.user?.id?.toString());
      
      // 5. Update Transcript (Model)
      const botMsg: ChatMessage = {
          id: Date.now().toString() + '_bot',
          role: 'model',
          text: result.aiResponse,
          timestamp: new Date()
      };
      setMessages(prev => [...prev, botMsg]);

      // 6. Speak Response (TTS)
      if (result.meta.shouldSpeak) {
          setAppState(AppState.SPEAKING);
          await voiceService.speak(result.aiResponse);
      }

      setAppState(AppState.IDLE);
      tg?.HapticFeedback.notificationOccurred('success');

    } catch (e) {
      console.error("Conversation Flow Error", e);
      // Ensure we clean up if something exploded
      voiceService.stopAudioAnalysis();
      setAnalyser(null);
      
      setAppState(AppState.ERROR);
      tg?.HapticFeedback.notificationOccurred('error');
      
      // Reset after a moment
      setTimeout(() => setAppState(AppState.IDLE), 3000);
    }
  };

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

        {/* Visualizer (Hero) */}
        <div className="flex-none h-[40vh] flex items-center justify-center">
          <Visualizer 
            analyser={analyser} 
            state={appState} 
          />
        </div>

        {/* Transcript */}
        <Transcript messages={messages} tg={tg} />

        {/* Controls */}
        <div className="flex-none p-6 w-full flex justify-center pb-12">
            <button
                onClick={handleMicButton}
                disabled={appState === AppState.PROCESSING || appState === AppState.SPEAKING}
                className={`
                    group relative px-8 py-4 rounded-full font-medium tracking-wide text-lg 
                    shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all w-full max-w-xs overflow-hidden
                    ${appState === AppState.LISTENING 
                        ? 'bg-red-900/80 text-white border border-red-500/50 hover:bg-red-800' 
                        : 'bg-white text-black hover:scale-105 active:scale-95'}
                    ${(appState === AppState.PROCESSING || appState === AppState.SPEAKING) ? 'opacity-50 cursor-not-allowed' : ''}
                `}
            >
                <span className="relative z-10">
                    {appState === AppState.LISTENING ? 'Stop Listening' : 
                     appState === AppState.PROCESSING ? 'Processing...' :
                     appState === AppState.SPEAKING ? 'Speaking...' :
                     'Tap to Speak'}
                </span>
                {appState === AppState.IDLE && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent translate-x-[-100%] group-hover:animate-shine" />
                )}
            </button>
        </div>
      </div>
      
      {/* Error Toast */}
      {appState === AppState.ERROR && (
         <div className="absolute top-0 left-0 w-full p-4 bg-red-900/90 text-white text-center text-sm z-50 backdrop-blur-sm">
            Operation failed. Please check permissions or network.
         </div>
      )}
    </div>
  );
};

export default App;