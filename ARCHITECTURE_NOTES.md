# LiveKit Room Agent - Architecture Notes

## 1. Current Runtime Flows

### Flow A: Frontend → Backend → LiveKit (User Audio)

```
┌─────────────┐      HTTP POST         ┌─────────────┐
│   Browser   │─────────────────────────▶│   Backend   │
│  (Vite App) │   /api/token           │  (Express)  │
│             │   {identity, room}      │  server.js  │
└─────────────┘                         └─────────────┘
       │                                       │
       │                                       │ Generates JWT
       │                                       │ using livekit-server-sdk
       │                                       ▼
       │                                 AccessToken
       │                                 (room grants)
       │                                       │
       │◀──────────────────────────────────────┘
       │         {token, url}
       │
       │         WebSocket
       │         (livekit-client)
       ▼
┌─────────────────────────────────────────────┐
│         LiveKit Server (Port 7880)          │
│  - WebRTC signaling                         │
│  - Audio/video routing                      │
│  - Room management                          │
└─────────────────────────────────────────────┘
       ▲
       │ Publishes audio track
       │ (microphone)
       │
┌─────────────┐
│   Browser   │
│   main.js   │
│             │
│ - Room.connect(url, token)                  │
│ - setMicrophoneEnabled(true)                │
│ - Publishes audio to room                   │
└─────────────┘
```

**Key Files:**
- `frontend/main.js:56-79` - Token request
- `frontend/main.js:81-129` - Room connection
- `frontend/main.js:224-254` - Microphone publishing
- `backend/server.js:22-59` - Token generation endpoint

### Flow B: Python AI Agent → LiveKit → OpenAI Realtime (Voice Processing)

```
┌─────────────────────────────────────────────┐
│         LiveKit Server (Port 7880)          │
│  - Routes audio between participants        │
└─────────────────────────────────────────────┘
       │                              ▲
       │ User audio track             │ AI audio track
       │ (48kHz PCM16)                │ (24kHz PCM16)
       ▼                              │
┌──────────────────────────────────────────────┐
│     Python AI Agent (ai_agent.py)            │
│                                              │
│  1. Connects as participant 'ai-agent'       │
│  2. Subscribes to user audio tracks          │
│  3. Resamples 48kHz → 24kHz                  │
│  4. Forwards to OpenAI                       │
│  5. Receives AI audio responses              │
│  6. Publishes back to LiveKit room           │
└──────────────────────────────────────────────┘
       │                              ▲
       │ Audio frames                 │ Audio deltas
       │ (base64 PCM16)               │ (base64 PCM16)
       ▼                              │
┌──────────────────────────────────────────────┐
│   OpenAI Realtime API (WebSocket)            │
│   wss://api.openai.com/v1/realtime           │
│                                              │
│  - Server VAD (voice activity detection)     │
│  - Whisper transcription                     │
│  - GPT-4o realtime model                     │
│  - Audio synthesis (voice: alloy)            │
└──────────────────────────────────────────────┘
```

**Key Files:**
- `backend/ai_agent.py:84-238` - OpenAI session management
- `backend/ai_agent.py:241-500` - AI agent LiveKit integration
- `backend/ai_agent.py:336-385` - Audio track handler (receives user audio)
- `backend/ai_agent.py:414-466` - Audio playback (publishes AI audio)

**Audio Pipeline:**
```
User Mic → Browser → LiveKit (48kHz) → AI Agent (resample to 24kHz) 
→ OpenAI Realtime API → AI Agent (24kHz) → LiveKit → Browser → Speaker
```

---

## 2. Extension Points for Text Chat Feature

### Frontend UI (Minimal Changes)

**Location:** `frontend/index.html:220-266`

**Add after line 251 (before test results):**
```html
<div id="chatContainer" class="chat-container" style="display: none;">
  <div id="chatMessages" class="chat-messages"></div>
  <div class="chat-input-group">
    <input type="text" id="chatInput" placeholder="Type a message...">
    <button id="sendChatBtn">Send</button>
  </div>
</div>
```

