# LiveKit + OpenAI Realtime Audio Integration

This project implements a complete LiveKit + OpenAI integration with three components:
1. **Browser Client** - User mic → LiveKit
2. **Backend Server** - Token generation and AI agent
3. **LiveKit Server** - Realtime transport

## Prerequisites

- Node.js 18+ installed
- LiveKit server running (local or cloud)
- OpenAI API key

## Setup Instructions

### 1. Install LiveKit Server (Local Development)

Download and run LiveKit server locally:

```bash
# Download LiveKit server
# Visit: https://github.com/livekit/livekit/releases
# Or use Docker:
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev
```

The `--dev` flag generates default API keys for development.

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your LiveKit credentials
# For local dev server with --dev flag:
# LIVEKIT_URL=ws://localhost:7880
# LIVEKIT_API_KEY=devkey
# LIVEKIT_API_SECRET=secret

# Start backend server
npm start
```

Backend will run on `http://localhost:3000`

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend will run on `http://localhost:5173`

## Testing Step 1: User Joins LiveKit Room

### Test 1.1 - Room Connection Test

**What to do:**
1. Open browser to `http://localhost:5173`
2. Enter your identity (e.g., "user-1")
3. Enter room name (e.g., "demo-room")
4. Click "Connect to Room"

**Pass criteria:**
- ✅ Status shows "Connected to demo-room"
- ✅ Console logs show "connected to room"
- ✅ No reconnect loops or auth errors
- ✅ Test 1.1 shows green checkmark

**Fail criteria:**
- ❌ Token rejected
- ❌ Room never connects
- ❌ Silent disconnects

### Test 1.2 - Mic Publish Test

**What to do:**
1. After connecting, click "Enable Microphone"
2. Allow browser microphone permissions

**Pass criteria:**
- ✅ Microphone indicator appears
- ✅ Console shows "Local track published: audio"
- ✅ Test 1.2 shows green checkmark
- ✅ Audio track enabled = true

**Fail criteria:**
- ❌ No track published
- ❌ Track muted unexpectedly
- ❌ Permission denied

### Test 1.3 - Audio Activity Test

**What to do:**
1. Speak into your microphone for 5-10 seconds
2. Watch the audio level bar and console logs

**Pass criteria:**
- ✅ Audio level bar moves while speaking
- ✅ Console shows "Active speakers: user-1"
- ✅ Test 1.3 shows green checkmark
- ✅ "Speaking detected!" message appears

**Fail criteria:**
- ❌ Audio track exists but is silent
- ❌ No active speaker events
- ❌ Audio level stays at 0%

## Project Structure

```
livekit_tryouts/
├── backend/
│   ├── server.js          # Express server with token generation
│   ├── package.json
│   └── .env              # LiveKit credentials
├── frontend/
│   ├── index.html        # UI with test indicators
│   ├── main.js           # LiveKit client logic
│   ├── package.json
│   └── vite.config.js
├── mvp_audio.py          # Original OpenAI audio testing script
└── README.md
```

## API Endpoints

### POST /api/token
Generate LiveKit access token

**Request:**
```json
{
  "identity": "user-1",
  "roomName": "demo-room"
}
```

**Response:**
```json
{
  "token": "eyJhbGc...",
  "url": "ws://localhost:7880",
  "identity": "user-1",
  "roomName": "demo-room"
}
```

### GET /health
Health check endpoint

## Troubleshooting

### Backend won't start
- Check that LiveKit server is running
- Verify LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env
- Check port 3000 is not in use

### Frontend can't connect
- Verify backend is running on port 3000
- Check browser console for CORS errors
- Ensure LiveKit URL is correct (ws:// not wss:// for local)

### Microphone not working
- Check browser permissions (chrome://settings/content/microphone)
- Try HTTPS (required for some browsers)
- Check console for getUserMedia errors

### No audio activity detected
- Speak louder or closer to microphone
- Check system microphone settings
- Verify audio track is not muted in browser

## Next Steps

After all Step 1 tests pass:
- **Step 2**: Backend AI agent connects to LiveKit
- **Step 3**: AI agent integrates with OpenAI Realtime API
- **Step 4**: Full bidirectional audio conversation

## License

MIT
