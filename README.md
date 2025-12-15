<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# VoxLux - OpenRouter Version

Voice Assistant using OpenRouter API for Speech-to-Text (STT) with google/gemini-2.5-flash model.

## Features

- **STT (Speech-to-Text)**: OpenRouter API with google/gemini-2.5-flash model
- **TTS (Text-to-Speech)**: Web Speech API (speechSynthesis)
- **Telegram Mini App**: Full support for Telegram WebView

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` file with your OpenRouter API key:
   ```
   OPENROUTER_API_KEY=sk-or-v1-your-key-here
   ```

3. Run the app:
   ```bash
   npm run dev
   ```

## Deploy to Azure Static Web Apps

1. Add `OPENROUTER_API_KEY` secret to GitHub repository settings
2. Push to `main` branch - automatic deployment via GitHub Actions

## API Keys

- Get OpenRouter API key: https://openrouter.ai/keys
- Model used: `google/gemini-2.5-flash` (supports audio input)
