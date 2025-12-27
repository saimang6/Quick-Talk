// ===================================================================
// ROOM SOCKET & NETWORKING (room_socket.js)
// ===================================================================

const debouncedSendTypingStop = debounce(sendTypingStop, 1500);

// Default STUN-only config (fallback)
let iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

/**
 * Returns unlimited TURN server credentials from the Open Relay Project.
 * This replaces the rate-limited Metered.ca API to allow unlimited calls.
 * @returns {Promise<Object>} ICE configuration with robust TURN fallback
 */
async function fetchTurnCredentials() {
    console.log("Using Unlimited Open Relay Project TURN servers...");

    // Static configuration for Open Relay Project
    // Unlimited, community-funded STUN/TURN servers
    const config = {
        iceServers: [
            // Standard Google STUN servers (Fastest for P2P discovery)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },

            // OpenRelay TURN servers (Static Unlimited Credentials)
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        iceCandidatePoolSize: 10
    };

    return config;
}

let peerConnection = null;
let localStream = null; // Track local audio stream for cleanup
let iceCandidateQueue = []; // Queue for ICE candidates that arrive before remote description
let pendingCallData = null; // Stores incoming offer while waiting for Accept/Deny

// Video Call specific variables
let isVideoCall = false; // Flag to differentiate video call from voice call
let isCameraMuted = false; // Track camera on/off state
let pendingVideoCallData = null; // Stores incoming video offer while waiting for Accept/Deny

// Multi-peer connection support for group calls
let peerConnections = new Map(); // Map of peerId (username) -> RTCPeerConnection
let iceCandidateQueues = new Map(); // Map of peerId -> array of ICE candidates
let videoCallParticipants = new Set(); // Track active video call participants


/**
 * Cleans up WebRTC resources (peer connection, audio/video elements, streams)
 * @param {boolean} keepQueue - If true, preserves the iceCandidateQueue (used during call setup phase)
 */
function cleanupWebRTC(keepQueue = false) {
    console.log("Cleaning up WebRTC resources... (keepQueue: " + keepQueue + ")");

    // 1. Stop all local audio/video tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log("Stopped local track:", track.kind);
        });
        localStream = null;
    }

    // 2. Close existing single peer connection (for voice calls)
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // 2b. Close all peer connections in the map (for group video calls)
    peerConnections.forEach((pc, peerId) => {
        console.log("Closing peer connection for:", peerId);
        pc.close();
    });
    peerConnections.clear();

    // 3. Clear ICE candidate queues
    if (!keepQueue) {
        iceCandidateQueue = [];
        iceCandidateQueues.clear();
    }

    // 4. Remove and clear the remote audio element (for voice calls)
    const remoteAudio = document.getElementById('remote-voip-audio');
    if (remoteAudio) {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
        remoteAudio.remove();
    }

    // 5. Clear local video element
    const localVideo = document.getElementById('local-video');
    if (localVideo) {
        localVideo.srcObject = null;
    }

    // 6. Remove all dynamically created remote video tiles
    const videoGrid = document.getElementById('video-grid');
    if (videoGrid) {
        const remoteTiles = videoGrid.querySelectorAll('.video-tile:not(.local-tile)');
        remoteTiles.forEach(tile => tile.remove());
    }

    // 7. Reset video call states
    isVideoCall = false;
    isCameraMuted = false;
    videoCallParticipants.clear();
    updateVideoGridLayout();

    // 8. Hide Call UIs (both voice and video)
    hideCallInterface();
    hideVideoCallInterface();
}


/**
 * --- CALL UI MANAGEMENT ---
 */
let callTimerInterval = null;
let callStartTime = null;
let isMicMuted = false;
let isSpeakerMuted = false;

/**
 * Shows the call interface overlay.
 * @param {boolean} isIncoming - Whether this is an incoming call (shows Accept/Deny) or outgoing (shows Hangup)
 */
function showCallInterface(isIncoming = false) {
    const overlay = document.getElementById('call-interface-overlay');
    const ongoingActions = document.getElementById('ongoing-call-actions');
    const incomingActions = document.getElementById('incoming-call-actions');
    const statusText = document.getElementById('call-status-text');

    if (overlay) {
        overlay.classList.remove('hidden');
        resetCallUIStates();

        if (isIncoming) {
            if (ongoingActions) ongoingActions.classList.add('hidden');
            if (incomingActions) incomingActions.classList.remove('hidden');
            if (statusText) statusText.textContent = "Incoming Voice Call";
            stopCallTimer();
        } else {
            if (ongoingActions) ongoingActions.classList.remove('hidden');
            if (incomingActions) incomingActions.classList.add('hidden');
            if (statusText) statusText.textContent = "Ongoing Voice Call";
            startCallTimer();
        }
    }
}

function resetCallUIStates() {
    isMicMuted = false;
    isSpeakerMuted = false;

    const muteBtn = document.getElementById('mute-call-btn');
    const speakerBtn = document.getElementById('speaker-call-btn');

    if (muteBtn) {
        muteBtn.classList.remove('active');
        muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        muteBtn.title = "Mute Microphone";
    }

    if (speakerBtn) {
        speakerBtn.classList.remove('active');
        speakerBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        speakerBtn.title = "Mute Speaker";
    }
}

function toggleMic() {
    if (!localStream) return;

    isMicMuted = !isMicMuted;
    const audioTracks = localStream.getAudioTracks();

    audioTracks.forEach(track => {
        track.enabled = !isMicMuted;
    });

    const muteBtn = document.getElementById('mute-call-btn');
    if (muteBtn) {
        if (isMicMuted) {
            muteBtn.classList.add('active');
            muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            muteBtn.title = "Unmute Microphone";
        } else {
            muteBtn.classList.remove('active');
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            muteBtn.title = "Mute Microphone";
        }
    }

    console.log("Microphone " + (isMicMuted ? "muted" : "unmuted"));
}

function toggleSpeaker() {
    isSpeakerMuted = !isSpeakerMuted;
    const remoteAudio = document.getElementById('remote-voip-audio');

    if (remoteAudio) {
        remoteAudio.muted = isSpeakerMuted;
    }

    const speakerBtn = document.getElementById('speaker-call-btn');
    if (speakerBtn) {
        if (isSpeakerMuted) {
            speakerBtn.classList.add('active');
            speakerBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
            speakerBtn.title = "Unmute Speaker";
        } else {
            speakerBtn.classList.remove('active');
            speakerBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
            speakerBtn.title = "Mute Speaker";
        }
    }

    console.log("Speaker " + (isSpeakerMuted ? "muted" : "unmuted"));
}

function hideCallInterface() {
    const overlay = document.getElementById('call-interface-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('minimized'); // Reset state
        const miniBtn = document.getElementById('minimize-call-btn');
        if (miniBtn) miniBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
        stopCallTimer();
    }
}

