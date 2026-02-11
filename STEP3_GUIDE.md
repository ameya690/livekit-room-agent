# Step 3: Forward Audio to OpenAI Realtime API

## Overview

In Step 3, we integrate OpenAI's Realtime API to:
- Receive audio from LiveKit
- Convert audio format (48kHz PCM → 24kHz PCM16 base64)
- Send audio to OpenAI via WebSocket
- Receive transcriptions and AI responses

## What We Built

### **Audio Format Conversion**

LiveKit provides audio at **48kHz PCM**, but OpenAI Realtime API expects **24kHz PCM16 base64**.

**`AudioConverter` class:**
- Downsamples from 48kHz to 24kHz (takes every other sample)
- Converts to base64 encoding
- Maintains Int16 format

```javascript
const base64Audio = AudioConverter.convertForOpenAI(frame);
// Input: 48kHz PCM frame from LiveKit
// Output: 24kHz PCM16 base64 string for OpenAI
```

---

### **OpenAI Realtime Session**

**`OpenAIRealtimeSession` class:**
- WebSocket connection to `wss://api.openai.com/v1/realtime`
- Session initialization with voice settings
- Audio streaming with `input_audio_buffer.append`
- Event handling for transcriptions and responses

**Key Features:**
- ✅ Server-side VAD (Voice Activity Detection)
- ✅ Automatic transcription (Whisper)
- ✅ Text and audio responses
- ✅ Streaming audio output

---

### **Integration Flow**

```
User speaks
    ↓
LiveKit (48kHz PCM)
    ↓
AudioConverter (downsample to 24kHz)
    ↓
Base64 encoding
    ↓
OpenAI Realtime API
    ↓
Transcription + AI Response
```

---

## Configuration

### **1. Get OpenAI API Key**

Visit: https://platform.openai.com/api-keys

Create a new API key with access to GPT-4 Realtime models.

### **2. Update `.env` File**

Edit `backend/.env`:

```env
OPENAI_API_KEY=sk-proj-your-actual-key-here
```

⚠️ **Important:** Replace `your_openai_api_key_here` with your actual API key!

---

## How It Works

### **Connection Sequence**

1. **AI agent starts** → Connects to OpenAI first
2. **OpenAI session created** → Receives session ID
3. **Session configured** → Sets voice, format, VAD settings
4. **Connects to LiveKit** → Joins room as participant
5. **Subscribes to user audio** → Starts receiving frames
6. **Forwards to OpenAI** → Streams audio continuously

---

### **Audio Streaming**

Every audio frame from LiveKit:
```javascript
// 1. Receive from LiveKit (48kHz)
for await (const frame of audioStream) {
  
  // 2. Convert format (24kHz base64)
  const base64Audio = AudioConverter.convertForOpenAI(frame);
  
  // 3. Send to OpenAI
  this.openai.sendAudio(base64Audio);
}
```

OpenAI automatically:
- Detects speech (VAD)
- Transcribes audio (Whisper)
- Generates response (GPT-4)
- Sends back audio + text

---

### **OpenAI Events**

**Session events:**
- `session.created` - Connection successful
- `session.updated` - Configuration applied

**Audio input events:**
- `input_audio_buffer.speech_started` - User started speaking
- `input_audio_buffer.speech_stopped` - User stopped speaking
- `input_audio_buffer.committed` - Audio buffer processed

**Transcription events:**
- `conversation.item.input_audio_transcription.completed` - User's speech transcribed

**Response events:**
- `response.audio_transcript.delta` - AI response text (streaming)
- `response.audio_transcript.done` - Full AI response text
- `response.audio.delta` - AI response audio (Step 4)
- `response.done` - Response complete

---

## Testing Step 3

### **Prerequisites**

1. All servers running (LiveKit, backend, frontend)
2. OpenAI API key configured in `.env`
3. User connected to room with microphone enabled

---

### **Test 3.1 - OpenAI Connection Test** ✅

**Goal:** Verify AI agent can connect to OpenAI Realtime API

**How to run:**
```bash
cd backend
npm run agent
```

**Expected output:**
```
[STEP 3] Connecting to OpenAI Realtime API...
[OPENAI] Connecting to Realtime API...
[OPENAI] URL: wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17
[OPENAI] ✅ WebSocket connected
[OPENAI] Initializing session...
[OPENAI] Session configuration sent
[OPENAI] ✅ TEST 3.1 PASS: Session created
[OPENAI] Session ID: sess_xxxxxxxxxxxxx
[OPENAI] Model: gpt-4o-realtime-preview-2024-12-17
[STEP 3] ✅ OpenAI connected
```

**Pass criteria:**
- ✅ WebSocket connects successfully
- ✅ Session created event received
- ✅ Session ID displayed
- ✅ No auth errors

**Fail criteria:**
- ❌ `401 Unauthorized` - Invalid API key
- ❌ Connection timeout
- ❌ WebSocket error

---

### **Test 3.2 - Audio Send Test** ✅

**Goal:** Verify audio chunks are sent to OpenAI

**How to test:**
1. AI agent connected (Test 3.1 passed)
2. User connected in browser
3. User speaks into microphone

**Expected output:**
```
[OPENAI] ✅ TEST 3.2: Sent audio chunk #1 (0.23 KB)
[OPENAI] ✅ TEST 3.2: Sent audio chunk #2 (0.23 KB)
[OPENAI] ✅ TEST 3.2: Sent audio chunk #3 (0.23 KB)
[OPENAI] 🎤 Speech detected (VAD)
```

**Pass criteria:**
- ✅ Audio chunks sent while user speaks
- ✅ Chunk sizes are non-zero (~0.2-0.3 KB each)
- ✅ VAD detects speech start
- ✅ Continuous streaming (not just one chunk)

