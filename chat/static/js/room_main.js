// ===================================================================
// ROOM MAIN EXECUTION & EVENT LISTENERS (room_main.js)
// ===================================================================

// --- CRITICAL OWNER RE-ENTRY SECURITY CHECK EXECUTION ---
function checkOwnerSecretOnLoad() {
    if (!isOwner) return;

    const urlParams = new URLSearchParams(window.location.search);
    const hasSecret = urlParams.has('secret');
    const roomVisitKey = `room_visited_${fixedUsername}_${roomSlug}`;

    console.log(`[Security Check] Owner: ${fixedUsername}, Room: ${roomSlug}, Has Secret: ${hasSecret}`);

    // FIX 1: Add check for 'new=true' flag and skip security
    const isNewRoomCreation = urlParams.get('new') === 'true';
    if (isNewRoomCreation) {
        console.log("[Security Check] New room creation detected - marking as visited");
        localStorage.setItem(roomVisitKey, 'true');
        console.log(`[Security Check] localStorage set: ${roomVisitKey} = true`);
        return;
    }

    // If owner has secret, mark as visited immediately
    if (isOwner && hasSecret) {
        console.log("[Security Check] Owner has secret - marking as visited");
        localStorage.setItem(roomVisitKey, 'true');
        console.log(`[Security Check] localStorage set: ${roomVisitKey} = true`);
        return; // Allow access
    }

    // If owner doesn't have secret, check if they've visited before
    if (isOwner && !hasSecret) {
        const hasVisitedBefore = localStorage.getItem(roomVisitKey);
        console.log(`[Security Check] No secret. hasVisitedBefore: ${hasVisitedBefore}`);

        if (!hasVisitedBefore) {
            // First time accessing this room (new room creation) - allow access without alert
            console.log("[Security Check] First visit without secret - allowing access and marking as visited");
            localStorage.setItem(roomVisitKey, 'true');
            return; // Skip the security check on first visit
        } else {
            // This is a reload of an existing session - show security alert
            console.log("[Security Check] Reload detected - showing security alert");
            isFatalError = true;

            (async () => {
                const { value: secret } = await Swal.fire({
                    title: 'Owner Re-entry Security Check 🔒',
                    html: 'As the room owner, please re-enter your **Secret Room Number** to regain access to the chat room.',
                    input: 'text',
                    inputLabel: `Room Slug: ${roomSlug}`,
                    inputPlaceholder: 'Enter the secret number...',
                    showCancelButton: true,
                    confirmButtonText: 'Validate and Enter',
                    confirmButtonColor: '#4F46E5',
                    cancelButtonText: 'Go to Lobby',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    inputValidator: (value) => {
                        if (!value) {
                            return 'The secret number is required for owner access!';
                        }
                    }
                });

                if (secret) {
                    urlParams.set('secret', secret.trim());
                    urlParams.set('owner_access', 'true');

                    // --- FIX 2A: Clear the unload handler before navigating ---
                    disableExitPrevention();

                    window.location.replace(window.location.pathname + '?' + urlParams.toString());
                } else {
                    isUserLeaving = true;
                    window.location.replace(`/chat/lobby/?username=${fixedUsername}`);
                }
            })();

            throw new Error("Owner re-entry check initiated. Halting script execution.");
        }
    }
}

// 1. CRITICAL SECURITY CHECK EXECUTION
try {
    enableExitPrevention();

    checkOwnerSecretOnLoad();
} catch (e) {
    console.log(e.message);
}