function toggleMinimizeCall() {
    const overlay = document.getElementById('call-interface-overlay');
    const miniBtn = document.getElementById('minimize-call-btn');

    if (overlay) {
        const isMinimized = overlay.classList.toggle('minimized');

        if (miniBtn) {
            if (isMinimized) {
                miniBtn.innerHTML = '<i class="fas fa-expand-alt"></i>';
                miniBtn.title = "Expand Call Overlay";
            } else {
                miniBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
                miniBtn.title = "Minimize Call Overlay";
            }
        }

        console.log("Call interface " + (isMinimized ? "minimized" : "expanded"));
    }
}

function startCallTimer() {
    callStartTime = Date.now();
    const timerDisplay = document.getElementById('call-timer');

    if (callTimerInterval) clearInterval(callTimerInterval);

    callTimerInterval = setInterval(() => {
        const delta = Date.now() - callStartTime;
        const totalSeconds = Math.floor(delta / 1000);
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');

        if (timerDisplay) {
            timerDisplay.textContent = `${minutes}:${seconds}`;
        }
    }, 1000);
}

function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    const timerDisplay = document.getElementById('call-timer');
    if (timerDisplay) timerDisplay.textContent = "00:00";

    // Also reset video call timer
    const videoTimerDisplay = document.getElementById('video-call-timer');
    if (videoTimerDisplay) videoTimerDisplay.textContent = "00:00";
}

// ===================================================================
// VIDEO CALL UI MANAGEMENT
// ===================================================================

let videoCallTimerInterval = null;
let videoCallStartTime = null;

/**
 * Shows the video call interface overlay.
 * @param {boolean} isIncoming - Whether this is an incoming call (shows Accept/Deny) 
 */

function showVideoCallInterface(isIncoming = false) {
    const overlay = document.getElementById('video-call-overlay');
    const ongoingActions = document.getElementById('ongoing-video-call-actions');
    const incomingActions = document.getElementById('incoming-video-call-actions');
    const statusText = document.getElementById('video-call-status-text');

    if (overlay) {
        overlay.classList.remove('hidden');
        resetVideoCallUIStates();

        // Update grid layout to ensure local tile is shown correctly
        updateVideoGridLayout();

        if (isIncoming) {
            if (ongoingActions) ongoingActions.classList.add('hidden');
            if (incomingActions) incomingActions.classList.remove('hidden');
            if (statusText) statusText.textContent = "Incoming Video Call";
            stopVideoCallTimer();
        } else {
            if (ongoingActions) ongoingActions.classList.remove('hidden');
            if (incomingActions) incomingActions.classList.add('hidden');
            if (statusText) statusText.textContent = "Ongoing Video Call";
            startVideoCallTimer();
        }
    }
}

function hideVideoCallInterface() {
    const overlay = document.getElementById('video-call-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('minimized');
        const miniBtn = document.getElementById('minimize-video-call-btn');
        if (miniBtn) miniBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
        stopVideoCallTimer();
    }
}

function resetVideoCallUIStates() {
    isCameraMuted = false;

    const cameraBtn = document.getElementById('toggle-camera-btn');
    const muteBtn = document.getElementById('mute-video-call-btn');
    const localTile = document.getElementById('video-tile-local');

    if (cameraBtn) {
        cameraBtn.classList.remove('active');
        cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
        cameraBtn.title = "Turn Off Camera";
    }

    if (localTile) {
        localTile.classList.remove('camera-off');
    }

    if (muteBtn) {
        muteBtn.classList.remove('active');
        muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        muteBtn.title = "Mute Microphone";
    }
}

function toggleCamera() {
    if (!localStream) return;

    isCameraMuted = !isCameraMuted;
    const videoTracks = localStream.getVideoTracks();

    videoTracks.forEach(track => {
        track.enabled = !isCameraMuted;
    });

    const cameraBtn = document.getElementById('toggle-camera-btn');
    const localTile = document.getElementById('video-tile-local');

    if (cameraBtn) {
        if (isCameraMuted) {
            cameraBtn.classList.add('active');
            cameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
            cameraBtn.title = "Turn On Camera";
        } else {
            cameraBtn.classList.remove('active');
            cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
            cameraBtn.title = "Turn Off Camera";
        }
    }

    if (localTile) {
        localTile.classList.toggle('camera-off', isCameraMuted);
    }

    // Also update mic status indicator
    const localMicStatus = document.getElementById('local-mic-status');
    if (localMicStatus) {
        const icon = localMicStatus.querySelector('i');
        if (icon) {
            icon.classList.toggle('muted', isMicMuted);
        }
    }

    console.log("Camera " + (isCameraMuted ? "off" : "on"));
}


function toggleVideoCallMic() {
    if (!localStream) return;

    isMicMuted = !isMicMuted;
    const audioTracks = localStream.getAudioTracks();

    audioTracks.forEach(track => {
        track.enabled = !isMicMuted;
    });

    const muteBtn = document.getElementById('mute-video-call-btn');
    if (muteBtn) {
        if (isMicMuted) {
            muteBtn.classList.add('active');
            muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            muteBtn.title = "Unmute Microphone";
        } else {
            muteBtn.classList.remove('active');
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            muteBtn.title = "Mute Microphone";
        }
    }

    console.log("Video call mic " + (isMicMuted ? "muted" : "unmuted"));
}

function toggleMinimizeVideoCall() {
    const overlay = document.getElementById('video-call-overlay');
    const miniBtn = document.getElementById('minimize-video-call-btn');

    if (overlay) {
        const isMinimized = overlay.classList.toggle('minimized');

        if (miniBtn) {
            if (isMinimized) {
                miniBtn.innerHTML = '<i class="fas fa-expand-alt"></i>';
                miniBtn.title = "Expand Video Call";
            } else {
                miniBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
                miniBtn.title = "Minimize Video Call";
            }
        }

        console.log("Video call interface " + (isMinimized ? "minimized" : "expanded"));
    }
}

function startVideoCallTimer() {
    videoCallStartTime = Date.now();
    const timerDisplay = document.getElementById('video-call-timer');

    if (videoCallTimerInterval) clearInterval(videoCallTimerInterval);

    videoCallTimerInterval = setInterval(() => {
        const delta = Date.now() - videoCallStartTime;
        const totalSeconds = Math.floor(delta / 1000);
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');

        if (timerDisplay) {
            timerDisplay.textContent = `${minutes}:${seconds}`;
        }
    }, 1000);
}

function stopVideoCallTimer() {
    if (videoCallTimerInterval) {
        clearInterval(videoCallTimerInterval);
        videoCallTimerInterval = null;
    }
    const timerDisplay = document.getElementById('video-call-timer');
    if (timerDisplay) timerDisplay.textContent = "00:00";
}

// ===================================================================
// VIDEO TILE MANAGEMENT FOR GROUP CALLS
// ===================================================================