**Fail criteria:**
- ❌ No chunks sent
- ❌ Zero-length buffers
- ❌ Chunks sent but no VAD detection

---

### **Test 3.3 - STT Sanity Test (Text Response)** ✅

**Goal:** Verify OpenAI transcribes user speech correctly

**How to test:**
1. Tests 3.1 and 3.2 passed
2. User speaks clearly: **"Hello, can you hear me?"**
3. Wait 1-2 seconds after speaking
4. Check AI agent logs

**Expected output:**
```
[OPENAI] 🎤 Speech detected (VAD)
[OPENAI] 🔇 Speech ended (VAD)
[OPENAI] Audio buffer committed
[OPENAI] 📝 Transcription: "Hello, can you hear me?"
[OPENAI] ✅ TEST 3.3 PASS: Received text transcription
[OPENAI] 🤖 AI Response: "Yes, I can hear you! How can I help you today?"
[OPENAI] Response completed
```

**Pass criteria:**
- ✅ Transcription matches what user said
- ✅ Text is accurate (not garbage)
- ✅ AI response is relevant
- ✅ Response arrives within 2-3 seconds

**Fail criteria:**
- ❌ Transcription is gibberish
- ❌ No transcription received
- ❌ Response delayed forever (>10 seconds)
- ❌ Empty or error responses

---

## Architecture Now

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │         │   LiveKit    │         │  AI Agent   │
│   (user-1)  │◄───────►│   Server     │◄───────►│ (backend)   │
└─────────────┘         └──────────────┘         └─────────────┘
      │                        │                        │
      │ Speak (48kHz)         │                        │
      │───────────────────────►│                        │
      │                        │ Stream audio           │
      │                        │───────────────────────►│
      │                        │                        │
      │                        │                        ↓
      │                        │                  Convert to 24kHz
      │                        │                        │
      │                        │                        ↓
      │                        │                 ┌──────────────┐
      │                        │                 │   OpenAI     │
      │                        │                 │  Realtime    │
      │                        │                 └──────────────┘
      │                        │                        │
      │                        │                 Transcribe + AI
      │                        │                        │
      │                        │                        ↓
      │                        │                 📝 "Hello..."
      │                        │                 🤖 "Yes, I can..."
```

---

## OpenAI Session Configuration

```javascript
{
  modalities: ['text', 'audio'],
  instructions: 'You are a helpful voice assistant. Keep responses concise and natural.',
  voice: 'alloy',
  input_audio_format: 'pcm16',
  output_audio_format: 'pcm16',
  input_audio_transcription: {
    model: 'whisper-1'
  },
  turn_detection: {
    type: 'server_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500
  }
}
```

**Key settings:**
- **Voice:** `alloy` (can change to: echo, fable, onyx, nova, shimmer)
- **VAD threshold:** 0.5 (sensitivity to speech detection)
- **Silence duration:** 500ms (how long to wait before ending turn)

---

## Troubleshooting

### **Error: 401 Unauthorized**
```
[OPENAI] ❌ WebSocket error: Unexpected server response: 401
```

**Fix:**
1. Check API key in `backend/.env`
2. Verify key starts with `sk-proj-` or `sk-`
3. Ensure key has Realtime API access
4. Check key hasn't expired

---

### **Error: Connection timeout**
```
[OPENAI] ❌ Connection failed: OpenAI connection timeout
```

**Fix:**
1. Check internet connection
2. Verify firewall allows WebSocket connections
3. Try different network (VPN might block)

---

### **No audio chunks sent**
```
[AI-AGENT] ✅ TEST 2.3 PASS: Receiving audio frames
(but no TEST 3.2 messages)
```

**Fix:**
1. Check OpenAI connection succeeded (Test 3.1)
2. Verify `this.openai.connected === true`
3. Look for audio conversion errors in logs

---

### **No transcription received**
```
[OPENAI] 🎤 Speech detected (VAD)
[OPENAI] 🔇 Speech ended (VAD)
(but no transcription)
```

**Fix:**
1. Speak louder and clearer
2. Speak for at least 1-2 seconds
3. Check `input_audio_transcription` is enabled
4. Wait longer (can take 2-3 seconds)

---

### **Garbage transcriptions**
```
[OPENAI] 📝 Transcription: "asdfjkl;qwer"
```

**Fix:**
1. Check audio format conversion is correct
2. Verify sample rate is 24kHz
3. Test with simple phrases first
4. Check microphone quality in browser

---

## What's NOT Implemented Yet

❌ **AI audio response playback** (Step 4)  
❌ **Publishing AI voice to LiveKit** (Step 4)  
❌ **User hearing AI speak** (Step 4)

Currently, the AI:
- ✅ Receives user audio
- ✅ Transcribes speech
- ✅ Generates text responses
- ❌ Does NOT play audio back yet

---

## Success Criteria

**Ready for Step 4 when:**
- ✅ Test 3.1 PASS - OpenAI connected
- ✅ Test 3.2 PASS - Audio chunks streaming
- ✅ Test 3.3 PASS - Accurate transcriptions
- ✅ AI responses are relevant and timely

**Do NOT proceed to Step 4 until all tests pass!**

---

## Commands Reference

```bash
# Start AI agent with OpenAI integration
cd backend
npm run agent

# Check logs for test results
# Look for: TEST 3.1, TEST 3.2, TEST 3.3

# Stop AI agent
Ctrl+C
```

---

## Next Step

**Step 4:** Receive AI audio responses from OpenAI and publish them back to LiveKit so the user can hear the AI speaking! 🎙️