**CSS additions needed:**
```css
.chat-container {
  margin-top: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}
.chat-messages {
  height: 300px;
  overflow-y: auto;
  padding: 16px;
  background: #f8f9fa;
}
.chat-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  max-width: 80%;
}
.chat-message.user {
  background: #667eea;
  color: white;
  margin-left: auto;
}
.chat-message.ai {
  background: #e0e0e0;
  color: #333;
}
```

### Frontend JavaScript (main.js)

**Location:** `frontend/main.js:1-314`

**Add after line 222 (in setupRoomEventListeners):**
```javascript
// Handle data messages (text chat)
room.on(RoomEvent.DataReceived, (payload, participant, kind) => {
  if (kind === DataPacket_Kind.RELIABLE) {
    const decoder = new TextDecoder();
    const message = decoder.decode(payload);
    
    try {
      const data = JSON.parse(message);
      if (data.type === 'chat') {
        displayChatMessage(data.sender, data.message, data.sender === 'ai-agent');
      }
    } catch (e) {
      log(`Received data: ${message}`, 'info');
    }
  }
});
```

**Add new functions:**
```javascript
async function sendChatMessage(message) {
  if (!room || !message.trim()) return;
  
  const data = JSON.stringify({
    type: 'chat',
    sender: room.localParticipant.identity,
    message: message.trim(),
    timestamp: Date.now()
  });
  
  const encoder = new TextEncoder();
  await room.localParticipant.publishData(encoder.encode(data), DataPacket_Kind.RELIABLE);
  
  displayChatMessage(room.localParticipant.identity, message.trim(), false);
}

function displayChatMessage(sender, message, isAI) {
  const chatMessages = document.getElementById('chatMessages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${isAI ? 'ai' : 'user'}`;
  msgDiv.innerHTML = `<strong>${sender}:</strong> ${message}`;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
