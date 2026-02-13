# Python AI Agent Setup Guide

This guide explains how to set up and run the Python-based AI agent.

## Architecture

The project now uses a **hybrid architecture**:

- **Frontend** (JavaScript) - Browser client for user interaction
- **Backend** (JavaScript) - Express server for token generation
- **AI Agent** (Python) - Voice AI processing with LiveKit + OpenAI

## Prerequisites

- Python 3.9 or higher
- pip (Python package manager)
- All previous requirements (Node.js, LiveKit server, etc.)

## Setup Steps

### 1. Create Python Virtual Environment

```bash
cd backend
python -m venv venv
```

### 2. Activate Virtual Environment

**Windows:**
```bash
venv\Scripts\activate
```

**macOS/Linux:**
```bash
source venv/bin/activate
```

### 3. Install Python Dependencies

```bash
pip install -r requirements.txt
```

This will install:
- `livekit` - LiveKit Python SDK
- `openai` - OpenAI Python SDK
- `websockets` - WebSocket client
- `python-dotenv` - Environment variables
- `numpy` - Audio processing
- `aiohttp` - Async HTTP support

### 4. Verify Installation

```bash
python -c "import livekit; import openai; import websockets; print('All packages installed successfully!')"
```

## Running the System

### Start All Services

You need **4 terminals**:

**Terminal 1: LiveKit Server**
```bash
.\livekit-server\livekit-server.exe --dev
```

**Terminal 2: Backend Token Server**
```bash
cd backend
npm start
```

**Terminal 3: Python AI Agent**
```bash
cd backend
venv\Scripts\activate  # Windows
python ai_agent.py
# OR use npm script:
npm run agent
```

**Terminal 4: Frontend**
```bash
cd frontend
npm run dev
```

## Testing

1. Open browser: `http://localhost:5173`
2. Enter username and join room
3. Enable microphone
4. Speak to the AI
5. Listen for AI response

## Python vs JavaScript Agent

### What Changed

- **Removed:** `backend/ai_agent.js` (Node.js version)
- **Added:** `backend/ai_agent.py` (Python version)
- **Added:** `backend/requirements.txt` (Python dependencies)

### What Stayed the Same

- Frontend client (JavaScript)
- Backend token server (JavaScript)
- LiveKit server (native binary)
- OpenAI Realtime API integration
- Overall architecture and flow

### Advantages of Python

1. **Better audio processing** - NumPy for efficient array operations
2. **Cleaner resampling** - More straightforward audio conversion
3. **Async/await** - Python's asyncio for concurrent operations
4. **Type hints** - Better code documentation
5. **Easier debugging** - Python's audio tools ecosystem

## Troubleshooting

### "Module not found" error
```bash
# Make sure virtual environment is activated
venv\Scripts\activate  # Windows
source venv/bin/activate  # macOS/Linux

# Reinstall dependencies
pip install -r requirements.txt
```

### "Permission denied" on venv activation
```bash
# Windows PowerShell - enable script execution
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Audio not working
- Check that all 4 services are running
- Verify `.env` file has correct API keys
- Check browser console for errors
- Verify microphone permissions in browser

## Development

### Running JavaScript Agent (for comparison)
```bash
npm run agent:js
```

### Both agents available
- Python agent: `npm run agent` or `python ai_agent.py`
- JavaScript agent: `npm run agent:js`

## Dependencies

### Python Packages
```
livekit==0.17.5          # LiveKit real-time SDK
openai==1.54.0           # OpenAI API client
websockets==13.1         # WebSocket support
python-dotenv==1.0.1     # Environment variables
numpy==1.26.4            # Audio processing
aiohttp==3.10.10         # Async HTTP
```

### Node Packages (unchanged)
```
express                  # Backend server
livekit-server-sdk       # Token generation
```

## Next Steps

- Test voice conversations
- Monitor logs for any errors
- Compare performance with JavaScript version
- Optimize audio queue processing if needed
