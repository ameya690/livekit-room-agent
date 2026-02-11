# Quick Setup Guide

## Step 1: Start LiveKit Server

You need a LiveKit server running. Choose one option:

### Option A: Docker (Easiest)
```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev
```

### Option B: Download Binary
1. Download from: https://github.com/livekit/livekit/releases
2. Run: `livekit-server --dev`

The `--dev` flag automatically sets:
- API Key: `devkey`
- API Secret: `secret`

## Step 2: Start Backend Server

Open a new terminal:
```bash
cd backend
npm start
```

You should see:
```
[SERVER] Backend running on http://localhost:3000
[CONFIG] LiveKit URL: ws://localhost:7880
[READY] POST /api/token to get access tokens
```

## Step 3: Start Frontend Dev Server

Open another terminal:
```bash
cd frontend
npm run dev
```

Browser should auto-open to `http://localhost:5173`

## Step 4: Run Tests

In the browser:

### Test 1.1 - Room Connection
1. Enter identity: `user-1`
2. Enter room: `demo-room`
3. Click "Connect to Room"
4. ✅ Should see green "Connected" status

### Test 1.2 - Mic Publish
1. Click "Enable Microphone"
2. Allow browser permissions
3. ✅ Should see microphone indicator appear

### Test 1.3 - Audio Activity
1. Speak into your microphone
2. ✅ Should see audio level bar moving
3. ✅ Should see "Speaking detected!" message

## Troubleshooting

### "Failed to connect"
- Make sure LiveKit server is running on port 7880
- Check backend logs for errors
- Verify .env file has correct credentials

### "Token generation failed"
- Check backend .env file exists
- Verify LIVEKIT_API_KEY and LIVEKIT_API_SECRET match server

### "Microphone not working"
- Check browser permissions
- Try speaking louder
- Check system microphone settings

## Next Steps

Once all tests pass, you're ready for Step 2: Backend AI agent integration!
