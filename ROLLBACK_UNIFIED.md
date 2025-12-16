# 🔄 Rollback Instructions - Unified Gemini Live Architecture

## 📋 Overview

If the **unified Gemini Live architecture** (v1.5.0) doesn't work as expected, follow these instructions to rollback to the **stable version** (v1.4.1).

**Backup Tag**: `backup-before-gemini-live`  
**Commit**: a4c816d  
**Date**: December 17, 2025

---

## ⚡ Quick Rollback (Recommended)

### Method 1: Git Reset (Fastest)

```bash
cd e:\tg_mini_apps\voxlux
git reset --hard backup-before-gemini-live
git push origin gemini --force
```

**What this does**:
- Resets code to v1.4.1 (before unified model changes)
- Restores separate STT and TTS services
- Force pushes to remote (⚠️ overwrites current version)

---

## 🔍 Detailed Rollback Methods

### Method 2: Cherry-pick Specific Files

If you want to keep some changes but rollback specific files:

```bash
# Rollback only geminiService.ts
git checkout backup-before-gemini-live -- services/geminiService.ts

# Rollback package.json
git checkout backup-before-gemini-live -- package.json

# Commit changes
git add services/geminiService.ts package.json
git commit -m "rollback: Restore separate STT/TTS services"
git push origin gemini
```

### Method 3: Manual Code Restoration

If git is unavailable, manually restore these files:

#### 1. Restore `services/geminiService.ts`

```typescript
// v1.4.1 version (OLD architecture - separate STT/TTS)
// This file should be restored from backup-before-gemini-live tag
// Or download from GitHub: https://github.com/aiprod7/cnrpm/blob/backup-before-gemini-live/services/geminiService.ts
```

#### 2. Restore `package.json`

```json
{
  "name": "voxlux",
  "private": true,
  "version": "1.4.1",  // ← Change from 1.5.0-unified
  "type": "module",
  // ... rest of file
}
```

#### 3. Verify Services Are Working

**STT Service**: `services/liveTranscriptionService.ts` (should exist and work)  
**TTS Service**: `services/voiceService.ts` (should exist and work)

---

## 🧪 Testing After Rollback

### 1. Check STT (Speech-to-Text)

```bash
# Should see these logs in console:
# 🎤 [STT] Using Live API (model: gemini-2.5-flash-native-audio-preview-12-2025)
# ✅ [LiveTranscription] Connected to gemini-2.5-flash-native-audio-preview-12-2025
```

**Test**: Tap "Tap to Speak" → Speak → Should see transcript

### 2. Check TTS (Text-to-Speech)

```bash
# Should see these logs in console:
# 🔊 [TTS] Generating speech (model: gemini-2.5-flash-preview-tts, voice: Kore)...
```

**Test**: After AI responds, should hear voice

### 3. Check Fallbacks

```bash
# If Live API fails, should fall back to batch mode:
# 🎤 [STT] Starting Gemini STT (batch mode, model: gemini-2.5-flash)...
```

**Test**: Disconnect internet briefly → Should still work with fallback

---

## 🔍 Common Issues After Rollback

### Issue 1: "geminiService is not defined"

**Symptom**: `App.tsx` tries to import unified service  
**Solution**: Update `App.tsx` imports:

```typescript
// ❌ Remove if exists:
import { geminiService } from './services/geminiService';

// ✅ Should use old services:
import { voiceService } from './services/voiceService';
import { liveTranscriptionService } from './services/liveTranscriptionService';
```

### Issue 2: TypeScript Errors

**Symptom**: `LiveConfig interface not found`  
**Solution**: Old `geminiService.ts` uses different interfaces

```typescript
// v1.4.1 interfaces:
interface LiveSessionConfig {
  onAudioData: AudioDataCallback;
  onTranscript: TranscriptCallback;
  onClose: () => void;
  onError: (err: any) => void;
}
```

### Issue 3: Missing Logs

**Symptom**: Logs say "Using unified model" but should say separate models  
**Solution**: Clear browser cache and hard reload (Ctrl+Shift+R)

---

## 📊 Rollback Checklist

- [ ] Git reset to `backup-before-gemini-live` tag
- [ ] Verify `package.json` version is `1.4.1`
- [ ] Check `services/geminiService.ts` exists (old version)
- [ ] Check `services/liveTranscriptionService.ts` exists
- [ ] Check `services/voiceService.ts` exists
- [ ] Test STT (microphone → transcript)
- [ ] Test TTS (AI response → voice)
- [ ] Check console logs show separate models
- [ ] Verify visualizer works
- [ ] Test in Telegram Mini Apps

---

## 🎯 Expected Behavior After Rollback

### Architecture (v1.4.1 - Stable)

```
User Speech → liveTranscriptionService (STT)
   ↓
Text Transcript → n8nService (AI Processing)
   ↓
AI Response Text → voiceService (TTS)
   ↓
Audio Playback
```

### Models Used

| Task | Model | File |
|------|-------|------|
| **STT Primary** | `gemini-2.5-flash-native-audio-preview-12-2025` | `liveTranscriptionService.ts` |
| **STT Fallback** | `gemini-2.5-flash` | `voiceService.ts` |
| **TTS** | `gemini-2.5-flash-preview-tts` | `voiceService.ts` |

### Logs You Should See

```
🎤 [STT] Using Live API (model: gemini-2.5-flash-native-audio-preview-12-2025)
🚀 [LiveTranscription] Starting session with gemini-2.5-flash-native-audio-preview-12-2025...
✅ [LiveTranscription] Connected to gemini-2.5-flash-native-audio-preview-12-2025
📝 [LiveTranscription] Transcript: "привет"
✅ [STT] Live API completed in 2145ms, result: "привет"
🔊 [TTS] Generating speech (model: gemini-2.5-flash-preview-tts, voice: Kore)...
```

---

## 🚨 Emergency Rollback

If something is completely broken:

```bash
# Nuclear option: Reset to last known good commit
git fetch origin gemini
git reset --hard origin/gemini@{1day.ago}
git push origin gemini --force

# Or restore from GitHub directly:
git clone https://github.com/aiprod7/cnrpm.git voxlux-backup
cd voxlux-backup
git checkout backup-before-gemini-live
# Copy files to your working directory
```

---

## 📞 Support

**If rollback fails**:
1. Check git status: `git status`
2. View commit history: `git log --oneline -10`
3. Verify tag exists: `git tag -l backup-*`
4. Force clean: `git clean -fd`

**Backup locations**:
- Local backup: `services/geminiService.ts.backup`
- Git tag: `backup-before-gemini-live`
- GitHub: https://github.com/aiprod7/cnrpm/tree/backup-before-gemini-live

---

**Last Updated**: December 17, 2025  
**Backup Commit**: a4c816d  
**Safe Version**: v1.4.1 (stable, separate STT/TTS)
