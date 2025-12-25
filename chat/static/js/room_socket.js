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


/**
 * Cleans up WebRTC resources (peer connection, audio elements, streams)
 * @param {boolean} keepQueue - If true, preserves the iceCandidateQueue (used during call setup phase)
 */
function cleanupWebRTC(keepQueue = false) {
    console.log("Cleaning up WebRTC resources... (keepQueue: " + keepQueue + ")");

    // 1. Stop all local audio tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log("Stopped local track:", track.kind);
        });
        localStream = null;
    }

    // 2. Close existing peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // 3. Clear ICE candidate queue unless requested otherwise
    if (!keepQueue) {
        iceCandidateQueue = [];
    }


    // 3. Remove and clear the remote audio element
    const remoteAudio = document.getElementById('remote-voip-audio');
    if (remoteAudio) {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
        remoteAudio.remove();
    }

    // 4. Hide Call UI
    hideCallInterface();
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

        if (state === 'connected' || state === 'completed') {
            displayMessage('System', '✅ Voice call connected!', 'voip-connected-' + Date.now());
        } else if (state === 'failed') {
            displayMessage('System', '❌ Voice call failed. Attempting to restart...', 'voip-failed-' + Date.now());
            // Try ICE restart
            if (peerConnection && peerConnection.restartIce) {
                console.log("Attempting ICE restart...");
                peerConnection.restartIce();
            }
        } else if (state === 'disconnected') {
            displayMessage('System', '⚠️ Voice call disconnected. Waiting for reconnection...', 'voip-disconnected-' + Date.now());
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
                'target_user': 'all'
            }));
        }
    };

    // 2. Listen for the remote audio stream
    peerConnection.ontrack = (event) => {
        console.log("Incoming audio stream detected!", event.streams);

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

            if (data.data.type === 'offer') {
                handleIncomingCall(data.data, data.sender);
            }
            else if (data.data.type === 'answer') {
                // Set remote description if we are waiting for an answer
                if (peerConnection && peerConnection.signalingState === "have-local-offer") {
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
                // If we have peer connection AND remote description, add ICE immediately
                // Otherwise, queue it for later (even if peerConnection is null!)
                if (peerConnection && peerConnection.remoteDescription) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(data.data.ice))
                        .then(() => console.log("Added ICE candidate successfully"))
                        .catch(err => console.error("Error adding ICE candidate:", err));
                } else {
                    // CRITICAL FIX: Queue even when peerConnection is null (still being created)
                    console.log("Queueing ICE candidate (peer connection or remote description not ready)");
                    iceCandidateQueue.push(data.data.ice);
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

    // Save offer and sender for later acceptance
    pendingCallData = { offer, sender };

    // Update UI and participant info
    const participantName = document.getElementById('call-participant-name');
    if (participantName) participantName.textContent = sender;

    // Show overlay in "Incoming" mode (Accept/Deny)
    showCallInterface(true);

    // Show notification that we're receiving a call
    displayMessage('System', `📞 Incoming call from ${sender}...`, 'voip-incoming-' + Date.now());
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
            'target_user': sender
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


