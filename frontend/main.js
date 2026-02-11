import { Room, RoomEvent, LogLevel } from 'livekit-client';

const BACKEND_URL = 'http://localhost:3000';

let room = null;
let audioTrack = null;

const elements = {
  status: document.getElementById('status'),
  connectBtn: document.getElementById('connectBtn'),
  micBtn: document.getElementById('micBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  identity: document.getElementById('identity'),
  roomName: document.getElementById('roomName'),
  audioIndicator: document.getElementById('audioIndicator'),
  audioLevelBar: document.getElementById('audioLevelBar'),
  speakerStatus: document.getElementById('speakerStatus'),
  logContainer: document.getElementById('logContainer'),
  testResults: document.getElementById('testResults'),
  test1: document.getElementById('test1'),
  test2: document.getElementById('test2'),
  test3: document.getElementById('test3'),
};

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  elements.logContainer.appendChild(entry);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
  console.log(`[${type.toUpperCase()}]`, message);
}

function updateStatus(status, message) {
  elements.status.className = `status ${status}`;
  const icons = {
    disconnected: '⚫',
    connecting: '🟡',
    connected: '🟢'
  };
  elements.status.textContent = `${icons[status]} ${message}`;
}

function updateTest(testNum, status, message) {
  const testEl = elements[`test${testNum}`];
  testEl.className = `test-item ${status}`;
  const icons = {
    pass: '✅',
    fail: '❌',
    pending: '⏳'
  };
  testEl.textContent = `${icons[status]} Test 1.${testNum}: ${message}`;
}

async function getToken(identity, roomName) {
  log(`Requesting token for ${identity} in room ${roomName}...`, 'info');
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identity, roomName }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    log('Token received successfully', 'success');
    return data;
  } catch (error) {
    log(`Failed to get token: ${error.message}`, 'error');
    throw error;
  }
}

async function connectToRoom() {
  try {
    const identity = elements.identity.value.trim();
    const roomName = elements.roomName.value.trim();

    if (!identity || !roomName) {
      log('Identity and room name are required', 'error');
      return;
    }

    elements.connectBtn.disabled = true;
    elements.identity.disabled = true;
    elements.roomName.disabled = true;
    updateStatus('connecting', 'Connecting...');
    elements.testResults.classList.add('active');

    const tokenData = await getToken(identity, roomName);

    room = new Room({
      logLevel: LogLevel.debug,
      adaptiveStream: true,
      dynacast: true,
    });

    setupRoomEventListeners();

    log(`Connecting to ${tokenData.url}...`, 'info');
    await room.connect(tokenData.url, tokenData.token);

    log('Connected to room successfully!', 'success');
    updateStatus('connected', `Connected to ${roomName}`);
    updateTest(1, 'pass', 'Room Connection - Connected successfully');

    elements.micBtn.disabled = false;
    elements.disconnectBtn.disabled = false;

    log(`Local participant: ${room.localParticipant.identity}`, 'info');
    log(`Room name: ${room.name}`, 'info');
    log(`Participants in room: ${room.remoteParticipants.size}`, 'info');

  } catch (error) {
    log(`Connection failed: ${error.message}`, 'error');
    updateStatus('disconnected', 'Connection failed');
    updateTest(1, 'fail', `Room Connection - ${error.message}`);
    elements.connectBtn.disabled = false;
    elements.identity.disabled = false;
    elements.roomName.disabled = false;
  }
}