/**
 * Creates a new video tile for a remote participant
 * @param {string} peerId - The username of the remote participant
 * @returns {HTMLVideoElement} The video element inside the tile
 */
function createVideoTile(peerId) {
    const videoGrid = document.getElementById('video-grid');
    if (!videoGrid) return null;

    // Check if tile already exists
    let existingTile = document.getElementById(`video-tile-${peerId}`);
    if (existingTile) {
        return existingTile.querySelector('video');
    }

    // Create new video tile
    const tile = document.createElement('div');
    tile.className = 'video-tile connecting';
    tile.id = `video-tile-${peerId}`;

    const video = document.createElement('video');
    video.id = `remote-video-${peerId}`;
    video.autoplay = true;
    video.playsInline = true;

    const overlay = document.createElement('div');
    overlay.className = 'video-tile-overlay';
    overlay.innerHTML = `
        <span class="video-tile-name">${peerId}</span>
        <span class="video-tile-status">
            <i class="fas fa-microphone"></i>
        </span>
    `;

    tile.appendChild(video);
    tile.appendChild(overlay);
    videoGrid.appendChild(tile);

    // Update participant count and grid layout
    videoCallParticipants.add(peerId);
    updateVideoGridLayout();
    updateParticipantCount();

    console.log(`Created video tile for ${peerId}`);
    return video;
}

/**
 * Removes a video tile for a participant who left
 * @param {string} peerId - The username of the participant
 */
function removeVideoTile(peerId) {
    const tile = document.getElementById(`video-tile-${peerId}`);
    if (tile) {
        const video = tile.querySelector('video');
        if (video) {
            video.srcObject = null;
        }
        tile.remove();
    }

    // Close and remove peer connection for this user
    if (peerConnections.has(peerId)) {
        peerConnections.get(peerId).close();
        peerConnections.delete(peerId);
    }
    iceCandidateQueues.delete(peerId);
    videoCallParticipants.delete(peerId);

    updateVideoGridLayout();
    updateParticipantCount();

    console.log(`Removed video tile for ${peerId}`);
}

/**
 * Updates the video grid layout class based on number of participants
 */
function updateVideoGridLayout() {
    const videoGrid = document.getElementById('video-grid');
    if (!videoGrid) return;

    const tileCount = videoGrid.querySelectorAll('.video-tile').length;

    // Remove all participant classes
    videoGrid.classList.remove(
        'participants-2',
        'participants-3',
        'participants-4',
        'participants-5',
        'participants-6',
        'participants-many'
    );

    // Add appropriate class based on count
    if (tileCount === 2) {
        videoGrid.classList.add('participants-2');
    } else if (tileCount === 3) {
        videoGrid.classList.add('participants-3');
    } else if (tileCount === 4) {
        videoGrid.classList.add('participants-4');
    } else if (tileCount === 5) {
        videoGrid.classList.add('participants-5');
    } else if (tileCount === 6) {
        videoGrid.classList.add('participants-6');
    } else if (tileCount > 6) {
        videoGrid.classList.add('participants-many');
    }
}

/**
 * Updates the participant count badge
 */
function updateParticipantCount() {
    const countSpan = document.getElementById('video-participant-count');
    if (countSpan) {
        const videoGrid = document.getElementById('video-grid');
        const count = videoGrid ? videoGrid.querySelectorAll('.video-tile').length : 0;
        countSpan.textContent = count;
    }
}

/**
 * Creates a peer connection for a specific remote participant (for group calls)
 * @param {string} peerId - The username of the remote participant
 * @returns {RTCPeerConnection} The created peer connection
 */
async function createPeerConnectionForUser(peerId) {
    console.log(`Creating peer connection for: ${peerId}`);

    // Fetch TURN credentials
    const config = await fetchTurnCredentials();

    const pc = new RTCPeerConnection(config);

    // Store in map
    peerConnections.set(peerId, pc);

    // Initialize ICE queue for this peer
    if (!iceCandidateQueues.has(peerId)) {
        iceCandidateQueues.set(peerId, []);
    }

    // ICE candidate handler - send to specific peer
    pc.onicecandidate = (event) => {
        if (event.candidate && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            console.log(`Sending ICE candidate to ${peerId}`);
            chatSocket.send(JSON.stringify({
                'type': 'webrtc_signal',
                'data': { 'ice': event.candidate },
                'target_users': [peerId]
            }));
        }
    };

    // ICE connection state handler
    pc.oniceconnectionstatechange = () => {
        if (!pc) return;
        const state = pc.iceConnectionState;
        console.log(`ICE state for ${peerId}:`, state);

        const tile = document.getElementById(`video-tile-${peerId}`);

        if (state === 'connected' || state === 'completed') {
            if (tile) tile.classList.remove('connecting');
        } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
            if (state === 'failed') {
                displayMessage('System', `❌ Connection to ${peerId} failed.`, 'video-failed-' + Date.now());
            }
        }
    };

    // Track handler - receive remote stream
    pc.ontrack = (event) => {
        console.log(`Received track from ${peerId}:`, event.track.kind);

        const tile = document.getElementById(`video-tile-${peerId}`);
        if (tile) {
            tile.classList.remove('connecting');
        }

        if (event.track.kind === 'video') {
            const videoElement = document.getElementById(`remote-video-${peerId}`);
            if (videoElement) {
                videoElement.srcObject = event.streams[0];
                videoElement.play().catch(e => console.warn(`Video play blocked for ${peerId}:`, e));
            }
        }
    };

    // Add local tracks if available
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log(`Added ${track.kind} track to connection for ${peerId}`);
        });
    }

    return pc;
}


