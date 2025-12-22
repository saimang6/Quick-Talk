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
 * Fetches fresh TURN server credentials from Metered.ca API.
 * This ensures credentials are always valid for cross-network calls.
 * @returns {Promise<Object>} ICE configuration with TURN servers
 */
async function fetchTurnCredentials() {
    try {
        // Metered.ca TURN server API - using quicktalk app
        const response = await fetch("https://quicktalk.metered.live/api/v1/turn/credentials?apiKey=f5f8750f2bb6f9b2c77af9c980b8f0688ab6");

        if (!response.ok) {
            throw new Error(`TURN API returned ${response.status}`);
        }

        const iceServers = await response.json();
        console.log("Fetched fresh TURN credentials:", iceServers.length, "servers");

        return {
            iceServers: iceServers,
            iceCandidatePoolSize: 10
        };
    } catch (err) {
        console.warn("Failed to fetch TURN credentials, using hardcoded TURN fallback:", err.message);

        // Hardcoded fallback with multiple TURN options
        return {
            iceServers: [
                // STUN servers
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // OpenRelay TURN servers (static credentials)
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
    }
}

let peerConnection = null;
let localStream = null; // Track local audio stream for cleanup
let iceCandidateQueue = []; // Queue for ICE candidates that arrive before remote description


/**
 * Cleans up WebRTC resources (peer connection, audio elements, streams)
 */
function cleanupWebRTC() {
    console.log("Cleaning up WebRTC resources...");

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

    // 3. Clear ICE candidate queue
    iceCandidateQueue = [];


    // 3. Remove and clear the remote audio element
    const remoteAudio = document.getElementById('remote-voip-audio');
    if (remoteAudio) {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
        remoteAudio.remove();
    }
}

async function createPeerConnection() {
    console.log("Initializing new RTCPeerConnection...");

    // CRITICAL: Clean up any existing connection first
    cleanupWebRTC();

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

        displayMessage('System', '🎙️ Voice call active.', Date.now());
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

// Function to handle an incoming call (The "Answer" logic)
async function handleIncomingCall(offer, sender) {
    try {
        console.log("=== INCOMING CALL ===");
        console.log("Handling incoming call from:", sender);

        // Show notification that we're receiving a call
        displayMessage('System', `📞 Incoming call from ${sender}...`, 'voip-incoming-' + Date.now());

        // Initialize the connection object first (this also cleans up old connections)
        console.log("Step 1: Creating peer connection...");
        await createPeerConnection();
        console.log("Step 1: Peer connection created successfully");

        // Get microphone access and store in global for cleanup
        console.log("Step 2: Requesting microphone access...");
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Step 2: Microphone access granted, tracks:", localStream.getTracks().length);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log("Step 2: Added track to peer connection:", track.kind, track.readyState);
        });

        console.log("Step 3: Setting remote description (offer)...");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("Step 3: Remote description set successfully");

        // CRITICAL: Process any ICE candidates that were queued while we were setting up
        console.log("Step 3.5: Processing", iceCandidateQueue.length, "queued ICE candidates...");
        while (iceCandidateQueue.length > 0) {
            const candidate = iceCandidateQueue.shift();
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log("Added queued ICE candidate");
            } catch (err) {
                console.error("Error adding queued ICE candidate:", err);
            }
        }

        console.log("Step 4: Creating answer...");
        const answer = await peerConnection.createAnswer();
        console.log("Step 4: Answer created, type:", answer.type);

        console.log("Step 5: Setting local description (answer)...");
        await peerConnection.setLocalDescription(answer);
        console.log("Step 5: Local description set successfully");

        console.log("Step 6: Sending answer to", sender);
        chatSocket.send(JSON.stringify({
            'type': 'webrtc_signal',
            'data': answer,
            'target_user': sender
        }));

        console.log("=== CALL ANSWER SENT SUCCESSFULLY ===");
        displayMessage('System', '📱 Answering call...', 'voip-answering-' + Date.now());

    } catch (err) {
        console.error("=== INCOMING CALL FAILED ===");
        console.error("Failed to handle incoming call:", err);
        console.error("Error name:", err.name);
        console.error("Error message:", err.message);
        displayMessage('System', '❌ Failed to answer call: ' + err.message, 'voip-error-' + Date.now());
    }
}