// --- INITIALIZATION AND EVENT LISTENERS ---
const voipCallBtn = document.getElementById('voip-call-btn');
if (voipCallBtn) {
    voipCallBtn.addEventListener('click', async () => {
        // CRITICAL FIX FOR MOBILE: Request microphone access FIRST, in the direct user gesture context.
        // Mobile browsers require getUserMedia to be called directly from a user gesture, 
        // not from within a Promise callback (like SweetAlert's .then()).

        try {
            // Pre-request microphone access while still in gesture context
            console.log("Requesting microphone access (for gesture context)...");
            const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Immediately stop the test stream - we'll get a new one in startVoiceCall
            testStream.getTracks().forEach(track => track.stop());
            console.log("Microphone access granted!");

            // Now show confirmation (user already granted mic access)
            const result = await Swal.fire({
                title: 'Start Voice Call?',
                text: "This will broadcast a call invitation to everyone in the room.",
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Call Now'
            });

            if (result.isConfirmed) {
                startVoiceCall();
            }
        } catch (err) {
            console.error("Microphone access denied:", err);
            Swal.fire({
                title: 'Microphone Required',
                text: 'Please allow microphone access to use voice calls.',
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    });
}

// --- VIDEO CALL BUTTON LISTENER ---
const videoCallBtn = document.getElementById('video-call-btn');
if (videoCallBtn) {
    videoCallBtn.addEventListener('click', async () => {
        try {
            // Pre-request camera and microphone access while still in gesture context
            console.log("Requesting camera and microphone access (for gesture context)...");
            const testStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            // Immediately stop the test stream - we'll get a new one in startVideoCall
            testStream.getTracks().forEach(track => track.stop());
            console.log("Camera and microphone access granted!");

            // Now show confirmation
            const result = await Swal.fire({
                title: 'Start Video Call? 📹',
                text: "This will broadcast a video call invitation to selected participants (or everyone if none selected).",
                icon: 'question',
                iconColor: '#10b981',
                showCancelButton: true,
                confirmButtonText: 'Start Video Call',
                confirmButtonColor: '#10b981',
                cancelButtonText: 'Cancel'
            });

            if (result.isConfirmed) {
                startVideoCall();
            }
        } catch (err) {
            console.error("Camera/Microphone access denied:", err);
            Swal.fire({
                title: 'Camera & Microphone Required',
                text: 'Please allow camera and microphone access to use video calls.',
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    });
}


window.addEventListener('pageshow', (event) => {
    // Check for BFcache restore AND confirm we are the owner
    // We only care about the owner here, as their exit is the critical path.
    if (event.persisted && isOwner) {
        console.log('BFCACHE DETECTED (Owner Bypass Attempt). Forcing hard reload.');

        // Ensure the flag is reset before reloading
        isUserLeaving = false;

        // This is the single, most critical command. 
        // We force a complete re-fetch from the server, preventing the browser 
        // from using the cached state that allowed the bypass.
        window.location.reload(true);

        // Stop any pending script execution from the cached state
        throw new Error("Hard reload forced by pageshow listener.");
    }
});

// --- MOBILE APP BACKGROUND/FOREGROUND RECONNECT LOGIC ---
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log("App returned to foreground.");

        // CRITICAL: Skip aggressive reconnect if a voice call is active
        // Closing the WebSocket during a call can disrupt the WebRTC connection
        if (peerConnection && peerConnection.connectionState !== 'closed') {
            console.log("Voice call active - skipping socket refresh to preserve call.");
            return;
        }

        // Aggressively refresh connection to ensure immediate message sync.
        // This handles "zombie" connections that appear OPEN but are dead/stale due to backgrounding.
        if (chatSocket) {
            console.log("Visibility change detected. Forcing socket refresh...");

            // We reset to 0 to ensure the NEXT connection starts its backoff from the beginning.
            reconnectAttempts = 0;

            if (chatSocket.readyState === WebSocket.OPEN || chatSocket.readyState === WebSocket.CONNECTING) {
                chatSocket.close();
            } else {
                connectWebSocket();
            }
        } else {
            connectWebSocket();
        }
    }
});


// Mobile Swipe Back Trap
const initialHistoryState = { roomActive: true };

function engageBackTrap() {
    // 1. Replace current state to ensure valid baseline
    history.replaceState(null, null, window.location.href);
    // 2. Push state to create the "trap" entry
    history.pushState(initialHistoryState, null, window.location.href);
}

// Engage immediately
engageBackTrap();

// Reinforce on load
window.addEventListener('load', () => {
    setTimeout(() => {
        history.pushState(initialHistoryState, null, window.location.href);
    }, 0);
});

window.addEventListener('popstate', function (event) {
    if (!isUserLeaving) {
        // ALWAYS push state back to trap the user, regardless of role
        history.pushState(initialHistoryState, null, window.location.href);


        // Notify the user why they are trapped
        Swal.fire({
            title: 'Do Not Use Back Button',
            text: "Please use the 'Leave' button in the room interface to safely exit the chat room.",
            icon: 'warning',
            customClass: { container: 'mobile-alert-responsive-container' },
            confirmButtonText: 'I Understand',
            confirmButtonColor: '#F59E0B'
        });
    }
});

// 2. CONNECT WEBSOCKET (only runs if checkOwnerSecretOnLoad did not halt)
document.addEventListener('DOMContentLoaded', () => {
    if (!isFatalError) {
        connectWebSocket();
    }
});

// Wire up DOM elements
if (hamburgerMenuBtn) {
    hamburgerMenuBtn.addEventListener('click', toggleUserList);
}
if (sendJoinRequestBtn) sendJoinRequestBtn.addEventListener('click', sendJoinRequest);
if (requestOverlay && requestToggleBtn && closeRequestsBtn) {
    requestToggleBtn.addEventListener('click', () => {
        requestOverlay.classList.toggle('hidden');
        requestOverlay.classList.toggle('flex');
    });
    closeRequestsBtn.addEventListener('click', () => {
        requestOverlay.classList.add('hidden');
        requestOverlay.classList.remove('flex');
    });
}
if (connectionReloadBtn) connectionReloadBtn.addEventListener('click', () => window.location.reload());
if (connectionCancelBtn) connectionCancelBtn.addEventListener('click', () => {
    if (connectionLostModal) connectionLostModal.style.display = 'none';
    isUserLeaving = true;
    window.location.assign(`/chat/lobby/?username=${fixedUsername}`);
});

if (leaveRoomBtn) leaveRoomBtn.addEventListener('click', confirmAndLeave);

if (submitButtonDom) submitButtonDom.onclick = sendMessage;
if (deleteSelectedBtn) deleteSelectedBtn.onclick = deleteSelectedMessages;

// --- NEW: Join Call Button Listener ---
const joinCallBtn = document.getElementById('join-call-btn');
if (joinCallBtn) {
    joinCallBtn.addEventListener('click', () => {
        console.log(`Joining active call of type: ${window.activeCallType}`);
        if (window.activeCallType === 'video') {
            startVideoCall();
        } else if (window.activeCallType === 'voice') {
            startVoiceCall();
        }

        // Hide the bar immediately to prevent double-clicks
        const joinBar = document.getElementById('join-call-bar');
        if (joinBar) joinBar.classList.add('hidden');
    });
}

// --- FILE UPLOAD LISTENERS ---
if (attachmentBtn && fileInputDom) {
    // Label triggers the input click automatically via 'for="attachment-input"'
    
    fileInputDom.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Visual feedback
        attachmentBtn.style.color = '#4F46E5';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('username', fixedUsername);

        fetch(`/chat/room/${roomSlug}/upload/`, {
            method: 'POST',
            body: formData,
            // Header for CSRF is handled by csrf_exempt on view for now, 
            // but normally would include 'X-CSRFToken'
        })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    console.log('File uploaded successfully');
                } else {
                    Swal.fire('Upload Failed', data.error || 'Unknown error', 'error');
                }
            })
            .catch(err => {
                console.error('Upload Error:', err);
                Swal.fire('Upload Error', 'Failed to upload file.', 'error');
            })
            .finally(() => {
                fileInputDom.value = ''; // Reset input
                attachmentBtn.style.color = '#9CA3AF'; // Reset color
            });
    };
}

