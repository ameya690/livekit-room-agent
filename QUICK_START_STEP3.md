# Quick Start - Step 3 Testing

## 🚀 Setup (One-Time)

### 1. Add Your OpenAI API Key

Edit `backend/.env`:
```bash
OPENAI_API_KEY=sk-proj-your-actual-key-here
```

Get your key from: https://platform.openai.com/api-keys

---

## ▶️ Run All Servers

Open **4 separate terminals**:

### Terminal 1 - LiveKit Server
```powershell
cd d:\projects\livekit_tryouts
.\livekit-server.exe --dev
```

### Terminal 2 - Backend Server
```powershell
cd d:\projects\livekit_tryouts\backend
npm start
```

### Terminal 3 - Frontend Dev Server
```powershell
cd d:\projects\livekit_tryouts\frontend
npm run dev
```

### Terminal 4 - AI Agent (NEW!)
```powershell
cd d:\projects\livekit_tryouts\backend
npm run agent
```

---

## ✅ Expected Output (Terminal 4)

```
[AI-AGENT] Starting AI agent...
[STEP 3] Connecting to OpenAI Realtime API...
[OPENAI] Connecting to Realtime API...
[OPENAI] ✅ WebSocket connected
[OPENAI] ✅ TEST 3.1 PASS: Session created
[OPENAI] Session ID: sess_xxxxx
[STEP 3] ✅ OpenAI connected

[AI-AGENT] ✅ Successfully connected to room!
[AI-AGENT] Remote participants: 1
```

✅ **Test 3.1 PASS** - OpenAI connected!

---

## 🎤 Test Audio Streaming

### 1. Open Browser
Navigate to: http://localhost:5173

### 2. Connect
- Identity: `user-1`
- Room: `demo-room`
- Click "Connect to Room"
- Click "Enable Microphone"

### 3. Speak
Say clearly: **"Hello, can you hear me?"**

### 4. Watch Terminal 4 Logs

**Expected:**
```
[OPENAI] ✅ TEST 3.2: Sent audio chunk #1 (0.23 KB)
[OPENAI] ✅ TEST 3.2: Sent audio chunk #2 (0.23 KB)
[OPENAI] ✅ TEST 3.2: Sent audio chunk #3 (0.23 KB)
[OPENAI] 🎤 Speech detected (VAD)
[OPENAI] 🔇 Speech ended (VAD)
[OPENAI] 📝 Transcription: "Hello, can you hear me?"
[OPENAI] ✅ TEST 3.3 PASS: Received text transcription
[OPENAI] 🤖 AI Response: "Yes, I can hear you! How can I help you today?"
```

✅ **Test 3.2 PASS** - Audio chunks sent!  
✅ **Test 3.3 PASS** - Transcription received!

---

## 🎯 Success Checklist

- [ ] Terminal 4 shows "TEST 3.1 PASS"
- [ ] Terminal 4 shows "TEST 3.2" when you speak
- [ ] Terminal 4 shows "TEST 3.3 PASS" with correct transcription
- [ ] AI response text appears in logs
- [ ] Transcription matches what you said

---

## ⚠️ Troubleshooting

### "Missing or invalid OPENAI_API_KEY"
→ Edit `backend/.env` and add your API key

### "401 Unauthorized"
→ Check your API key is valid and has Realtime API access

### No audio chunks sent
→ Make sure user is speaking in browser with mic enabled

### No transcription
→ Speak louder and for at least 2 seconds

---

## 📊 What's Working Now

✅ User speaks → LiveKit receives  
✅ LiveKit → AI agent receives  
✅ AI agent → Converts audio format  
✅ AI agent → Sends to OpenAI  
✅ OpenAI → Transcribes speech  
✅ OpenAI → Generates text response  

❌ **NOT YET:** AI voice playback (Step 4)

---

## 🎉 Ready for Step 4?

If all three tests pass, you're ready to add AI voice responses!

**Step 4 will:**
- Receive AI audio from OpenAI
- Publish AI voice to LiveKit
- Let user hear AI speaking in browser