function setupRoomEventListeners() {
  room.on(RoomEvent.Connected, () => {
    log('RoomEvent.Connected fired', 'success');
  });

  room.on(RoomEvent.Disconnected, (reason) => {
    log(`Disconnected: ${reason}`, 'warning');
    updateStatus('disconnected', 'Disconnected');
    resetUI();
  });

  room.on(RoomEvent.Reconnecting, () => {
    log('Reconnecting...', 'warning');
    updateStatus('connecting', 'Reconnecting...');
  });

  room.on(RoomEvent.Reconnected, () => {
    log('Reconnected successfully', 'success');
    updateStatus('connected', `Connected to ${room.name}`);
  });

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    log(`Participant joined: ${participant.identity}`, 'info');
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    log(`Participant left: ${participant.identity}`, 'info');
  });

  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    log(`Track published by ${participant.identity}: ${publication.kind}`, 'info');
  });

  room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
    log(`Track unpublished by ${participant.identity}: ${publication.kind}`, 'info');
  });

  room.on(RoomEvent.LocalTrackPublished, (publication) => {
    log(`Local track published: ${publication.kind}`, 'success');
    if (publication.kind === 'audio') {
      updateTest(2, 'pass', 'Mic Publish - Audio track published');
    }
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    if (speakers.length > 0) {
      const speakerNames = speakers.map(s => s.identity).join(', ');
      log(`Active speakers: ${speakerNames}`, 'info');
      elements.speakerStatus.textContent = `🗣️ Speaking: ${speakerNames}`;
      
      const isLocalSpeaking = speakers.some(s => s.identity === room.localParticipant.identity);
      if (isLocalSpeaking) {
        updateTest(3, 'pass', 'Audio Activity - Speaking detected!');
      }
    } else {
      elements.speakerStatus.textContent = 'Listening...';
    }
  });

  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    log('Audio playback status changed', 'info');
  });
}

async function enableMicrophone() {
  try {
    elements.micBtn.disabled = true;
    log('Requesting microphone access...', 'info');

    await room.localParticipant.setMicrophoneEnabled(true);
    
    audioTrack = room.localParticipant.getTrackPublication('microphone')?.track;
    
    if (audioTrack) {
      log('Microphone enabled successfully', 'success');
      elements.audioIndicator.classList.add('active');
      elements.micBtn.textContent = 'Disable Microphone';
      elements.micBtn.disabled = false;
      elements.micBtn.onclick = disableMicrophone;

      log(`Audio track: ${audioTrack.sid}`, 'info');
      log(`Audio track enabled: ${!audioTrack.isMuted}`, 'info');

      startAudioLevelMonitoring();
      updateTest(2, 'pass', 'Mic Publish - Microphone enabled and publishing');
    } else {
      throw new Error('Audio track not found after enabling');
    }

  } catch (error) {
    log(`Failed to enable microphone: ${error.message}`, 'error');
    updateTest(2, 'fail', `Mic Publish - ${error.message}`);
    elements.micBtn.disabled = false;
  }
}

async function disableMicrophone() {
  try {
    await room.localParticipant.setMicrophoneEnabled(false);
    log('Microphone disabled', 'info');
    elements.audioIndicator.classList.remove('active');
    elements.micBtn.textContent = 'Enable Microphone';
    elements.micBtn.onclick = enableMicrophone;
    audioTrack = null;
  } catch (error) {
    log(`Failed to disable microphone: ${error.message}`, 'error');
  }
}

function startAudioLevelMonitoring() {
  const updateAudioLevel = () => {
    if (!audioTrack || !room) return;

    const level = audioTrack.audioLevel || 0;
    const percentage = Math.min(level * 100, 100);
    elements.audioLevelBar.style.width = `${percentage}%`;

    if (level > 0.01) {
      log(`Audio level: ${(level * 100).toFixed(1)}%`, 'info');
    }

    requestAnimationFrame(updateAudioLevel);
  };

  updateAudioLevel();
}

function disconnect() {
  if (room) {
    log('Disconnecting from room...', 'info');
    room.disconnect();
    room = null;
  }
  resetUI();
}

function resetUI() {
  elements.connectBtn.disabled = false;
  elements.micBtn.disabled = true;
  elements.disconnectBtn.disabled = true;
  elements.identity.disabled = false;
  elements.roomName.disabled = false;
  elements.audioIndicator.classList.remove('active');
  elements.micBtn.textContent = 'Enable Microphone';
  elements.micBtn.onclick = enableMicrophone;
  audioTrack = null;
}

elements.connectBtn.addEventListener('click', connectToRoom);
elements.micBtn.addEventListener('click', enableMicrophone);
elements.disconnectBtn.addEventListener('click', disconnect);

log('Application initialized. Ready to connect.', 'success');
log('Fill in your identity and room name, then click Connect.', 'info');
