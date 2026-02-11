# Step 2: AI Agent Joins LiveKit Room

## Overview

In Step 2, we create an AI agent that:
- Joins the same LiveKit room as the user
- Acts as a headless participant (no browser needed)
- Automatically subscribes to user audio
- Receives raw audio frames for processing

## What We Built

### `backend/ai_agent.js`

A Node.js script that creates a LiveKit participant with these capabilities:

**Key Features:**
- ✅ Generates its own access token (identity: `ai-agent`)
- ✅ Connects to LiveKit room as a participant
- ✅ Auto-subscribes to all audio tracks (`autoSubscribe: true`)
- ✅ Logs all room events (connections, tracks, speakers)
- ✅ Monitors audio frame reception
- ✅ Provides detailed status logging

**Event Listeners:**
- `RoomEvent.Connected` - AI successfully joined
- `RoomEvent.ParticipantConnected` - User joins room
- `RoomEvent.TrackSubscribed` - AI subscribed to user's audio
- `RoomEvent.ActiveSpeakersChanged` - Detects when user speaks

## How to Run

### 1. Install Dependencies

```bash
cd backend
npm install
```

This installs `livekit-client` package needed for the AI agent.

### 2. Configure Room Name (Optional)

Edit `backend/.env`:
```env
TARGET_ROOM=demo-room
```

The AI agent will join this room automatically.

### 3. Start the AI Agent

```bash
cd backend
npm run agent
```

You should see:
```
[AI-AGENT] Starting AI agent...
[AI-AGENT] Identity: ai-agent
[AI-AGENT] Target room: demo-room
[AI-AGENT] Connecting to LiveKit...
[AI-AGENT] ✅ Successfully connected to room!
```

### 4. Keep Other Servers Running

Make sure these are still running:
- LiveKit server (port 7880)
- Backend server (port 3000)
- Frontend dev server (port 5173)

## Testing Step 2

### Test 2.1 - AI Participant Presence ✅

**Goal:** Verify AI agent appears in the room

**Steps:**
1. Start AI agent: `npm run agent`
2. In browser, connect to same room (`demo-room`)
3. Check AI agent logs

**Pass Criteria:**
```
[AI-AGENT] ✅ Successfully connected to room!
[AI-AGENT] Room name: demo-room
[AI-AGENT] Local participant: ai-agent
```

**In browser:**
- You should see 2 participants in the room (you + ai-agent)

**Fail Criteria:**
- ❌ AI agent disconnects immediately
- ❌ Connection timeout
- ❌ Token generation fails

---

### Test 2.2 - AI Auto-Subscribe Test ✅

**Goal:** Verify AI agent subscribes to user's audio track

**Steps:**
1. AI agent is running
2. User connects to room in browser
3. User enables microphone
4. Watch AI agent logs

**Pass Criteria:**
```
[AI-AGENT] 👤 Participant joined: user-1
[AI-AGENT] 🎧 TrackSubscribed Event:
[AI-AGENT]    - Participant: user-1
[AI-AGENT]    - Track kind: audio
[AI-AGENT] ✅ TEST 2.2 PASS: Subscribed to audio from user-1
```

**Fail Criteria:**
- ❌ No `TrackSubscribed` event
- ❌ Subscribed only to itself
- ❌ Track subscription fails

---

### Test 2.3 - Raw Audio Reception Test ✅

**Goal:** Verify AI agent receives audio frames from user

**Steps:**
1. AI agent subscribed to user (Test 2.2 passed)
2. User speaks into microphone
3. Watch AI agent logs (every 5 seconds)

**Pass Criteria:**
```
[AI-AGENT] 🗣️ Active speakers: user-1
[AI-AGENT] 📊 Audio stats for user-1:
[AI-AGENT]    - Total frames: 1234
[AI-AGENT]    - Track muted: false
[AI-AGENT] ✅ TEST 2.3 PASS: Receiving audio frames
```

**Fail Criteria:**
- ❌ No audio frames received
- ❌ Frame count stays at 0
- ❌ Track shows as muted

---

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │         │   LiveKit    │         │  AI Agent   │
│   (User)    │◄───────►│   Server     │◄───────►│  (Backend)  │
└─────────────┘         └──────────────┘         └─────────────┘
      │                        │                        │
      │ 1. Join room          │                        │
      │──────────────────────►│                        │
      │                        │                        │
      │                        │ 2. AI joins room      │
      │                        │◄───────────────────────│
      │                        │                        │
      │ 3. Publish audio      │                        │
      │──────────────────────►│                        │
      │                        │                        │
      │                        │ 4. Subscribe to audio │
      │                        │───────────────────────►│
      │                        │                        │
      │                        │ 5. Stream audio frames│
      │                        │───────────────────────►│
      │                        │                        │
```

## Key Differences from Step 1

| Aspect | Step 1 | Step 2 |
|--------|--------|--------|
| **Participants** | User only | User + AI agent |
| **Audio flow** | User → LiveKit | User → LiveKit → AI |
| **Purpose** | Test connectivity | Prepare for OpenAI |
| **Backend role** | Token generation | Token + AI participant |

## What's Next (Step 3)

Once all Step 2 tests pass:
- AI agent will forward audio to OpenAI Realtime API
- OpenAI will respond with AI-generated audio
- AI agent will publish response back to LiveKit
- User will hear AI speaking in real-time

## Troubleshooting

### AI agent won't connect
```bash
# Check LiveKit server is running
netstat -an | Select-String "7880"

# Check .env file has correct credentials
cat backend/.env
```

### AI agent connects but doesn't see user
- Make sure user and AI are in the **same room name**
- Check `TARGET_ROOM` in `.env` matches browser room name

### No TrackSubscribed events
- Verify `autoSubscribe: true` in ai_agent.js
- Check user has enabled microphone in browser
- Look for errors in AI agent logs

### Audio frames not received
- User must be **speaking** (not just connected)
- Check browser microphone permissions
- Verify audio track is not muted

## Status Logging

The AI agent logs status every 10 seconds:

```
[AI-AGENT] ===== STATUS =====
[AI-AGENT] Connected: true
[AI-AGENT] Room: demo-room
[AI-AGENT] Local participant: ai-agent
[AI-AGENT] Remote participants: 1
[AI-AGENT]   - user-1:
[AI-AGENT]     Audio tracks: 1
[AI-AGENT] Subscribed tracks: 1
[AI-AGENT]   - user-1: 245 frames
[AI-AGENT] ==================
```

This helps verify everything is working correctly.

## Commands Reference

```bash
# Start AI agent
npm run agent

# Start AI agent with auto-reload (development)
npm run agent:watch

# Stop AI agent
Ctrl+C
```

## Success Criteria

✅ **Ready for Step 3 when:**
- AI agent connects to room
- AI agent sees user participant
- AI agent subscribes to user audio
- AI agent receives audio frames when user speaks
- All three tests (2.1, 2.2, 2.3) pass

**Do not proceed to Step 3 until all tests pass!**
