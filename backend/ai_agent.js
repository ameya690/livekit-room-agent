import { AccessToken } from 'livekit-server-sdk';
import { Room, RoomEvent, TrackKind, AudioStream, AudioSource, LocalAudioTrack, AudioFrame } from '@livekit/rtc-node';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import fs from 'fs';

dotenv.config();

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_IDENTITY = 'ai-agent';
const TARGET_ROOM = process.env.TARGET_ROOM || 'demo-room';
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('[ERROR] Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET');
  process.exit(1);
}

if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
  console.error('[ERROR] Missing or invalid OPENAI_API_KEY in .env file');
  console.error('[ERROR] Please set OPENAI_API_KEY=sk-... in backend/.env');
  process.exit(1);
}

console.log('[AI-AGENT] Starting AI agent...');
console.log(`[AI-AGENT] Identity: ${AI_IDENTITY}`);
console.log(`[AI-AGENT] Target room: ${TARGET_ROOM}`);
console.log(`[AI-AGENT] LiveKit URL: ${LIVEKIT_URL}`);

// Generate token for AI agent
function generateAIToken(roomName) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: AI_IDENTITY,
    ttl: '24h',
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return token.toJwt();
}

// Audio format conversion helper
class AudioConverter {
  // Convert from LiveKit PCM (48kHz) to OpenAI PCM16 (24kHz)
  static resample48to24(inputBuffer) {
    // Simple downsampling: take every other sample (48kHz -> 24kHz)
    const outputLength = Math.floor(inputBuffer.length / 2);
    const output = new Int16Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      output[i] = inputBuffer[i * 2];
    }
    
    return output;
  }
  
  // Convert Float32 PCM to Int16 PCM
  static float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }
  
  // Convert audio frame to base64 PCM16 24kHz for OpenAI
  static convertForOpenAI(audioFrame) {
    // audioFrame.data is already Int16Array from LiveKit
    // Just need to resample from 48kHz to 24kHz
    const resampled = this.resample48to24(audioFrame.data);
    
    // Convert to base64
    const buffer = Buffer.from(resampled.buffer);
    return buffer.toString('base64');
  }
}

// OpenAI Realtime API handler
class OpenAIRealtimeSession {
  constructor(aiAgent) {
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
    this.audioChunksSent = 0;
    this.textResponsesReceived = 0;
    this.audioChunksReceived = 0;
    this.aiAgent = aiAgent; // Reference to AI agent for audio playback
  }
  
