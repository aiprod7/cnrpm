import React, { useEffect, useRef } from 'react';
import { ChatMessage, TelegramWebApp } from '../types';

interface TranscriptProps {
  messages: ChatMessage[];
  tg: TelegramWebApp | undefined;
}

const Transcript: React.FC<TranscriptProps> = ({ messages, tg }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 w-full max-w-md mx-auto overflow-y-auto px-6 py-4 space-y-4 mask-image-gradient">
      {messages.length === 0 && (
        <div className="h-full flex items-center justify-center text-center">
            <p className="text-gray-500 font-light text-sm italic">
                Conversation will appear here...
            </p>
        </div>
      )}
      
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        return (
          <div
            key={msg.id}
            className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`
                relative max-w-[85%] px-4 py-3 rounded-2xl text-sm font-light leading-relaxed backdrop-blur-md
                ${
                  isUser
                    ? 'bg-white/10 text-white rounded-br-none border border-white/5'
                    : 'bg-black/40 text-gray-100 rounded-bl-none border border-white/10'
                }
              `}
              style={{
                // Subtle adaptation to TG theme colors if available, else standard VoxLux style
                borderColor: isUser ? undefined : tg?.themeParams?.button_color || 'rgba(255,255,255,0.1)'
              }}
            >
              {msg.text}
            </div>
            <div className="flex items-center space-x-1 mt-1 px-1 opacity-60">
                {isUser && msg.inputType === 'text' && (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-gray-400">
                        <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.5 2a.5.5 0 000 1h1a.5.5 0 000-1h-1zm3 0a.5.5 0 000 1h1a.5.5 0 000-1h-1zm3 0a.5.5 0 000 1h1a.5.5 0 000-1h-1zm3 0a.5.5 0 000 1h1a.5.5 0 000-1h-1zm-9 3a.5.5 0 000 1h1a.5.5 0 000-1h-1zm3 0a.5.5 0 000 1h1a.5.5 0 000-1h-1zm3 0a.5.5 0 000 1h1a.5.5 0 000-1h-1zm3 0a.5.5 0 000 1h1a.5.5 0 000-1h-1zm-9 3a.5.5 0 000 1h8a.5.5 0 000-1H6.5a.5.5 0 000 1z" clipRule="evenodd" />
                    </svg>
                )}
                {isUser && (msg.inputType === 'voice' || !msg.inputType) && (
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-gray-400">
                        <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                        <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
                     </svg>
                )}
                <span className="text-[10px] text-gray-500">
                    {msg.role === 'user' ? 'Вы' : 'VoxLux'}
                </span>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};

export default Transcript;