// Global listener for Call UI buttons
document.addEventListener('DOMContentLoaded', () => {
    const hangupBtn = document.getElementById('hangup-call-btn');
    const muteBtn = document.getElementById('mute-call-btn');
    const speakerBtn = document.getElementById('speaker-call-btn');
    const minimizeBtn = document.getElementById('minimize-call-btn');

    // Accept/Deny buttons
    const acceptBtn = document.getElementById('accept-call-btn');
    const denyBtn = document.getElementById('deny-call-btn');

    if (hangupBtn) {
        hangupBtn.addEventListener('click', () => {
            console.log("Hangup requested by user.");
            cleanupWebRTC();
            displayMessage('System', '🚫 You left the call.', 'voip-left-' + Date.now());
        });
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', toggleMic);
    }

    if (speakerBtn) {
        speakerBtn.addEventListener('click', toggleSpeaker);
    }

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMinimizeCall();
        });
    }

    if (acceptBtn) {
        acceptBtn.addEventListener('click', acceptCall);
    }

    if (denyBtn) {
        denyBtn.addEventListener('click', denyCall);
    }

    // Expand when clicking the minimized pill (but not its buttons)
    const callOverlay = document.getElementById('call-interface-overlay');
    if (callOverlay) {
        callOverlay.addEventListener('click', (e) => {
            if (callOverlay.classList.contains('minimized')) {
                // If the click target is NOT a button or inside a button
                if (!e.target.closest('.call-btn') && !e.target.closest('.minimize-call-btn')) {
                    toggleMinimizeCall();
                }
            }
        });
    }

    // ===================================================================
    // VIDEO CALL BUTTON LISTENERS
    // ===================================================================
    const hangupVideoBtn = document.getElementById('hangup-video-call-btn');
    const muteVideoBtn = document.getElementById('mute-video-call-btn');
    const toggleCameraBtn = document.getElementById('toggle-camera-btn');
    const minimizeVideoBtn = document.getElementById('minimize-video-call-btn');

    // Accept/Deny buttons for video call
    const acceptVideoBtn = document.getElementById('accept-video-call-btn');
    const denyVideoBtn = document.getElementById('deny-video-call-btn');

    if (hangupVideoBtn) {
        hangupVideoBtn.addEventListener('click', () => {
            console.log("Video call hangup requested by user.");
            cleanupWebRTC();
            displayMessage('System', '🚫 You left the video call.', 'video-left-' + Date.now());
        });
    }

    if (muteVideoBtn) {
        muteVideoBtn.addEventListener('click', toggleVideoCallMic);
    }

    if (toggleCameraBtn) {
        toggleCameraBtn.addEventListener('click', toggleCamera);
    }

    if (minimizeVideoBtn) {
        minimizeVideoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMinimizeVideoCall();
        });
    }

    if (acceptVideoBtn) {
        acceptVideoBtn.addEventListener('click', acceptVideoCall);
    }

    if (denyVideoBtn) {
        denyVideoBtn.addEventListener('click', denyVideoCall);
    }

    // Expand when clicking the minimized video call (but not its buttons)
    const videoCallOverlay = document.getElementById('video-call-overlay');
    if (videoCallOverlay) {
        videoCallOverlay.addEventListener('click', (e) => {
            if (videoCallOverlay.classList.contains('minimized')) {
                if (!e.target.closest('.call-btn') && !e.target.closest('.minimize-call-btn')) {
                    toggleMinimizeVideoCall();
                }
            }
        });
    }
});


async function createPeerConnection(preserveCandidates = false) {
    console.log("Initializing new RTCPeerConnection... (Preserve Candidates: " + preserveCandidates + ")");

    // CRITICAL: Clean up any existing connection first
    cleanupWebRTC(preserveCandidates);

    // Fetch fresh TURN credentials for cross-network support
    const freshConfig = await fetchTurnCredentials();
    console.log("Using ICE config with", freshConfig.iceServers.length, "servers");

    peerConnection = new RTCPeerConnection(freshConfig);

    // --- DEBUG: Monitor ICE connection state ---
    peerConnection.oniceconnectionstatechange = () => {
        if (!peerConnection) return; // Guard against null after cleanup
        const state = peerConnection.iceConnectionState;
        console.log("ICE Connection State:", state);

        const callType = isVideoCall ? 'Video' : 'Voice';
        const emoji = isVideoCall ? '📹' : '🎙️';

        if (state === 'connected' || state === 'completed') {
            displayMessage('System', `✅ ${callType} call connected!`, 'call-connected-' + Date.now());
        } else if (state === 'failed') {
            displayMessage('System', `❌ ${callType} call failed. Attempting to restart...`, 'call-failed-' + Date.now());
            // Try ICE restart
            if (peerConnection && peerConnection.restartIce) {
                console.log("Attempting ICE restart...");
                peerConnection.restartIce();
            }
        } else if (state === 'disconnected') {
            displayMessage('System', `⚠️ ${callType} call disconnected. Waiting for reconnection...`, 'call-disconnected-' + Date.now());
            // Wait a bit and check if it recovers, otherwise attempt restart
            setTimeout(() => {
                if (peerConnection && peerConnection.iceConnectionState === 'disconnected') {
                    console.log("Still disconnected after timeout, attempting ICE restart...");
                    if (peerConnection.restartIce) {
                        peerConnection.restartIce();
                    }
                }
            }, 3000);
        } else if (state === 'checking') {
            console.log("ICE checking - negotiating connection...");
        }
    };


    // --- DEBUG: Monitor ICE gathering state ---
    peerConnection.onicegatheringstatechange = () => {
        if (!peerConnection) return;
        console.log("ICE Gathering State:", peerConnection.iceGatheringState);
    };

    // 1. Listen for ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            console.log("Sending ICE Candidate:", event.candidate.type, event.candidate.protocol);
            chatSocket.send(JSON.stringify({
                'type': 'webrtc_signal',
                'data': { 'ice': event.candidate },
                'target_users': 'all'
            }));
        }
    };

    // 2. Listen for the remote audio/video stream
    peerConnection.ontrack = (event) => {
        console.log("Incoming stream detected! Track kind:", event.track.kind);

        if (event.track.kind === 'video') {
            // Handle incoming video track
            console.log("Processing video track for video call...");

            const remoteVideo = document.getElementById('remote-video');
            const placeholder = document.getElementById('remote-video-placeholder');

            if (remoteVideo) {
                remoteVideo.srcObject = event.streams[0];

                remoteVideo.play().then(() => {
                    console.log("Remote video playing successfully!");
                    if (placeholder) placeholder.classList.add('hidden');
                }).catch(e => {
                    console.warn("Video autoplay blocked:", e);
                    displayMessage('System', '📹 Click anywhere to enable video.', Date.now());
                    document.addEventListener('click', function resumeVideo() {
                        remoteVideo.play();
                        document.removeEventListener('click', resumeVideo);
                    }, { once: true });
                });
            }

            displayMessage('System', '📹 Video call connected!', 'video-connected-' + Date.now());
            showVideoCallInterface();

        } else if (event.track.kind === 'audio') {
            // Handle audio track - check if this is a video call or voice-only call
            if (isVideoCall) {
                // For video calls, audio comes through the video element
                console.log("Audio track received (video call - using video element)");
                const remoteVideo = document.getElementById('remote-video');
                if (remoteVideo && !remoteVideo.srcObject) {
                    remoteVideo.srcObject = event.streams[0];
                }
            } else {
                // Voice-only call - use audio element
                console.log("Processing audio-only call...");

                // Remove any existing audio element first
                let remoteAudio = document.getElementById('remote-voip-audio');
                if (remoteAudio) {
                    remoteAudio.pause();
                    remoteAudio.srcObject = null;
                    remoteAudio.remove();
                }

                // Create a fresh audio element
                remoteAudio = document.createElement('audio');
                remoteAudio.id = 'remote-voip-audio';
                document.body.appendChild(remoteAudio);

                // Set attributes for mobile compatibility
                remoteAudio.setAttribute('autoplay', 'true');
                remoteAudio.setAttribute('playsinline', 'true');
                remoteAudio.volume = 1.0; // Max volume
                remoteAudio.srcObject = event.streams[0];

                // CRITICAL: Manually trigger play to bypass browser silence policies
                remoteAudio.play().then(() => {
                    console.log("Remote audio playing successfully!");
                }).catch(e => {
                    console.warn("Autoplay blocked. User must click the page to hear audio.", e);
                    displayMessage('System', '🔊 Click anywhere to enable call audio.', Date.now());

                    // Add a one-time click listener to resume audio
                    document.addEventListener('click', function resumeAudio() {
                        remoteAudio.play();
                        document.removeEventListener('click', resumeAudio);
                    }, { once: true });
                });

                displayMessage('System', '🎙️ Voice call active.', 'voip-active-' + Date.now());
                showCallInterface();
            }
        }
    };
}




