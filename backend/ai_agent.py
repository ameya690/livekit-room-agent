#!/usr/bin/env python3
"""
LiveKit + OpenAI Realtime API Voice Agent (Python Implementation)

This AI agent:
1. Connects to a LiveKit room as a participant
2. Subscribes to audio from other participants
3. Sends audio to OpenAI Realtime API for processing
4. Receives AI responses and publishes them back to the room
"""

import asyncio
import os
import base64
import json
import numpy as np
from dotenv import load_dotenv
from livekit import rtc, api
import websockets

# Load environment variables
load_dotenv()

# Configuration
LIVEKIT_URL = os.getenv('LIVEKIT_URL', 'ws://localhost:7880')
LIVEKIT_API_KEY = os.getenv('LIVEKIT_API_KEY')
LIVEKIT_API_SECRET = os.getenv('LIVEKIT_API_SECRET')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
AI_IDENTITY = 'ai-agent'
TARGET_ROOM = os.getenv('TARGET_ROOM', 'demo-room')
OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17'

# Validate configuration
if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
    raise ValueError('[ERROR] Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET')

if not OPENAI_API_KEY or OPENAI_API_KEY == 'your_openai_api_key_here':
    raise ValueError('[ERROR] Missing or invalid OPENAI_API_KEY in .env file')


def generate_ai_token(room_name: str) -> str:
    """Generate LiveKit access token for AI agent"""
    token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    token.with_identity(AI_IDENTITY).with_name(AI_IDENTITY).with_grants(
        api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        )
    )
    return token.to_jwt()


