import React from 'react';

const Background: React.FC = () => {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-black pointer-events-none">
      <div className="absolute top-0 left-0 w-full h-full opacity-30">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full h-full animate-pulse"
          style={{ animationDuration: '10s' }}
        >
          <path
            d="M0 50 Q 25 30 50 50 T 100 50 V 100 H 0 Z"
            fill="url(#grad1)"
            className="animate-wave"
          >
            <animate
              attributeName="d"
              dur="15s"
              repeatCount="indefinite"
              values="
                M0 50 Q 25 30 50 50 T 100 50 V 100 H 0 Z;
                M0 50 Q 25 70 50 50 T 100 50 V 100 H 0 Z;
                M0 50 Q 25 30 50 50 T 100 50 V 100 H 0 Z
              "
            />
          </path>
        </svg>
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style={{ stopColor: '#1a1a1a', stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: '#000000', stopOpacity: 1 }} />
          </linearGradient>
        </defs>
      </div>
      
      {/* Subtle radial gradient for depth */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900/20 via-black to-black" />
    </div>
  );
};

export default Background;