if (messageInputDom) {
    // Enter key sends message
    messageInputDom.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Input event for typing indicator AND mentions
    // We add 'keyup' as a fallback because some mobile keyboards don't fire 'input' reliably
    const handleInputOrKeyup = function (e) {
        // 1. Typing Indicator
        sendTypingStart();
        debouncedSendTypingStop();

        // 2. Mention Logic
        const cursorPosition = messageInputDom.selectionStart;
        const textBeforeCursor = messageInputDom.value.substring(0, cursorPosition);

        // Regex to match "@" followed by characters (username part) at the end of the string
        const match = textBeforeCursor.match(/(?:^|\s)@(\w*)$/);

        if (match) {
            const query = match[1].toLowerCase();
            // console.log("Mention match found, query:", query);

            // Use global window.availableParticipants
            const participants = window.availableParticipants || [];

            const matches = participants.filter(user =>
                user.toLowerCase().includes(query)
            );

            renderMentionSuggestions(matches, match[1]);
        } else {
            hideMentionSuggestions();
        }
    };

    messageInputDom.addEventListener('input', handleInputOrKeyup);
    messageInputDom.addEventListener('keyup', handleInputOrKeyup);

    // Hide suggestions on click outside
    document.addEventListener('click', (e) => {
        const suggestionsEl = document.getElementById('mention-suggestions');
        if (suggestionsEl && !suggestionsEl.classList.contains('hidden')) {
            if (!suggestionsEl.contains(e.target) && e.target !== messageInputDom) {
                hideMentionSuggestions();
            }
        }
    });
}