def resample_audio(audio_data: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
    """Resample audio from one sample rate to another"""
    if from_rate == to_rate:
        return audio_data
    
    # Simple linear interpolation resampling
    ratio = to_rate / from_rate
    output_length = int(len(audio_data) * ratio)
    
    # Create output array
    output = np.zeros(output_length, dtype=np.int16)
    
    for i in range(output_length):
        src_index = i / ratio
        src_index_int = int(src_index)
        
        if src_index_int < len(audio_data) - 1:
            # Linear interpolation
            frac = src_index - src_index_int
            output[i] = int(audio_data[src_index_int] * (1 - frac) + 
                          audio_data[src_index_int + 1] * frac)
        else:
            output[i] = audio_data[-1]
    
    return output


class OpenAIRealtimeSession:
    """Manages connection to OpenAI Realtime API"""
    
    def __init__(self, ai_agent):
        self.ws = None
        self.connected = False
        self.session_id = None
        self.audio_chunks_sent = 0
        self.audio_chunks_received = 0
        self.text_responses_received = 0
        self.ai_agent = ai_agent
        
    async def connect(self):
        """Connect to OpenAI Realtime API"""
        print('[OPENAI] Connecting to Realtime API...')
        print(f'[OPENAI] URL: {OPENAI_REALTIME_URL}')
        
        headers = {
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'OpenAI-Beta': 'realtime=v1'
        }
        
        self.ws = await websockets.connect(OPENAI_REALTIME_URL, extra_headers=headers)
        self.connected = True
        print('[OPENAI] ✅ WebSocket connected')
        
        # Initialize session
        await self.initialize_session()
        
    async def initialize_session(self):
        """Configure OpenAI session"""
        print('[OPENAI] Initializing session...')
        
        session_config = {
            'type': 'session.update',
            'session': {
                'modalities': ['text', 'audio'],
                'instructions': 'You are a helpful voice assistant. Keep responses concise and natural.',
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
        
    async def send_audio(self, audio_data: bytes):
        """Send audio to OpenAI"""
        if not self.connected:
            return
            
        # Encode as base64
        base64_audio = base64.b64encode(audio_data).decode('utf-8')
        
        message = {
            'type': 'input_audio_buffer.append',
            'audio': base64_audio
        }
        
        await self.ws.send(json.dumps(message))
        self.audio_chunks_sent += 1
        
        if self.audio_chunks_sent <= 3:
            size_kb = len(base64_audio) * 0.75 / 1024
            print(f'[OPENAI] ✅ TEST 3.2: Sent audio chunk #{self.audio_chunks_sent} ({size_kb:.2f} KB)')
    
    async def handle_message(self, message_data: dict):
        """Handle messages from OpenAI"""
        msg_type = message_data.get('type')
        
        if msg_type == 'session.created':
            self.session_id = message_data['session']['id']
            print('[OPENAI] ✅ TEST 3.1 PASS: Session created')
            print(f'[OPENAI] Session ID: {self.session_id}')
            print(f'[OPENAI] Model: {message_data["session"]["model"]}')
            
        elif msg_type == 'session.updated':
            print('[OPENAI] Session updated successfully')
            
        elif msg_type == 'input_audio_buffer.speech_started':
            print('[OPENAI] 🎤 Speech detected (VAD)')
            
        elif msg_type == 'input_audio_buffer.speech_stopped':
            print('[OPENAI] 🔇 Speech ended (VAD)')
            
        elif msg_type == 'input_audio_buffer.committed':
            print('[OPENAI] Audio buffer committed')
            
        elif msg_type == 'conversation.item.input_audio_transcription.completed':
            transcript = message_data.get('transcript', '')
            print(f'[OPENAI] 📝 Transcription: "{transcript}"')
            print('[OPENAI] ✅ TEST 3.3 PASS: Received text transcription')
            self.text_responses_received += 1
            
        elif msg_type == 'response.audio_transcript.delta':
            delta = message_data.get('delta', '')
            print(delta, end='', flush=True)
            
        elif msg_type == 'response.audio_transcript.done':
            transcript = message_data.get('transcript', '')
            print(f'\n[OPENAI] 🤖 AI Response: "{transcript}"')
            
        elif msg_type == 'response.audio.delta':
            # Receive AI audio from OpenAI
            self.audio_chunks_received += 1
            
            if self.audio_chunks_received <= 3:
                delta = message_data.get('delta', '')
                size_kb = len(delta) * 0.75 / 1024
                print(f'[OPENAI] ✅ TEST 4.1: Received audio delta #{self.audio_chunks_received} ({size_kb:.2f} KB)')
            
            # Decode base64 to PCM16 buffer
            delta = message_data.get('delta', '')
            pcm16_buffer = base64.b64decode(delta)
            
            # Forward to AI agent for playback
            if self.ai_agent and self.ai_agent.audio_source:
                await self.ai_agent.play_audio_in_room(pcm16_buffer)
                
        elif msg_type == 'response.audio.done':
            print('[OPENAI] 🔊 Audio response completed')
            if self.audio_chunks_received > 0:
                print(f'[OPENAI] Total audio chunks received: {self.audio_chunks_received}')
            # Reset counter for next response
            self.audio_chunks_received = 0
            
        elif msg_type == 'response.done':
            print('[OPENAI] Response completed')
            
        elif msg_type == 'error':
            error = message_data.get('error', {})
            print(f'[OPENAI] ❌ Error: {error}')
    
    async def listen(self):
        """Listen for messages from OpenAI"""
        try:
            async for message in self.ws:
                data = json.loads(message)
                await self.handle_message(data)
        except Exception as e:
            print(f'[OPENAI] Error in listen loop: {e}')
            self.connected = False


class AIAgent:
    """AI Agent that participates in LiveKit rooms"""
    
    def __init__(self):
        self.room = None
        self.audio_frame_count = 0
        self.subscribed_tracks = {}
        self.openai = OpenAIRealtimeSession(self)
        self.audio_source = None
        self.audio_track = None
        self.audio_frames_published = 0
        self.audio_queue = asyncio.Queue()
        self.is_processing_audio = False
        
    async def connect(self, room_name: str):
        """Connect to LiveKit room and OpenAI"""
        try:
            # First connect to OpenAI
            print('\n[STEP 3] Connecting to OpenAI Realtime API...')
            await self.openai.connect()
            print('[STEP 3] ✅ OpenAI connected\n')
            
            # Then connect to LiveKit
            print('[AI-AGENT] Generating token for room:', room_name)
            token = generate_ai_token(room_name)
            
            print('[AI-AGENT] Creating room instance...')
            self.room = rtc.Room()
            
            # Set up event handlers
            self.setup_event_handlers()
            
            print('[AI-AGENT] Connecting to LiveKit...')
            await self.room.connect(LIVEKIT_URL, token)
            
            print('[AI-AGENT] ✅ Successfully connected to room!')
            print(f'[AI-AGENT] Room name: {self.room.name}')
            print(f'[AI-AGENT] Local participant SID: {self.room.local_participant.sid}')
            print(f'[AI-AGENT] Local participant identity: {self.room.local_participant.identity}')
            print(f'[AI-AGENT] Remote participants: {len(self.room.remote_participants)}')
            
            # Setup audio publishing
            await self.setup_audio_publishing()
            
            # Start OpenAI listener
            asyncio.create_task(self.openai.listen())
            
            # Start status reporting
            asyncio.create_task(self.report_status())
            
            return True
            
        except Exception as e:
            print(f'[AI-AGENT] ❌ Connection failed: {e}')
            return False
    
    def setup_event_handlers(self):
        """Setup LiveKit event handlers"""
        
        @self.room.on('participant_connected')
        def on_participant_connected(participant: rtc.RemoteParticipant):
            print(f'[AI-AGENT] 👤 Participant joined: {participant.identity}')
            print(f'[AI-AGENT]    - SID: {participant.sid}')
            
        @self.room.on('participant_disconnected')
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            print(f'[AI-AGENT] 👋 Participant left: {participant.identity}')
            if participant.identity in self.subscribed_tracks:
                del self.subscribed_tracks[participant.identity]
        
        @self.room.on('track_published')
        def on_track_published(publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            print(f'[AI-AGENT] 📢 Track published by {participant.identity}: {publication.kind}')
        
        @self.room.on('track_subscribed')
        def on_track_subscribed(
            track: rtc.Track,
            publication: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant
        ):
            print(f'[AI-AGENT] 🎧 TrackSubscribed Event:')
            print(f'[AI-AGENT]    - Participant: {participant.identity}')
            print(f'[AI-AGENT]    - Track kind: {track.kind}')
            print(f'[AI-AGENT]    - Track SID: {track.sid}')
            
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                print(f'[AI-AGENT] ✅ TEST 2.2 PASS: Subscribed to audio from {participant.identity}')
                asyncio.create_task(self.handle_audio_track(track, participant))
        
        @self.room.on('active_speakers_changed')
        def on_active_speakers_changed(speakers):
            speaker_identities = [s.identity for s in speakers]
            if speaker_identities:
                print(f'[AI-AGENT] 🗣️  Active speakers: {", ".join(speaker_identities)}')
    
    async def handle_audio_track(self, track: rtc.AudioTrack, participant: rtc.RemoteParticipant):
        """Handle incoming audio track from participant"""
        print(f'[AI-AGENT] 🎵 Setting up audio track handler for {participant.identity}')
        
        audio_stream = rtc.AudioStream(track)
        print(f'[AI-AGENT] ✅ Audio track handler configured for {participant.identity}')
        print('[AI-AGENT]    Ready to receive audio data...')
        
        # Track stats
        if participant.identity not in self.subscribed_tracks:
            self.subscribed_tracks[participant.identity] = {
                'frames': 0,
                'bytes': 0,
                'last_log': 0
            }
        
        async for frame in audio_stream:
            self.audio_frame_count += 1
            stats = self.subscribed_tracks[participant.identity]
            stats['frames'] += 1
            stats['bytes'] += len(frame.data)
            
            # Log first few frames
            if self.audio_frame_count <= 3:
                print(f'[AI-AGENT] 🎵 Audio frame #{self.audio_frame_count}:')
                print(f'[AI-AGENT]    - Size: {len(frame.data)} bytes')
                print(f'[AI-AGENT]    - Sample rate: {frame.sample_rate} Hz')
                print(f'[AI-AGENT]    - Channels: {frame.num_channels}')
                print(f'[AI-AGENT]    - Samples per channel: {frame.samples_per_channel}')
                
                if self.audio_frame_count == 3:
                    print('[AI-AGENT] ✅ TEST 2.3 PASS: Receiving audio frames from', participant.identity)
            
            # Convert frame data to numpy array
            audio_data = np.frombuffer(frame.data, dtype=np.int16)
            
            # Resample from 48kHz to 24kHz for OpenAI
            resampled = resample_audio(audio_data, frame.sample_rate, 24000)
            
            # Send to OpenAI
            await self.openai.send_audio(resampled.tobytes())
            
            # Log stats periodically
            if stats['frames'] % 500 == 0:
                avg_size = stats['bytes'] / stats['frames']
                print(f'[AI-AGENT] 📊 Audio stats for {participant.identity}:')
                print(f'[AI-AGENT]    - Total frames: {stats["frames"]}')
                print(f'[AI-AGENT]    - Total bytes: {stats["bytes"]}')
                print(f'[AI-AGENT]    - Avg frame size: {int(avg_size)} bytes')
    
    async def setup_audio_publishing(self):
        """Setup audio publishing for AI responses"""
        try:
            print('\n[STEP 5] Setting up AI audio publishing...')
            
            # Create audio source (24kHz, mono)
            self.audio_source = rtc.AudioSource(24000, 1)
            print('[STEP 5] AudioSource created (24kHz, mono)')
            
            # Create local audio track
            self.audio_track = rtc.LocalAudioTrack.create_audio_track('ai-voice', self.audio_source)
            print('[STEP 5] LocalAudioTrack created')
            
            # Publish track to room
            await self.room.local_participant.publish_track(self.audio_track)
            
            print('[STEP 5] ✅ TEST 5.1 PASS: AI audio track published to room')
            print('[STEP 5] Track name: ai-voice')
            print('[STEP 5] Users can now hear AI responses\n')
            
            # Start audio queue processor
            asyncio.create_task(self.process_audio_queue())
            
        except Exception as e:
            print(f'[STEP 5] ❌ Failed to setup audio publishing: {e}')
            raise
    
    async def play_audio_in_room(self, pcm16_buffer: bytes):
        """Queue audio for playback in room"""
        if not self.audio_source:
            print('[AI-AGENT] ⚠️  AudioSource not ready, skipping audio frame')
            return
        
        # Add to queue
        await self.audio_queue.put(pcm16_buffer)
    
    async def process_audio_queue(self):
        """Process audio queue sequentially"""
        print('[AI-AGENT] 🎵 Audio queue processor started')
        
        while True:
            try:
                # Get audio from queue
                pcm16_buffer = await self.audio_queue.get()
                
                # Convert to numpy array
                audio_data = np.frombuffer(pcm16_buffer, dtype=np.int16)
                
                # Create audio frame
                frame = rtc.AudioFrame(
                    data=audio_data.tobytes(),
                    sample_rate=24000,
                    num_channels=1,
                    samples_per_channel=len(audio_data)
                )
                
                # Capture frame
                await self.audio_source.capture_frame(frame)
                self.audio_frames_published += 1
                
                # Log first few frames
                if self.audio_frames_published <= 3:
                    print(f'[AI-AGENT] ✅ TEST 5.2: Published AI audio frame #{self.audio_frames_published} to LiveKit ({len(audio_data)} samples)')
                
                # Small delay to prevent overwhelming
                await asyncio.sleep(0.01)
                
            except Exception as e:
                print(f'[AI-AGENT] ❌ Error processing audio queue: {e}')
    
    async def report_status(self):
        """Periodically report agent status"""
        print('\n[AI-AGENT] Agent is running. Press Ctrl+C to stop.\n')
        
        while True:
            await asyncio.sleep(10)
            
            print('\n[AI-AGENT] ===== STATUS =====')
            print(f'[AI-AGENT] Connected: {self.room is not None}')
            print(f'[AI-AGENT] Room: {self.room.name if self.room else "N/A"}')
            print(f'[AI-AGENT] Local participant: {self.room.local_participant.identity if self.room else "N/A"}')
            print(f'[AI-AGENT] Remote participants: {len(self.room.remote_participants) if self.room else 0}')
            
            if self.subscribed_tracks:
                for identity, stats in self.subscribed_tracks.items():
                    print(f'[AI-AGENT]   - {identity} ({stats["frames"]} frames, {stats["bytes"]} bytes)')
            
            print(f'[AI-AGENT] Subscribed tracks: {len(self.subscribed_tracks)}')
            print('[AI-AGENT] ==================\n')
    
    async def disconnect(self):
        """Disconnect from room and OpenAI"""
        print('[AI-AGENT] Shutting down...')
        
        if self.room:
            print('[AI-AGENT] Disconnecting...')
            await self.room.disconnect()
        
        if self.openai.ws:
            await self.openai.ws.close()
        
        print('[AI-AGENT] Disconnected')


async def main():
    """Main entry point"""
    print('[AI-AGENT] Starting AI agent...')
    print(f'[AI-AGENT] Identity: {AI_IDENTITY}')
    print(f'[AI-AGENT] Target room: {TARGET_ROOM}')
    print(f'[AI-AGENT] LiveKit URL: {LIVEKIT_URL}')
    
    agent = AIAgent()
    
    try:
        success = await agent.connect(TARGET_ROOM)
        
        if success:
            # Keep running until interrupted
            await asyncio.Event().wait()
    except KeyboardInterrupt:
        print('\n[AI-AGENT] Received interrupt signal')
    except Exception as e:
        print(f'[AI-AGENT] ❌ Error: {e}')
    finally:
        await agent.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