function connectWebSocket() {
    if (isFatalError) {
        console.log("Fatal error detected (Secret Check/Access Denial). Halting WebSocket connection attempt.");
        return;
    }

    // Check if the URL currently has the "request" parameter
    const urlParams = new URLSearchParams(window.location.search);
    const hasRequestQuery = urlParams.has('request');

    if (isPendingUser && hasRequestQuery) {
        if (mainChatContainer) {
            mainChatContainer.style.display = 'none'; // Inline override
            mainChatContainer.classList.add('hidden-chat-interface'); // Class override
        }
        if (requestOverlay) requestOverlay.style.display = 'flex';
    } else {
        if (mainChatContainer) {
            mainChatContainer.style.display = 'flex';
            mainChatContainer.classList.remove('hidden-chat-interface');
        }
        if (requestOverlay) requestOverlay.style.display = 'none';

        if (!hasRequestQuery) {
            isPendingUser = false;
            isAccessGranted = true;
        }
    }

    if (chatSocket && (chatSocket.readyState === WebSocket.OPEN || chatSocket.readyState === WebSocket.CONNECTING)) return;
    if (connectionLostModal) connectionLostModal.style.display = 'none';

    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const baseQuery = window.location.search ? window.location.search + '&' : '?';

    chatSocket = new WebSocket(
        `${wsProtocol}://${window.location.host}/ws/chat/${roomSlug}/${baseQuery}username=${fixedUsername}`
    );

    chatSocket.onopen = handleSocketOpen;
    chatSocket.onmessage = handleSocketMessage;
    chatSocket.onclose = handleSocketCloseDebug;
    chatSocket.onerror = handleSocketError;
}

function handleSocketOpen() {
    reconnectAttempts = 0;
    if (isOwner || !isPendingUser) {
        // Send a session active status after the connection is confirmed OPEN
        sendStatusUpdate('session_active');
    }

    // Reinforce the back button trap once the connection (and potentially page interaction) is established
    // Note: engageBackTrap is defined in room_main.js or can be made global. 
    // It's safer if engageBackTrap is available globally. It is in room_main or room_utils?
    // Wait, it is in room_main (planned). But functions in room_main might be defined later if room_main is loaded last.
    // Correction: engageBackTrap should be in room_utils if possible, or room_socket depends on room_main.
    // Current plan: room_main is LAST. 
    // If handleSocketOpen calls engageBackTrap, and engageBackTrap is in room_main, it is fine IF room_main has executed by the time socket opens.
    // Socket opens asynchronously, so room_main will likely have executed by then.
    if (typeof engageBackTrap === 'function') engageBackTrap();

    // ⭐ AUTO-SEND: Send a message automatically when socket opens (on page load/reload)
    // Only send if user is owner OR has been granted access
    setTimeout(() => {
        if (messageInputDom && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            // Check permissions before sending
            if (isOwner || isAccessGranted) {
                // Pre-fill the message input with an auto-message
                // const autoMessage = `🔄 Page reloaded at ${new Date().toLocaleTimeString()}`;
                // messageInputDom.value = autoMessage;

                console.log("Auto-Send: Sending message after socket opened.");
                sendMessage();
            } else {
                console.log("Auto-Send: Skipped - user doesn't have access yet.");
            }
        }
    }, 150); // Small delay to ensure WebSocket is fully ready
}