if (deleteForAllBtn) deleteForAllBtn.onclick = () => {
    if (deleteForAllBtn.style.display !== 'none') processDeletion('delete_for_all');
};

if (deleteForMeBtn) deleteForMeBtn.onclick = () => {
    processDeletion('delete_for_me');
};

if (deleteCancelBtn) deleteCancelBtn.onclick = () => {
    if (deleteModal) deleteModal.style.display = 'none';
};


// ADDED: Request Panel Outside Click Logic
document.addEventListener('mousedown', (e) => {
    // We use mousedown to catch the event before other focus events
    if (requestOverlay && !requestOverlay.classList.contains('hidden')) {
        const isClickInsidePanel = requestsPanel && requestsPanel.contains(e.target);
        const isClickOnToggleBtn = requestToggleBtn && requestToggleBtn.contains(e.target);

        if (!isClickInsidePanel && !isClickOnToggleBtn) {
            requestOverlay.classList.add('hidden');
            requestOverlay.classList.remove('flex');
        }
    }
});

if (messageInputDom) {
    messageInputDom.addEventListener('keydown', () => {
        if (emojiPickerPopover && !emojiPickerPopover.classList.contains('hidden')) {
            emojiPickerPopover.classList.add('hidden');
        }
    });
}

async function startVoiceCall() {
    console.log("Starting WebRTC Call...");
    try {
        // Initialize the connection object first (this also cleans up old connections)
        // Must await since createPeerConnection is now async (fetches TURN credentials)
        await createPeerConnection();

        // Get microphone access and store in global for cleanup
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Ensure tracks are added BEFORE createOffer
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Targeted Call Logic:
        // If we have selected participants, we send to them specifically.
        // Otherwise, it's a broadcast call to 'all'.
        const targets = selectedCallParticipants.size > 0 ? Array.from(selectedCallParticipants) : 'all';

        chatSocket.send(JSON.stringify({
            'type': 'webrtc_signal',
            'data': offer,
            'target_users': targets // Send either 'all' or an array of usernames
        }));

        console.log(`Call offer sent successfully! Targets: ${targets}`);

        // Clear selection after starting call
        selectedCallParticipants.clear();
        if (typeof updateUserListDisplay === 'function' && window.availableParticipants) {
            updateUserListDisplay(window.availableParticipants);
        }

        showCallInterface();
    } catch (err) {
        console.error("Could not start voice call:", err);
        Swal.fire('Call Error', 'Failed to start call. Please check microphone access.', 'error');
    }
}

/**
 * Start a VIDEO CALL with selected participants or everyone
 */
async function startVideoCall() {
    console.log("Starting WebRTC Video Call...");
    try {
        isVideoCall = true;

        // Get camera and microphone access
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

        // Determine targets
        const targets = selectedCallParticipants.size > 0
            ? Array.from(selectedCallParticipants)
            : window.availableParticipants
                ? window.availableParticipants.filter(u => u !== fixedUsername)
                : [];

        console.log("Video call targets:", targets);

        // For each target participant, create a peer connection and send offer
        for (const targetUser of targets) {
            console.log(`Creating video call connection for: ${targetUser}`);

            // Create video tile for this participant
            createVideoTile(targetUser);

            // Create peer connection for this participant
            const pc = await createPeerConnectionForUser(targetUser);

            // Create and send offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            chatSocket.send(JSON.stringify({
                'type': 'webrtc_signal',
                'data': offer,
                'target_users': [targetUser]
            }));

            console.log(`Sent video call offer to ${targetUser}`);
        }

        // Clear selection after starting call
        selectedCallParticipants.clear();
        if (typeof updateUserListDisplay === 'function' && window.availableParticipants) {
            updateUserListDisplay(window.availableParticipants);
        }

        // Update grid layout
        updateVideoGridLayout();
        updateParticipantCount();

        // Show video call interface
        showVideoCallInterface();

        displayMessage('System', '📹 Starting video call...', 'video-start-' + Date.now());

    } catch (err) {
        console.error("Could not start video call:", err);
        isVideoCall = false;
        Swal.fire('Video Call Error', 'Failed to start video call. Please check camera/microphone access.', 'error');
    }
}