```

### Backend Endpoint (server.js)

**Location:** `backend/server.js:60-70`

**Add before line 61 (before /health endpoint):**
```javascript
app.post('/api/chat', async (req, res) => {
  try {
    const { message, roomName, userId } = req.body;
    
    if (!message || !roomName) {
      return res.status(400).json({ error: 'message and roomName required' });
    }
    
    // TODO: Add retrieval logic here
    // const context = await retrieveContext(message);
    
    // TODO: Forward to AI agent via data channel or separate service
    // For now, just acknowledge
    
    res.json({ 
      success: true,
      message: 'Chat message received',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[ERROR] Chat endpoint failed:', error);
    res.status(500).json({ error: 'Failed to process chat' });
  }
});
```

### Python AI Agent (ai_agent.py)

**Location:** `backend/ai_agent.py:297-335`

**Add in setup_event_handlers() after line 334:**
```python
@self.room.on('data_received')
def on_data_received(data_packet: rtc.DataPacket):
    try:
        message = data_packet.data.decode('utf-8')
        data = json.loads(message)
        
        if data.get('type') == 'chat':
            print(f'[AI-AGENT] 💬 Chat from {data["sender"]}: {data["message"]}')
            # TODO: Process with retrieval + OpenAI
            asyncio.create_task(self.handle_text_chat(data))
    except Exception as e:
        print(f'[AI-AGENT] Error handling data: {e}')
```

**Add new method to AIAgent class:**
```python
async def handle_text_chat(self, chat_data: dict):
    """Handle text chat messages with retrieval"""
    user_message = chat_data['message']
    
    # TODO: Add retrieval logic
    # context = await self.retrieve_context(user_message)
    
    # Send to OpenAI (text-only for chat)
    # Note: Current OpenAI session is audio-focused
    # Option 1: Use same session with conversation.item.create
    # Option 2: Create separate OpenAI client for text
    
    # For now, echo back (placeholder)
    response_data = json.dumps({
        'type': 'chat',
        'sender': 'ai-agent',
        'message': f'Received: {user_message}',
        'timestamp': int(asyncio.get_event_loop().time() * 1000)
    })
    
    await self.room.local_participant.publish_data(
        response_data.encode('utf-8'),
        reliable=True
    )
```

---

## 3. Retrieval Integration Points

### Option A: Centralized Retrieval Service (Recommended)

Create a new module: `backend/retrieval_service.py`

```python
"""
Retrieval service for both text chat and voice agent context
"""
import os
from typing import List, Dict

class RetrievalService:
    def __init__(self):
        # TODO: Initialize vector DB (e.g., Pinecone, Weaviate, ChromaDB)
        # TODO: Initialize embeddings model (e.g., OpenAI embeddings)
        pass
    
    async def retrieve_context(self, query: str, top_k: int = 3) -> List[Dict]:
        """
        Retrieve relevant context for a query
        Returns: [{'text': '...', 'score': 0.95, 'metadata': {...}}, ...]
        """
        # TODO: Embed query
        # TODO: Search vector DB
        # TODO: Return top_k results
        return []
    
    async def format_context_for_prompt(self, query: str, context: List[Dict]) -> str:
        """Format retrieved context for LLM prompt"""
        if not context:
            return query
        
        context_str = "\n\n".join([f"[Context {i+1}]: {c['text']}" for i, c in enumerate(context)])
        return f"Context:\n{context_str}\n\nUser Query: {query}"
```

### Integration Point 1: Text Chat with Retrieval

**In `ai_agent.py` - modify `handle_text_chat` method:**

```python
async def handle_text_chat(self, chat_data: dict):
    user_message = chat_data['message']
    
    # Retrieve context
    context = await self.retrieval.retrieve_context(user_message)
    augmented_prompt = await self.retrieval.format_context_for_prompt(user_message, context)
    
    # Send to OpenAI (use separate client for text-only)
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    
    response = await client.chat.completions.create(
        model='gpt-4o',
        messages=[
            {'role': 'system', 'content': 'You are a helpful assistant.'},
            {'role': 'user', 'content': augmented_prompt}
        ]
    )
    
    ai_response = response.choices[0].message.content
    
    # Publish back to room
    response_data = json.dumps({
        'type': 'chat',
        'sender': 'ai-agent',
        'message': ai_response,
        'timestamp': int(asyncio.get_event_loop().time() * 1000)
    })
    
    await self.room.local_participant.publish_data(
        response_data.encode('utf-8'),
        reliable=True
    )
```

### Integration Point 2: Voice Agent with Retrieval

**In `ai_agent.py` - modify `initialize_session` method:**

```python
async def initialize_session(self):
    """Configure OpenAI session with retrieval context"""
    print('[OPENAI] Initializing session...')
    
    # TODO: Retrieve general context for voice session
    # context = await self.ai_agent.retrieval.retrieve_context("general knowledge")
    # instructions = self.format_instructions_with_context(context)
    
    instructions = 'You are a helpful voice assistant. Keep responses concise and natural.'
    
    session_config = {
        'type': 'session.update',
        'session': {
            'modalities': ['text', 'audio'],
            'instructions': instructions,  # Inject retrieval context here
            'voice': 'alloy',
            'input_audio_format': 'pcm16',
            'output_audio_format': 'pcm16',
            'input_audio_transcription': {
                'model': 'whisper-1'
            },
            'turn_detection': {
                'type': 'server_vad',
                'threshold': 0.5,
                'prefix_padding_ms': 300,
                'silence_duration_ms': 500
            }
        }
    }
    
    await self.ws.send(json.dumps(session_config))
    print('[OPENAI] Session configuration sent')
```

**Dynamic context injection on transcription:**

Add in `handle_message` method after line 186:

```python
elif msg_type == 'conversation.item.input_audio_transcription.completed':
    transcript = message_data.get('transcript', '')
    print(f'[OPENAI] 📝 Transcription: "{transcript}"')
    
    # Retrieve context based on what user said
    if self.ai_agent.retrieval:
        context = await self.ai_agent.retrieval.retrieve_context(transcript)
        if context:
            # Inject context as a system message
            context_msg = {
                'type': 'conversation.item.create',
                'item': {
                    'type': 'message',
                    'role': 'system',
                    'content': [{
                        'type': 'input_text',
                        'text': f'Relevant context: {context[0]["text"]}'
                    }]
                }
            }
            await self.ws.send(json.dumps(context_msg))
```

### Option B: REST API Retrieval Endpoint

**Add to `server.js`:**

```javascript
app.post('/api/retrieve', async (req, res) => {
  try {
    const { query, top_k = 3 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'query required' });
    }
    
    // TODO: Call vector DB or retrieval service
    // const results = await vectorDB.search(query, top_k);
    
    res.json({
      query,
      results: [],  // Placeholder
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[ERROR] Retrieval failed:', error);
    res.status(500).json({ error: 'Retrieval failed' });
  }
});
```

---

## 4. Environment Variables & Secrets

### Current Environment Variables

**Backend (.env file location: `backend/.env`)**

Required variables loaded via `dotenv` in:
- `backend/server.js:6` (Express server)
- `backend/ai_agent.py:23` (Python agent)

**Variables:**

| Variable | Used By | Purpose | Example |
|----------|---------|---------|---------|
| `LIVEKIT_URL` | server.js, ai_agent.py | LiveKit server WebSocket URL | `ws://localhost:7880` |
| `LIVEKIT_API_KEY` | server.js, ai_agent.py | LiveKit API key for token generation | `devkey` |
| `LIVEKIT_API_SECRET` | server.js, ai_agent.py | LiveKit API secret for token signing | `secret` |
| `OPENAI_API_KEY` | ai_agent.py, mvp_audio.py | OpenAI API authentication | `sk-...` |
| `PORT` | server.js | Express server port | `3000` |
| `TARGET_ROOM` | ai_agent.py | Default room for AI agent | `demo-room` |

**Validation:**
- `backend/server.js:17-20` - Validates LiveKit credentials on startup
- `backend/ai_agent.py:35-39` - Validates all required keys

### Secrets Loading Pattern

**Node.js (server.js):**
```javascript
import dotenv from 'dotenv';
dotenv.config();  // Loads from .env in same directory
const VAR = process.env.VAR_NAME || 'default';
```

**Python (ai_agent.py):**
```python
from dotenv import load_dotenv
load_dotenv()  # Loads from .env in current directory
VAR = os.getenv('VAR_NAME', 'default')
```

### Recommended Additions for New Features

**For retrieval service:**
```bash
# Vector DB
PINECONE_API_KEY=your_key
PINECONE_ENVIRONMENT=us-east-1
PINECONE_INDEX_NAME=livekit-docs

# Or ChromaDB (local)
CHROMA_PERSIST_DIRECTORY=./chroma_db

# Embeddings
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

**For text chat logging:**
```bash
# Optional
CHAT_LOG_ENABLED=true
CHAT_LOG_PATH=./logs/chat.log
```

---

## 5. Recommended Minimal Changes

### Priority 1: Text Chat (No Retrieval Yet)

**Effort:** Low | **Impact:** High

1. **Frontend UI** - Add chat container to `index.html` (~20 lines)
2. **Frontend Logic** - Add data channel handlers in `main.js` (~50 lines)
3. **AI Agent** - Add data_received handler in `ai_agent.py` (~30 lines)
4. **AI Agent** - Add text chat method using OpenAI Chat API (~40 lines)

**Files to modify:**
- `frontend/index.html` - Add chat UI
- `frontend/main.js` - Add DataReceived event handler + send/display functions
- `backend/ai_agent.py` - Add data_received handler + handle_text_chat method
- `backend/requirements.txt` - Ensure `openai` package supports async client

**No breaking changes:** Voice flow remains unchanged.

### Priority 2: Retrieval Service Foundation

**Effort:** Medium | **Impact:** High (enables both features)

1. **Create** `backend/retrieval_service.py` (~150 lines)
2. **Add** ChromaDB or Pinecone dependency
3. **Initialize** in `ai_agent.py` constructor
4. **Add** REST endpoint in `server.js` for frontend queries

**New files:**
- `backend/retrieval_service.py`
- `backend/data/` - Sample documents for indexing

**Dependencies to add:**
```txt
# requirements.txt
chromadb==0.4.22
sentence-transformers==2.3.1
# OR
pinecone-client==3.0.0
```

### Priority 3: Integrate Retrieval into Voice Agent

**Effort:** Low (once P2 done) | **Impact:** Medium

1. **Modify** `OpenAIRealtimeSession.handle_message` to inject context on transcription
2. **Update** session instructions dynamically based on retrieved docs

**Files to modify:**
- `backend/ai_agent.py` - Lines 182-186 (transcription handler)

### Priority 4: Integrate Retrieval into Text Chat

**Effort:** Low (once P2 done) | **Impact:** Medium

1. **Call** retrieval service in `handle_text_chat`
2. **Augment** prompt with context before OpenAI call

**Files to modify:**
- `backend/ai_agent.py` - New `handle_text_chat` method

---

## Extension Points Summary

### 🎯 Quick Reference Table

| Feature | Frontend | Backend (Express) | Backend (Python) | Complexity |
|---------|----------|-------------------|------------------|------------|
| **Text Chat UI** | `index.html` + `main.js` DataReceived handler | Optional `/api/chat` endpoint | `ai_agent.py` data_received handler | Low |
| **Text Chat AI** | (none) | (none) | `handle_text_chat()` method | Low |
| **Retrieval Service** | (none) | Optional `/api/retrieve` | `retrieval_service.py` module | Medium |
| **Voice + Retrieval** | (none) | (none) | Inject in transcription handler | Low |
| **Chat + Retrieval** | (none) | (none) | Call in `handle_text_chat()` | Low |

### 🔌 Key Integration Points

1. **LiveKit Data Channel** (already available via grants)
   - Frontend: `room.localParticipant.publishData()`
   - Python: `room.local_participant.publish_data()`
   - Event: `RoomEvent.DataReceived` / `'data_received'`

2. **OpenAI Realtime API** (already connected)
   - Session instructions can be updated dynamically
   - Can inject system messages mid-conversation
   - Location: `backend/ai_agent.py:113-138`

3. **OpenAI Chat API** (not yet used)
   - Use for text-only chat responses
   - Supports function calling for retrieval
   - Add: `from openai import AsyncOpenAI`

4. **Token Grants** (already includes data publishing)
   - `backend/server.js:37-43`
   - `canPublishData: true` already set ✅

---

## Architecture Patterns

### Current Patterns

1. **Token-based Auth**: Backend generates JWT, frontend uses for connection
2. **Event-driven**: Both frontend and Python use event listeners
3. **Async/Await**: Python uses asyncio, frontend uses promises
4. **Streaming Audio**: Real-time audio frames via LiveKit tracks
5. **WebSocket**: OpenAI Realtime API uses persistent WebSocket

### Recommended Patterns for Extensions

1. **Data Channel for Chat**: Use LiveKit's data channel (already granted)
2. **Shared Retrieval**: Single service used by both text and voice
3. **Lazy Loading**: Initialize retrieval only when first needed
4. **Context Injection**: Augment prompts rather than fine-tuning
5. **Graceful Degradation**: Chat works even if retrieval fails

---

## Dependencies Overview

### Frontend
- `livekit-client@^2.0.0` - WebRTC client
- `vite@^5.0.0` - Dev server

### Backend (Node.js)
- `express@^4.18.2` - HTTP server
- `livekit-server-sdk@^2.0.0` - Token generation
- `cors@^2.8.5` - CORS middleware
- `dotenv@^16.3.1` - Environment variables

### Backend (Python)
- `livekit==0.17.5` - LiveKit Python SDK
- `openai==1.54.0` - OpenAI API client
- `websockets==13.1` - WebSocket client for Realtime API
- `numpy==1.26.4` - Audio processing
- `python-dotenv==1.0.1` - Environment variables

### Recommended Additions
- **Retrieval**: `chromadb` or `pinecone-client` + `sentence-transformers`
- **Async OpenAI**: Already included in `openai>=1.0.0`

---

## File Structure

```
livekit-room-agent-new/
├── backend/
│   ├── server.js              # Express token server (70 lines)
│   ├── ai_agent.py            # Python AI agent (527 lines)
│   ├── package.json           # Node dependencies
│   ├── requirements.txt       # Python dependencies
│   └── .env                   # Secrets (gitignored)
│
├── frontend/
│   ├── index.html             # UI (266 lines)
│   ├── main.js                # LiveKit client logic (314 lines)
│   ├── package.json           # Frontend dependencies
│   └── vite.config.js         # Vite config
│
├── livekit-config.yaml        # LiveKit server config
├── download-livekit.ps1       # Server download script
├── mvp_audio.py               # Standalone OpenAI test script
└── README.md                  # Setup instructions
```

---

## TODO List (Ordered by Impact/Effort)

### 🚀 High Impact / Low Effort

1. **Add Text Chat UI** (1-2 hours)
   - Modify `frontend/index.html` - Add chat container
   - Modify `frontend/main.js` - Add DataReceived handler + send/display functions
   - Test with manual data messages

2. **Add AI Text Chat Handler** (2-3 hours)
   - Modify `backend/ai_agent.py` - Add data_received event handler
   - Add `handle_text_chat()` method with OpenAI Chat API
   - Test bidirectional text chat

### 🎯 High Impact / Medium Effort

3. **Create Retrieval Service** (4-6 hours)
   - Create `backend/retrieval_service.py`
   - Choose vector DB (ChromaDB for local, Pinecone for cloud)
   - Implement embed + search methods
   - Add sample documents for testing

4. **Integrate Retrieval into Text Chat** (1-2 hours)
   - Modify `handle_text_chat()` to call retrieval
   - Format context into prompt
   - Test with sample queries

### 🔧 Medium Impact / Low Effort

5. **Integrate Retrieval into Voice Agent** (2-3 hours)
   - Modify transcription handler to retrieve context
   - Inject context as system message or update instructions
   - Test voice queries with context

6. **Add Chat History Persistence** (2-3 hours)
   - Store chat messages in memory or DB
   - Add `/api/chat/history` endpoint
   - Display history on frontend load

### 🛠️ Low Priority / Nice to Have

7. **Add Typing Indicators** (1 hour)
   - Send data message when user is typing
   - Show "AI is thinking..." indicator

8. **Add Chat Export** (1 hour)
   - Download chat history as JSON/CSV
   - Add export button to UI

9. **Add Voice Transcription Display** (2 hours)
   - Show real-time transcription in UI
   - Requires forwarding transcripts from Python to frontend

10. **Add Multi-room Support** (3-4 hours)
    - Allow AI agent to join multiple rooms
    - Room-specific retrieval contexts
    - Requires refactoring agent to manage multiple room instances

---

## Critical Notes

### ⚠️ Current Limitations

1. **No persistence**: Chat messages not stored
2. **Single room**: AI agent joins one room only
3. **No retrieval**: Responses based on model knowledge only
4. **No authentication**: Anyone can generate tokens
5. **No rate limiting**: Backend endpoints unprotected

### 🔒 Security Considerations

1. **Token TTL**: Currently 1 hour (`backend/server.js:34`)
2. **API Keys**: Stored in `.env`, not in code ✅
3. **CORS**: Currently wide open (`app.use(cors())`) - should restrict origins
4. **Data Channel**: Reliable transport, but no encryption beyond WebRTC

### 🎨 Code Style Notes

- Frontend: Modern ES6+, async/await
- Backend (Node): ES modules, async/await
- Backend (Python): Type hints, async/await, snake_case
- Logging: Extensive console logging with emojis for debugging

---

## Quick Start Commands

```bash
# Terminal 1: Start LiveKit server
cd livekit-server
.\livekit-server.exe --dev --config ../livekit-config.yaml

# Terminal 2: Start backend
cd backend
npm start

# Terminal 3: Start AI agent
cd backend
python ai_agent.py

# Terminal 4: Start frontend
cd frontend
npm run dev
```

**Environment setup:**
```bash
# backend/.env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
OPENAI_API_KEY=sk-your-key-here
TARGET_ROOM=demo-room
```

---

## Extension Checklist

When adding new features, ensure:

- [ ] Environment variables added to `.env` and validated on startup
- [ ] Error handling with descriptive logs
- [ ] Event handlers registered before connection
- [ ] Async operations use proper await/asyncio patterns
- [ ] Frontend UI updates reflect connection state
- [ ] Data channel messages use JSON format
- [ ] Audio remains at 24kHz for OpenAI compatibility
- [ ] No blocking operations in event handlers

---

## References

- LiveKit Docs: https://docs.livekit.io/
- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime
- LiveKit Python SDK: https://github.com/livekit/python-sdks
- LiveKit JS SDK: https://github.com/livekit/client-sdk-js
