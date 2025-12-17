import React, { useEffect, useRef } from 'react';
import { AppState } from '../types';
import { 
  VISUALIZER_COLOR_PRIMARY, 
  VISUALIZER_COLOR_SECONDARY, 
  VISUALIZER_COLOR_ACCENT,
  VISUALIZER_COLOR_PROCESSING
} from '../constants';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  state: AppState;
}

const Visualizer: React.FC<VisualizerProps> = ({ analyser, state }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize handling
    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let angle = 0;
    let time = 0;

    const draw = () => {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = Math.min(width, height) * 0.25;

      ctx.clearRect(0, 0, width, height);

      // Determine active color based on state
      let activeColor = VISUALIZER_COLOR_PRIMARY;
      if (state === AppState.LISTENING) activeColor = VISUALIZER_COLOR_ACCENT;
      if (state === AppState.PROCESSING) activeColor = VISUALIZER_COLOR_PROCESSING;

      let dataArray = new Uint8Array(0);
      let average = 0;

      // LISTENING: Use Real Analyser Data
      if (state === AppState.LISTENING && analyser) {
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        average = sum / bufferLength;
      } 
      // SPEAKING: Simulate Activity
      else if (state === AppState.SPEAKING) {
        // Create fake frequency data based on sine waves to simulate speech
        average = (Math.sin(time * 0.1) + Math.sin(time * 0.23) + 2) * 30; 
      }
      // PROCESSING: Fast pulse
      else if (state === AppState.PROCESSING) {
         average = (Math.sin(time * 0.2) + 1) * 20;
      }

      // Base idle animation
      const idlePulse = (state === AppState.IDLE) ? Math.sin(time * 0.05) * 5 : 0;
      const volumeScale = (state !== AppState.IDLE) ? (average / 255) * 60 : 0;
      
      const radius = baseRadius + volumeScale + idlePulse;

      // Draw Organic Blob
      ctx.beginPath();
      const points = 8;
      for (let i = 0; i <= points; i++) {
        const theta = (i / points) * Math.PI * 2 + angle;
        
        let distortion = 0;
        
        if (state === AppState.LISTENING && dataArray.length > 0) {
           distortion = (dataArray[i % dataArray.length] / 255) * 20;
        } else if (state === AppState.SPEAKING) {
           // Simulated organic distortion
           distortion = Math.sin(theta * 5 + time * 0.2) * (average / 5);
        } else {
           distortion = Math.cos(theta * 3 + angle * 2) * 5;
        }

        const r = radius + distortion;
        const x = centerX + r * Math.cos(theta);
        const y = centerY + r * Math.sin(theta);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      
      // Styling
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; // Inner void
      ctx.fill();
      ctx.strokeStyle = (state === AppState.IDLE) ? VISUALIZER_COLOR_SECONDARY : activeColor;
      ctx.lineWidth = (state !== AppState.IDLE) ? 3 : 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Outer Glow
      if (state !== AppState.IDLE) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = activeColor;
      } else {
        ctx.shadowBlur = 0;
      }

      angle += 0.01;
      time += 1;
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, state]);

  return (
    <div className="relative w-64 h-64 mx-auto flex items-center justify-center">
        <canvas 
            ref={canvasRef} 
            className="w-full h-full"
        />
        {state === AppState.IDLE && (
            <div className="absolute pointer-events-none text-gray-400 text-sm tracking-widest uppercase opacity-70 font-light animate-pulse">
                Tap to Speak
            </div>
        )}
         {state === AppState.PROCESSING && (
            <div className="absolute pointer-events-none text-purple-400 text-xs tracking-widest uppercase opacity-80 animate-pulse">
                Thinking...
            </div>
        )}
    </div>
  );
};

export default Visualizer;