function handleSocketClose(e) {
    const SECRET_MISMATCH_CODE = 4005;

    if (e.code === SECRET_MISMATCH_CODE) {
        isFatalError = true;
        isUserLeaving = true;

        if (typeof Swal !== 'undefined' && typeof Swal.fire === 'function') {
            Swal.fire({
                title: 'Access Denied 🔒',
                html: 'Incorrect Secret Number! You will be redirected to the Lobby.',
                icon: 'error',
                customClass: { container: 'mobile-alert-responsive-container' },
                confirmButtonText: 'Go to Lobby',
                confirmButtonColor: '#DC2626',
                allowOutsideClick: false,
                allowEscapeKey: false
            }).then(() => {
                const redirectUrl = `/chat/lobby/?username=${fixedUsername}&join_failed=secret_mismatch`;
                window.location.replace(redirectUrl);
            });
        } else {
            console.warn("Access Denied: Secret Mismatch detected (Code 4005). Redirecting to lobby.");
            const denialBox = document.createElement('div');
            denialBox.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background-color: #EF4444; color: white; padding: 20px; border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); z-index: 10000;
                font-weight: bold; text-align: center;
            `;
            denialBox.textContent = 'ACCESS DENIED: Incorrect Secret. Redirecting...';
            document.body.appendChild(denialBox);

            setTimeout(() => {
                denialBox.remove();
                const redirectUrl = `/chat/lobby/?username=${fixedUsername}&join_failed=secret_mismatch`;
                window.location.replace(redirectUrl);
            }, 2000);
        }

        return;
    }

    if (isUserLeaving || isFatalError) {
        console.log("Socket closed normally or due to a forced exit. Not attempting reconnect.");
        return;
    }

    reconnectWebSocket();
}

function handleSocketError(e) {
    console.error('WebSocket error:', e);
}

function handleSocketCloseDebug(e) {
    console.log(`WebSocket closed: Code ${e.code}, Reason: ${e.reason}`);
    handleSocketClose(e);
}

function reconnectWebSocket() {
    if (isFatalError) {
        console.log("Fatal error detected. Reconnection attempts halted.");
        return;
    }

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        setTimeout(connectWebSocket, delay);
    } else {
        if (connectionLostModal) {
            connectionLostModal.style.display = 'flex';
        } else {
            displayMessage('System', 'Connection lost. Please refresh to rejoin.', Date.now());
        }
    }
}

// --- SENDING FUNCTIONS ---


function sendStatusUpdate(status) {
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({
            'type': 'status_update',
            'sender': fixedUsername,
            'status': status,
            'is_owner': isOwner
        }));
    }
}

function sendJoinRequest() {
    if (isPendingUser && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({
            'type': 'join_request',
            'requester_username': fixedUsername,
            'room_slug': roomSlug
        }));

        if (overlayStatusMessage) overlayStatusMessage.textContent = "Request sent. Waiting for owner's approval...";
        if (sendJoinRequestBtn) {
            sendJoinRequestBtn.disabled = true;
            sendJoinRequestBtn.textContent = "Request Sent";
            sendJoinRequestBtn.style.backgroundColor = '#6B7280';
        }
    }
}

function sendApprovalDecision(decision, requesterName) {
    if (isOwner && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({
            'type': decision + '_request',
            'requester_username': requesterName,
            'room_slug': roomSlug
        }));

        const requestId = 'req-' + requesterName;
        const requestCard = document.getElementById(requestId);
        if (requestCard) {
            requestCard.remove();
            const currentCount = parseInt(requestCountSpan.textContent);
            if (currentCount > 0) requestCountSpan.textContent = currentCount - 1;

            const newCount = parseInt(requestCountSpan.textContent);
            if (newCount === 0) requestsPanel.classList.add('hidden-panel');

            updateRequestPanelContent();
            updateBellIconColor(newCount);
        }
    }
}

function sendMessage() {
    const message = messageInputDom.value;
    const sender = fixedUsername;

    console.log("Attempting to send message:", message);


    if (!isOwner && !isAccessGranted && !isAwaitingServerSync) {
        // Prevent sending if not approved
        displayMessage('System (Error)', 'Access denied. Please wait for approval before sending messages.', 'error-client-' + Date.now());
        messageInputDom.value = '';
        return;
    }

    if (message.trim() === '' || !chatSocket || chatSocket.readyState !== WebSocket.OPEN) return;

    sendTypingStop();

    // Send the message to the WebSocket
    // Send the message to the WebSocket
    chatSocket.send(JSON.stringify({
        'type': 'message',
        'sender': sender,
        'message': message,
        'message_id': generateUUID(),
        'reply_to_id': currentReplyId // Send reply ID if exists
    }));

    cancelReply(); // Clear reply state

    // Clear the input field
    messageInputDom.value = '';
}

function sendTypingStart() {
    if (!isOwner && !isAccessGranted) return;
    if (!isTyping && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({ 'type': 'typing_start', 'sender': fixedUsername }));
        isTyping = true;
    }
}

function sendTypingStop() {
    if (!isOwner && !isAccessGranted) return;
    if (isTyping && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({ 'type': 'typing_stop', 'sender': fixedUsername }));
        isTyping = false;
    }
}

/**
 * Sends a command to the server to delete the current room.
 */
function sendDeleteRoom() {
    if (isOwner && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({
            'type': 'delete_room',
            'sender': fixedUsername,
            'room_slug': roomSlug
        }));
        // Note: The server should process the deletion and the client should redirect immediately after sending.
        console.log("Sent 'delete_room' command to the server.");
    }
}

function sendReaction(messageId, emoji) {
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({
            'type': 'add_reaction',
            'message_id': messageId,
            'emoji': emoji,
            'sender': fixedUsername
        }));
    }
}


// ===================================================================
// MESSAGE RECEIVING HANDLER
// ===================================================================

function handleSocketMessage(e) {
    const data = JSON.parse(e.data);
    console.log("WebSocket Message Received:", data.type);

    switch (data.type) {

        case 'access_granted':
            if (!isOwner && !isAccessGranted && isPendingUser) {
                if (requestOverlay) requestOverlay.style.display = 'none';
                if (mainChatContainer) {
                    mainChatContainer.classList.remove('hidden-chat-interface');
                    mainChatContainer.style.display = 'flex';
                }
                const approvalMessageDisplay = document.getElementById('awaiting-approval-message');
                if (approvalMessageDisplay) approvalMessageDisplay.classList.add('hidden');

                isPendingUser = false;
                isAwaitingServerSync = true;

                if (messageInputDom) messageInputDom.disabled = false;
                if (submitButtonDom) submitButtonDom.disabled = false;

                // --- CRITICAL FIX: CLEAN URL TO PREVENT "PENDING LOOP" ON RELOAD/RECONNECT ---
                // This ensures that if the browser refreshes or reconnects (e.g. after backgrounding),
                // the user is treated as an ACTIVE user (no request param) instead of a PENDING one.
                try {
                    const url = new URL(window.location);
                    if (url.searchParams.has('request')) {
                        url.searchParams.delete('request');
                        window.history.replaceState({}, '', url);
                        console.log("URL Cleaned: Removed 'request' parameter. User is now permanently active.");
                    }
                } catch (e) {
                    console.error("Failed to clean URL:", e);
                }
            }
            break;

        case 'error':
            if (isAwaitingServerSync && data.message.includes('Access denied')) {
                displayMessage('System (Notice)', 'Waiting for server state to finalize. Please try sending your message again shortly.', 'sync-notice-' + Date.now());
                setTimeout(() => {
                    isAccessGranted = true;
                    isAwaitingServerSync = false;
                }, 1000);
                return;
            }
            displayMessage('System (Error)', data.message, 'error-' + Date.now());
            break;

        case 'access_denied':
            if (!isOwner && isPendingUser) {
                isAccessGranted = false;
                isAwaitingServerSync = false;
                isPendingUser = false;
                if (overlayStatusMessage) overlayStatusMessage.textContent = "Access Denied.";
                if (denialMessageDisplay) denialMessageDisplay.style.display = 'block';
                if (sendJoinRequestBtn) sendJoinRequestBtn.style.display = 'none';
                setTimeout(() => {
                    isUserLeaving = true;
                    window.location.assign(`/chat/lobby/?username=${fixedUsername}`);
                }, 3000);
            }
            break;

        case 'join_request_notification':
            if (isOwner && data.requester_username) {
                displayRequestCard(data.requester_username);
            }
            break;

        case 'request_count_sync':
            if (isOwner && requestCountSpan) {
                requestCountSpan.textContent = data.count;
                updateBellIconColor(data.count);
                if (data.count > 0 && Array.isArray(data.requesters)) {
                    pendingRequestsContainer.innerHTML = '';
                    data.requesters.forEach(requester => displayRequestCard(requester, false));
                }
                updateRequestPanelContent();
            }
            break;

        case 'room_info':
            roomNameDisplay.textContent = data.room_name || roomSlug;
            creatorUsernameDisplay.textContent = data.creator_username || 'Unknown';
            break;

        case 'delete_confirmed':
            const idsToDelete = Array.isArray(data.message_id) ? data.message_id : [data.message_id];
            handleMessageDeletion(idsToDelete);
            break;

        case 'reaction_update':
            // Call UI helper function (defined in room_ui.js)
            updateMessageReactions(data.message_id, data.reactions);
            break;

        case 'message':
            if (isAwaitingServerSync) {
                isAccessGranted = true;
                isAwaitingServerSync = false;
            }
            // data.timestamp is correctly passed here
            displayMessage(data.sender, data.message, data.message_id, data.timestamp, false, data.attachment_url, data.is_image, data.reactions, data.reply_to);
            break;

        case 'typing_message':
            if (Array.isArray(data.typing_users)) {
                updateTypingIndicator(data.typing_users);
            }
            break;

        case 'user_list_update':
            if (data.action && data.username) {
                // Don't show "left the room" message if the owner is leaving (e.g., page refresh)
                // Show the message for all "joined" actions and "left" actions by non-owners
                const isOwnerLeaving = (data.username === creatorUsernameContext && data.action === 'left');

                if (!isOwnerLeaving) {
                    const actionMessage = `${data.username} has ${data.action} the room.`;
                    displayMessage('System', actionMessage, data.username + data.action + Date.now());
                }
            }
            if (Array.isArray(data.users)) {
                userCountSpan.textContent = data.users.length;
                updateUserListDisplay(data.users);
            }
            break;

        case 'catch_up_messages':
            if (Array.isArray(data.messages)) {
                data.messages.forEach(msg => {
                    displayMessage(
                        msg.sender,
                        msg.message,
                        msg.message_id,
                        msg.timestamp,
                        true,
                        msg.attachment_url,
                        msg.is_image,
                        msg.reactions,
                        msg.reply_to
                    );
                });
                if (chatLogDom) chatLogDom.scrollTop = chatLogDom.scrollHeight;
            }
            break;

        case 'session_status':
            if (data.status === 'pending') {
                console.log("Session Status: Pending (Reason: " + data.reason + ")");

                // If we receive this, it means we connected but are not in the active list.
                // If we are NOT the owner and NOT explicitly just requesting access (i.e., we are returning),
                // we treat this as a session timeout.

                // We check 'isAccessGranted' to see if we THOUGHT we had access.
                // Or if reason is 'timeout'.
                if (data.reason === 'timeout' || (isAccessGranted && !isOwner)) {
                    isAccessGranted = false;
                    isPendingUser = true;

                    Swal.fire({
                        title: 'Session Expired ⌛',
                        html: 'You have been away for too long and were disconnected due to inactivity.<br><br>Please return to the lobby and rejoin.',
                        icon: 'warning',
                        customClass: { container: 'mobile-alert-responsive-container' },
                        confirmButtonText: 'Go to Lobby',
                        confirmButtonColor: '#4F46E5',
                        allowOutsideClick: false,
                        allowEscapeKey: false
                    }).then((result) => {
                        if (result.isConfirmed) {
                            isUserLeaving = true;
                            window.location.assign(`/chat/lobby/?username=${fixedUsername}`);
                        }
                    });
                }
            }
            break;

        case 'webrtc_signal':
            // 1. IGNORE signals sent by yourself
            if (data.sender === fixedUsername) {
                console.log("WebRTC: Ignoring self-signal.");
                break;
            }

            console.log("WebRTC Signal Received from:", data.sender);
            const sender = data.sender;

            if (data.data.type === 'offer') {
                handleIncomingCall(data.data, sender);
            }
            else if (data.data.type === 'answer') {
                // Check if this is a group video call (using peerConnections Map)
                if (isVideoCall && peerConnections.has(sender)) {
                    const pc = peerConnections.get(sender);
                    if (pc && pc.signalingState === "have-local-offer") {
                        pc.setRemoteDescription(new RTCSessionDescription(data.data))
                            .then(() => {
                                console.log(`Remote description set for ${sender}. Processing queued ICE candidates...`);

                                // Process queued ICE candidates for this peer
                                const queue = iceCandidateQueues.get(sender) || [];
                                while (queue.length > 0) {
                                    const candidate = queue.shift();
                                    pc.addIceCandidate(new RTCIceCandidate(candidate))
                                        .then(() => console.log(`Added queued ICE candidate for ${sender}`))
                                        .catch(err => console.error(`Error adding ICE for ${sender}:`, err));
                                }
                            })
                            .catch(err => console.error(`Error setting remote answer from ${sender}:`, err));
                    }
                }
                // Fallback for voice calls (single peer connection)
                else if (peerConnection && peerConnection.signalingState === "have-local-offer") {
                    peerConnection.setRemoteDescription(new RTCSessionDescription(data.data))
                        .then(() => {
                            console.log("Remote description set (answer). Processing queued ICE candidates...");

                            // Process any queued ICE candidates
                            const processQueue = () => {
                                if (iceCandidateQueue.length > 0) {
                                    const candidate = iceCandidateQueue.shift();
                                    peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                                        .then(() => {
                                            console.log("Added queued ICE candidate");
                                            processQueue(); // Process next
                                        })
                                        .catch(err => {
                                            console.error("Error adding queued ICE candidate:", err);
                                            processQueue(); // Continue even on error
                                        });
                                }
                            };
                            processQueue();
                        })
                        .catch(err => console.error("Error setting remote answer:", err));
                }
            }
            else if (data.data.ice) {
                // Handle ICE candidate
                // For group video calls, use the Map
                if (isVideoCall && peerConnections.has(sender)) {
                    const pc = peerConnections.get(sender);
                    if (pc && pc.remoteDescription) {
                        pc.addIceCandidate(new RTCIceCandidate(data.data.ice))
                            .then(() => console.log(`Added ICE candidate from ${sender}`))
                            .catch(err => console.error(`Error adding ICE from ${sender}:`, err));
                    } else {
                        // Queue for this specific peer
                        if (!iceCandidateQueues.has(sender)) {
                            iceCandidateQueues.set(sender, []);
                        }
                        iceCandidateQueues.get(sender).push(data.data.ice);
                        console.log(`Queued ICE candidate for ${sender}`);
                    }
                }
                // Fallback for voice calls or when peer connection exists in traditional mode
                else if (peerConnection && peerConnection.remoteDescription) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(data.data.ice))
                        .then(() => console.log("Added ICE candidate successfully"))
                        .catch(err => console.error("Error adding ICE candidate:", err));
                } else {
                    // Queue for later (traditional mode)
                    console.log("Queueing ICE candidate (peer connection or remote description not ready)");
                    iceCandidateQueue.push(data.data.ice);

                    // Also queue per-sender for group calls
                    if (!iceCandidateQueues.has(sender)) {
                        iceCandidateQueues.set(sender, []);
                    }
                    iceCandidateQueues.get(sender).push(data.data.ice);
                }
            }

            break;



        default:
            console.warn('Unknown message type received:', data.type);
    }
}

// --- VoIP / WebRTC FUNCTIONS ---

// Function to handle an incoming call (Show UI, wait for Accept/Deny)
async function handleIncomingCall(offer, sender) {
    console.log("=== INCOMING CALL ===");
    console.log("Incoming call from:", sender);

    // Detect if this is a video call by checking if offer contains video track
    const hasVideo = offer.sdp && offer.sdp.includes('m=video');
    console.log("Call type:", hasVideo ? "VIDEO" : "VOICE");

    // Check if we are ALREADY in a video call - if so, add this person as a new participant
    if (hasVideo && isVideoCall && localStream) {
        console.log("Already in video call - adding new participant:", sender);

        // Create a video tile for this new participant
        createVideoTile(sender);

        // Create peer connection for this participant
        const pc = await createPeerConnectionForUser(sender);

        // Set remote description (their offer)
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Process any queued ICE candidates for this peer
        const queue = iceCandidateQueues.get(sender) || [];
        while (queue.length > 0) {
            const candidate = queue.shift();
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error(`Error adding queued ICE for ${sender}:`, err);
            }
        }

        // Create and send answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        chatSocket.send(JSON.stringify({
            'type': 'webrtc_signal',
            'data': answer,
            'target_users': [sender]
        }));

        displayMessage('System', `📹 ${sender} joined the video call.`, 'video-join-' + Date.now());
        return;
    }

    if (hasVideo) {
        // This is a NEW video call
        pendingVideoCallData = { offer, sender };
        isVideoCall = true;

        // Show video call overlay in "Incoming" mode
        showVideoCallInterface(true);
        displayMessage('System', `📹 Incoming video call from ${sender}...`, 'video-incoming-' + Date.now());
    } else {
        // This is a voice call
        pendingCallData = { offer, sender };
        isVideoCall = false;

        // Update UI and participant info
        const participantName = document.getElementById('call-participant-name');
        if (participantName) participantName.textContent = sender;

        // Show voice call overlay in "Incoming" mode
        showCallInterface(true);
        displayMessage('System', `📞 Incoming call from ${sender}...`, 'voip-incoming-' + Date.now());
    }
}


/**
 * Logic to accept an incoming call
 */
async function acceptCall() {
    if (!pendingCallData) return;
    const { offer, sender } = pendingCallData;
    pendingCallData = null; // Clear pending data

    try {
        console.log("Accepting call from:", sender);

        // Switch UI to "Ongoing" mode
        showCallInterface(false);

        // Initialize the connection object - PRESERVE the candidates we received while the overlay was visible!
        console.log("Step 1: Creating peer connection (preserving queued candidates)...");
        await createPeerConnection(true);

        // Get microphone access
        console.log("Step 2: Requesting microphone access...");
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log("Step 2: Added track to peer connection:", track.kind);
        });

        console.log("Step 3: Setting remote description (offer)...");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

        // Process any queued ICE candidates
        console.log("Step 3.5: Processing", iceCandidateQueue.length, "queued ICE candidates...");
        while (iceCandidateQueue.length > 0) {
            const candidate = iceCandidateQueue.shift();
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error("Error adding queued ICE candidate:", err);
            }
        }

        console.log("Step 4: Creating answer...");
        const answer = await peerConnection.createAnswer();

        console.log("Step 5: Setting local description (answer)...");
        await peerConnection.setLocalDescription(answer);

        console.log("Step 6: Sending answer to", sender);
        chatSocket.send(JSON.stringify({
            'type': 'webrtc_signal',
            'data': answer,
            'target_users': [sender]
        }));

        console.log("=== CALL ACCEPTED AND CONNECTED ===");
        displayMessage('System', '📱 Call connected.', 'voip-answering-' + Date.now());

    } catch (err) {
        console.error("=== FAILED TO ACCEPT CALL ===");
        console.error(err);
        cleanupWebRTC();
        displayMessage('System', '❌ Failed to connect call: ' + err.message, 'voip-error-' + Date.now());
    }
}

/**
 * Logic to deny an incoming call
 */
function denyCall() {
    if (!pendingCallData) return;
    console.log("Denying call from:", pendingCallData.sender);

    // Notify the other side optionally (for now just cleanup)
    pendingCallData = null;
    cleanupWebRTC();

    displayMessage('System', '❌ Call denied.', 'voip-denied-' + Date.now());
}

/**
 * Logic to accept an incoming VIDEO call
 */
async function acceptVideoCall() {
    if (!pendingVideoCallData) return;
    const { offer, sender } = pendingVideoCallData;
    pendingVideoCallData = null;

    try {
        console.log("Accepting VIDEO call from:", sender);
        isVideoCall = true;

        // Switch UI to "Ongoing" mode
        showVideoCallInterface(false);

        console.log("Step 1: Getting camera and microphone access...");
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: true
        });

        // Show local video preview
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.play().catch(e => console.warn("Local video play blocked:", e));
        }

        // Update grid layout for initial participant count
        updateVideoGridLayout();
        updateParticipantCount();

        // Create a video tile for the caller
        createVideoTile(sender);

        // Create peer connection for this specific caller
        console.log("Step 2: Creating peer connection for caller...");
        const pc = await createPeerConnectionForUser(sender);

        // Set remote description (their offer)
        console.log("Step 3: Setting remote description (offer)...");
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Process any queued ICE candidates for this peer
        const queue = iceCandidateQueues.get(sender) || [];
        console.log(`Step 3.5: Processing ${queue.length} queued ICE candidates for ${sender}...`);
        while (queue.length > 0) {
            const candidate = queue.shift();
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error("Error adding queued ICE candidate:", err);
            }
        }

        // Also process legacy queue
        while (iceCandidateQueue.length > 0) {
            const candidate = iceCandidateQueue.shift();
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error("Error adding legacy queued ICE candidate:", err);
            }
        }

        console.log("Step 4: Creating answer...");
        const answer = await pc.createAnswer();

        console.log("Step 5: Setting local description (answer)...");
        await pc.setLocalDescription(answer);

        console.log("Step 6: Sending answer to", sender);
        chatSocket.send(JSON.stringify({
            'type': 'webrtc_signal',
            'data': answer,
            'target_users': [sender]
        }));

        console.log("=== VIDEO CALL ACCEPTED AND CONNECTED ===");
        displayMessage('System', '📹 Video call connected.', 'video-answering-' + Date.now());

    } catch (err) {
        console.error("=== FAILED TO ACCEPT VIDEO CALL ===");
        console.error(err);
        cleanupWebRTC();
        displayMessage('System', '❌ Failed to connect video call: ' + err.message, 'video-error-' + Date.now());
    }
}

/**
 * Logic to deny an incoming VIDEO call
 */
function denyVideoCall() {
    if (!pendingVideoCallData) return;
    console.log("Denying video call from:", pendingVideoCallData.sender);

    pendingVideoCallData = null;
    isVideoCall = false;
    cleanupWebRTC();

    displayMessage('System', '❌ Video call denied.', 'video-denied-' + Date.now());
}