  async connect() {
    return new Promise((resolve, reject) => {
      console.log('[OPENAI] Connecting to Realtime API...');
      console.log(`[OPENAI] URL: ${OPENAI_REALTIME_URL}`);
      
      this.ws = new WebSocket(OPENAI_REALTIME_URL, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });
      
      this.ws.on('open', () => {
        console.log('[OPENAI] ✅ WebSocket connected');
        this.connected = true;
        this.initializeSession();
        resolve();
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(JSON.parse(data.toString()));
      });
      
      this.ws.on('error', (error) => {
        console.error('[OPENAI] ❌ WebSocket error:', error.message);
        this.connected = false;
        reject(error);
      });
      
      this.ws.on('close', () => {
        console.log('[OPENAI] 🔴 WebSocket closed');
        this.connected = false;
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('OpenAI connection timeout'));
        }
      }, 10000);
    });
  }
  
  initializeSession() {
    console.log('[OPENAI] Initializing session...');
    
    const sessionConfig = {
      type: 'session.update',
      session: {
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
    };
    
    this.send(sessionConfig);
    console.log('[OPENAI] Session configuration sent');
  }
  
  handleMessage(message) {
    const type = message.type;
    
    switch (type) {
      case 'session.created':
        this.sessionId = message.session.id;
        console.log('[OPENAI] ✅ TEST 3.1 PASS: Session created');
        console.log(`[OPENAI] Session ID: ${this.sessionId}`);
        console.log(`[OPENAI] Model: ${message.session.model}`);
        break;
        
      case 'session.updated':
        console.log('[OPENAI] Session updated successfully');
        break;
        
      case 'input_audio_buffer.speech_started':
        console.log('[OPENAI] 🎤 Speech detected (VAD)');
        break;
        
      case 'input_audio_buffer.speech_stopped':
        console.log('[OPENAI] 🔇 Speech ended (VAD)');
        break;
        
      case 'input_audio_buffer.committed':
        console.log('[OPENAI] Audio buffer committed');
        break;
        
      case 'conversation.item.input_audio_transcription.completed':
        const transcript = message.transcript;
        console.log(`[OPENAI] 📝 Transcription: "${transcript}"`);
        console.log('[OPENAI] ✅ TEST 3.3 PASS: Received text transcription');
        this.textResponsesReceived++;
        break;
        
      case 'response.audio_transcript.delta':
        process.stdout.write(message.delta);
        break;
        
      case 'response.audio_transcript.done':
        console.log(`\n[OPENAI] 🤖 AI Response: "${message.transcript}"`);
        break;
        
      case 'response.audio.done':
        console.log('[OPENAI] 🔊 Audio response completed');
        if (this.audioChunksReceived > 0) {
          console.log(`[OPENAI] Total audio chunks received: ${this.audioChunksReceived}`);
        }
        break;
        
      case 'response.audio.delta':
        // STEP 4: Receive AI audio from OpenAI
        this.audioChunksReceived++;
        
        if (this.audioChunksReceived <= 3) {
          const sizeKB = (message.delta.length * 0.75 / 1024).toFixed(2);
          console.log(`[OPENAI] ✅ TEST 4.1: Received audio delta #${this.audioChunksReceived} (${sizeKB} KB)`);
        }
        
        // Decode base64 to PCM16 buffer
        const pcm16Buffer = Buffer.from(message.delta, 'base64');
        
        // Forward to AI agent for playback in LiveKit
        if (this.aiAgent && this.aiAgent.audioSource) {
          this.aiAgent.playAudioInRoom(pcm16Buffer);
        }
        break;
        
      case 'response.done':
        console.log('[OPENAI] Response completed');
        break;
        
      case 'error':
        console.error('[OPENAI] ❌ Error:', message.error);
        break;
        
      default:
        // Uncomment for debugging:
        // console.log(`[OPENAI] Event: ${type}`);
        break;
    }
  }
  
  sendAudio(base64Audio) {
    if (!this.connected) {
      console.warn('[OPENAI] ⚠️  Cannot send audio: not connected');
      return;
    }
    
    const event = {
      type: 'input_audio_buffer.append',
      audio: base64Audio
    };
    
    this.send(event);
    this.audioChunksSent++;
    
    // Log first few chunks for Test 3.2
    if (this.audioChunksSent <= 3) {
      const sizeKB = (base64Audio.length * 0.75 / 1024).toFixed(2);
      console.log(`[OPENAI] ✅ TEST 3.2: Sent audio chunk #${this.audioChunksSent} (${sizeKB} KB)`);
    }
  }
  
  send(event) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

// Main AI agent class
class AIAgent {
  constructor() {
    this.room = null;
    this.audioFrameCount = 0;
    this.subscribedTracks = new Map();
    this.openai = new OpenAIRealtimeSession(this); // Pass reference to self
    this.audioSource = null;
    this.audioTrack = null;
    this.audioFramesPublished = 0;
  }

  async connect(roomName) {
    try {
      // First connect to OpenAI
      console.log('\n[STEP 3] Connecting to OpenAI Realtime API...');
      await this.openai.connect();
      console.log('[STEP 3] ✅ OpenAI connected\n');
      
      // Then connect to LiveKit
      console.log(`[AI-AGENT] Generating token for room: ${roomName}`);
      const token = await generateAIToken(roomName);
      
      console.log('[AI-AGENT] Creating room instance...');
      this.room = new Room();

      this.setupEventListeners();

      console.log('[AI-AGENT] Connecting to LiveKit...');
      await this.room.connect(LIVEKIT_URL, token, {
        autoSubscribe: true, // IMPORTANT: Auto-subscribe to all tracks
      });

      console.log('[AI-AGENT] ✅ Successfully connected to room!');
      console.log(`[AI-AGENT] Room name: ${this.room.name}`);
      console.log(`[AI-AGENT] Local participant SID: ${this.room.localParticipant.sid}`);
      console.log(`[AI-AGENT] Local participant identity: ${this.room.localParticipant.identity}`);

      // Wait a bit for initial participants to be discovered
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`[AI-AGENT] Remote participants: ${this.room.remoteParticipants.size}`);

      // STEP 5: Create and publish audio track for AI voice
      await this.setupAudioPublishing();

      return true;
    } catch (error) {
      console.error('[AI-AGENT] ❌ Connection failed:', error.message);
      console.error(error);
      throw error;
    }
  }

  setupEventListeners() {
    // Connection events
    this.room.on(RoomEvent.Connected, () => {
      console.log('[AI-AGENT] 🟢 RoomEvent.Connected');
      console.log('[AI-AGENT] ✅ TEST 2.1 PASS: AI agent connected to room');
    });

    this.room.on(RoomEvent.Disconnected, () => {
      console.log('[AI-AGENT] 🔴 RoomEvent.Disconnected');
    });

    this.room.on(RoomEvent.Reconnecting, () => {
      console.log('[AI-AGENT] 🟡 RoomEvent.Reconnecting');
    });

    this.room.on(RoomEvent.Reconnected, () => {
      console.log('[AI-AGENT] 🟢 RoomEvent.Reconnected');
    });

    // Participant events
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`\n[AI-AGENT] 👤 Participant joined: ${participant.identity}`);
      console.log(`[AI-AGENT]    - SID: ${participant.sid}`);
      console.log(`[AI-AGENT]    - Metadata: ${participant.metadata}`);
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log(`[AI-AGENT] 👋 Participant left: ${participant.identity}`);
      this.subscribedTracks.delete(participant.identity);
    });

    // Track subscription events (CRITICAL FOR TEST 2.2)
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`\n[AI-AGENT] 🎧 TrackSubscribed Event:`);
      console.log(`[AI-AGENT]    - Participant: ${participant.identity}`);
      console.log(`[AI-AGENT]    - Track kind: ${track.kind}`);
      console.log(`[AI-AGENT]    - Track SID: ${track.sid}`);
      console.log(`[AI-AGENT]    - Source: ${publication.source}`);

      if (track.kind === TrackKind.KIND_AUDIO) {
        console.log(`[AI-AGENT] ✅ TEST 2.2 PASS: Subscribed to audio from ${participant.identity}`);
        this.handleAudioTrack(track, participant);
      }
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      console.log(`[AI-AGENT] 🔇 TrackUnsubscribed: ${participant.identity} - ${track.kind}`);
      this.subscribedTracks.delete(participant.identity);
    });

    // Track published/unpublished events
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      console.log(`[AI-AGENT] 📢 Track published by ${participant.identity}: ${publication.kind}`);
    });

    this.room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      console.log(`[AI-AGENT] 📴 Track unpublished by ${participant.identity}: ${publication.kind}`);
    });

    // Active speakers
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      if (speakers.length > 0) {
        const speakerNames = speakers.map(s => s.identity).join(', ');
        console.log(`[AI-AGENT] 🗣️  Active speakers: ${speakerNames}`);
      }
    });
  }

  handleAudioTrack(track, participant) {
    console.log(`\n[AI-AGENT] 🎵 Setting up audio track handler for ${participant.identity}`);
    
    const trackInfo = {
      track,
      participant,
      frameCount: 0,
      lastFrameTime: Date.now(),
      totalBytes: 0,
    };
    
    this.subscribedTracks.set(participant.identity, trackInfo);

    // Listen for audio frames (CRITICAL FOR TEST 2.3 & STEP 3)
    const audioStream = new AudioStream(track);
    
    // Use async iterator to read frames
    (async () => {
      try {
        for await (const frame of audioStream) {
          trackInfo.frameCount++;
          trackInfo.lastFrameTime = Date.now();
          trackInfo.totalBytes += frame.data.length;
          
          // Log first few frames
          if (trackInfo.frameCount <= 3) {
            console.log(`[AI-AGENT] 🎵 Audio frame #${trackInfo.frameCount}:`);
            console.log(`[AI-AGENT]    - Size: ${frame.data.length} bytes`);
            console.log(`[AI-AGENT]    - Sample rate: ${frame.sampleRate} Hz`);
            console.log(`[AI-AGENT]    - Channels: ${frame.numChannels}`);
            console.log(`[AI-AGENT]    - Samples per channel: ${frame.samplesPerChannel}`);
          }
          
          if (trackInfo.frameCount === 1) {
            console.log(`[AI-AGENT] ✅ TEST 2.3 PASS: Receiving audio frames from ${participant.identity}`);
          }
          
          // STEP 3: Forward audio to OpenAI
          if (this.openai.connected) {
            try {
              const base64Audio = AudioConverter.convertForOpenAI(frame);
              this.openai.sendAudio(base64Audio);
            } catch (conversionError) {
              console.error('[AI-AGENT] ❌ Audio conversion error:', conversionError.message);
            }
          }
        }
      } catch (error) {
        console.error(`[AI-AGENT] ❌ Audio stream error for ${participant.identity}:`, error);
      }
    })();

    // Set up periodic stats logging
    const monitorInterval = setInterval(() => {
      if (!this.subscribedTracks.has(participant.identity)) {
        clearInterval(monitorInterval);
        return;
      }

      const info = this.subscribedTracks.get(participant.identity);
      const now = Date.now();
      const timeSinceLastFrame = now - info.lastFrameTime;

      if (info.frameCount > 0) {
        console.log(`\n[AI-AGENT] 📊 Audio stats for ${participant.identity}:`);
        console.log(`[AI-AGENT]    - Total frames: ${info.frameCount}`);
        console.log(`[AI-AGENT]    - Total bytes: ${info.totalBytes}`);
        console.log(`[AI-AGENT]    - Time since last: ${timeSinceLastFrame}ms`);
        console.log(`[AI-AGENT]    - Avg frame size: ${Math.round(info.totalBytes / info.frameCount)} bytes`);
      } else {
        console.log(`[AI-AGENT] ⚠️  No audio frames received yet from ${participant.identity}`);
        console.log(`[AI-AGENT]    Make sure the user is speaking into their microphone`);
      }
    }, 5000); // Log every 5 seconds

    console.log(`[AI-AGENT] ✅ Audio track handler configured for ${participant.identity}`);
    console.log(`[AI-AGENT]    Ready to receive audio data...`);
  }

  logStatus() {
    if (!this.room) {
      console.log('[AI-AGENT] Status: Not connected');
      return;
    }

    console.log('\n[AI-AGENT] ===== STATUS =====');
    console.log(`[AI-AGENT] Connected: ${this.room.isConnected}`);
    console.log(`[AI-AGENT] Room: ${this.room.name}`);
    console.log(`[AI-AGENT] Local participant: ${this.room.localParticipant.identity}`);
    console.log(`[AI-AGENT] Remote participants: ${this.room.remoteParticipants.size}`);
    
    this.room.remoteParticipants.forEach((participant) => {
      console.log(`[AI-AGENT]   - ${participant.identity} (${participant.sid})`);
      const audioTracks = Array.from(participant.trackPublications.values())
        .filter(pub => pub.kind === TrackKind.KIND_AUDIO);
      console.log(`[AI-AGENT]     Audio tracks: ${audioTracks.length}`);
    });

    console.log(`[AI-AGENT] Subscribed tracks: ${this.subscribedTracks.size}`);
    this.subscribedTracks.forEach((info, identity) => {
      console.log(`[AI-AGENT]   - ${identity}: ${info.frameCount} frames (${info.totalBytes} bytes)`);
    });
    console.log('[AI-AGENT] ==================\n');
  }

  async disconnect() {
    console.log('[AI-AGENT] Disconnecting...');
    
    if (this.openai) {
      this.openai.disconnect();
    }
    
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
      this.subscribedTracks.clear();
    }
    
    console.log('[AI-AGENT] Disconnected');
  }
  
  async setupAudioPublishing() {
    try {
      console.log('\n[STEP 5] Setting up AI audio publishing...');
      
      // Create audio source at 24kHz (OpenAI output format)
      this.audioSource = new AudioSource(24000, 1); // 24kHz, mono
      console.log('[STEP 5] AudioSource created (24kHz, mono)');
      
      // Create local audio track from source
      this.audioTrack = LocalAudioTrack.createAudioTrack('ai-voice', this.audioSource);
      console.log('[STEP 5] LocalAudioTrack created');
      
      // Publish track to room
      await this.room.localParticipant.publishTrack(this.audioTrack);
      console.log('[STEP 5] ✅ TEST 5.1 PASS: AI audio track published to room');
      console.log('[STEP 5] Track name: ai-voice');
      console.log('[STEP 5] Users can now hear AI responses\n');
      
    } catch (error) {
      console.error('[STEP 5] ❌ Failed to setup audio publishing:', error.message);
      throw error;
    }
  }
  
  async playAudioInRoom(pcm16Buffer) {
    if (!this.audioSource) {
      console.warn('[AI-AGENT] ⚠️  AudioSource not ready, skipping audio frame');
      return;
    }
    
    try {
      // Check queue size - wait if queue is getting full
      const MAX_QUEUE_DURATION_MS = 1000; // 1 second max queue
      if (this.audioSource.queuedDuration > MAX_QUEUE_DURATION_MS) {
        // Wait for queue to drain a bit
        await this.audioSource.waitForPlayout();
      }
      
      // Convert Buffer to Int16Array
      const int16Array = new Int16Array(
        pcm16Buffer.buffer,
        pcm16Buffer.byteOffset,
        pcm16Buffer.length / 2
      );
      
      const SAMPLE_RATE = 24000;
      const NUM_CHANNELS = 1;
      const numSamples = int16Array.length;
      
      // Create AudioFrame with the full buffer
      const audioFrame = new AudioFrame(
        int16Array,
        SAMPLE_RATE,
        NUM_CHANNELS,
        numSamples
      );
      
      // Capture frame into audio source (async operation)
      await this.audioSource.captureFrame(audioFrame);
      this.audioFramesPublished++;
      
      // Log first few frames for Test 5.2
      if (this.audioFramesPublished <= 3) {
        console.log(`[AI-AGENT] ✅ TEST 5.2: Published AI audio frame #${this.audioFramesPublished} to LiveKit (${numSamples} samples)`);
      }
      
    } catch (error) {
      console.error('[AI-AGENT] ❌ Error publishing audio frame:', error.message);
      // Don't throw - just log and continue
    }
  }
}

// Main execution
async function main() {
  const agent = new AIAgent();

  try {
    await agent.connect(TARGET_ROOM);

    // Log status every 10 seconds
    setInterval(() => {
      agent.logStatus();
    }, 10000);

    // Keep process alive
    console.log('\n[AI-AGENT] Agent is running. Press Ctrl+C to stop.\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[AI-AGENT] Shutting down...');
      await agent.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[AI-AGENT] Shutting down...');
      await agent.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('[AI-AGENT] Fatal error:', error);
    process.exit(1);
  }
}

// Run the agent
main();
