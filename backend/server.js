import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AccessToken } from 'livekit-server-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const PORT = process.env.PORT || 3000;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('ERROR: LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
  process.exit(1);
}

app.post('/api/token', async (req, res) => {
  try {
    const { identity, roomName } = req.body;

    if (!identity || !roomName) {
      return res.status(400).json({ 
        error: 'identity and roomName are required' 
      });
    }

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: identity,
      ttl: '1h',
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    console.log(`[TOKEN] Generated for user: ${identity}, room: ${roomName}`);

    res.json({
      token: jwt,
      url: LIVEKIT_URL,
      identity,
      roomName,
    });
  } catch (error) {
    console.error('[ERROR] Token generation failed:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', livekit_url: LIVEKIT_URL });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Backend running on http://localhost:${PORT}`);
  console.log(`[CONFIG] LiveKit URL: ${LIVEKIT_URL}`);
  console.log(`[READY] POST /api/token to get access tokens`);
});
