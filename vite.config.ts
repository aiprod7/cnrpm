import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.API_KEY || ''),
        // Default Gemini API Key (provided). Prefer setting env var `DEFAULT_GEMINI_API_KEY` in deployment instead of committing secrets.
        'process.env.DEFAULT_GEMINI_API_KEY': JSON.stringify(env.DEFAULT_GEMINI_API_KEY || 'AIzaSyAcRPhtq_hMRK2JXh2GaIQyX2yjV46ZCf0'),
        'process.env.BRANCH_NAME': JSON.stringify(env.BRANCH_NAME || 'gemini'),
        'process.env.TTS_MODEL_NAME': JSON.stringify('gemini-2.5-flash-preview-tts (Kore)'),
        'process.env.APP_VERSION': JSON.stringify('1.0.0')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
