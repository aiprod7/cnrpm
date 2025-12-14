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
                max-w-[85%] px-4 py-3 rounded-2xl text-sm font-light leading-relaxed backdrop-blur-md
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
            <span className="text-[10px] text-gray-600 mt-1 px-1">
              {msg.role === 'user' ? 'You' : 'VoxLux'}
            </span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};

export default Transcript;
