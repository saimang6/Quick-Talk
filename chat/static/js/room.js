// ===================================================================
// CHAT ROOM LOGIC (room.js)
// Now includes immediate room deletion command for owner exit.
// ===================================================================

// --- CONFIGURATION AND DATA CONTEXT ---
const fixedUsername = JSON.parse(document.getElementById('user-name').textContent);
const creatorUsernameContext = JSON.parse(document.getElementById('creator-username').textContent);
const roomSlug = JSON.parse(document.getElementById('room-slug').textContent);
const isOwner = JSON.parse(document.getElementById('is-owner').textContent);

// --- DOM ELEMENT SELECTION ---
const messageInputDom = document.querySelector('#chat-message-input');
const submitButtonDom = document.querySelector('#chat-message-submit');
const chatLogDom = document.querySelector('#chat-log');
const deleteSelectedBtn = document.querySelector('#delete-selected-btn');
const leaveRoomBtn = document.querySelector('#leave-room-btn');

// Header Display
const roomNameDisplay = document.querySelector('#room-name-display');
const creatorUsernameDisplay = document.querySelector('#creator-username-display');
const currentUsernameSpan = document.querySelector('#current-username-span');
const userCountSpan = document.querySelector('#user-count');
const typingIndicatorDom = document.querySelector('#typing-indicator');

// User List and Mobile Menu Elements
const hamburgerMenuBtn = document.querySelector('#hamburger-menu-btn');
const userListDrawer = document.querySelector('#user-list-drawer');
const userListContainer = document.querySelector('#user-list-container');

// Modal Elements (Deletion Modals)
const deleteModal = document.querySelector('#delete-modal');
const messageCountSpan = document.querySelector('#message-count');
const deleteForAllBtn = document.querySelector('#delete-for-all-btn');
const deleteForMeBtn = document.querySelector('#delete-for-me-btn');
const deleteCancelBtn = document.querySelector('#delete-cancel-btn');

// Connection Lost Modals
const connectionLostModal = document.querySelector('#connection-lost-modal');
const connectionReloadBtn = document.querySelector('#connection-reload-btn');
const connectionCancelBtn = document.querySelector('#connection-cancel-btn');

// Request/Access Elements
const sendJoinRequestBtn = document.querySelector('#send-join-request-btn');
const requestOverlay = document.querySelector('#request-overlay');
const overlayStatusMessage = document.querySelector('#overlay-status-message');
const denialMessageDisplay = document.querySelector('#denial-message-display');
const mainChatContainer = document.querySelector('.main-chat-container');

const requestsPanel = document.getElementById('requests-panel');
const requestCountSpan = document.getElementById('request-count');
const requestToggleBtn = document.getElementById('request-display-toggle');
const pendingRequestsContainer = document.getElementById('pending-requests-container');
const bellIconDom = document.querySelector('#request-display-toggle .fas.fa-bell');
const creatorInfoContainer = document.querySelector('#creator-info');
const emojiToggleBtn = document.getElementById('emoji-toggle-btn');
const pickerContainer = document.getElementById('emoji-picker-container');
const emojiPicker = pickerContainer ? pickerContainer.querySelector('emoji-picker') : null; // Safely select emoji picker

// --- STATE VARIABLES ---
let selectedMessageIds = [];
let messageOwnership = {};
let isUserLeaving = false;
let chatSocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let isReceivingHistory = false;
let isTyping = false;
let isAccessGranted = isOwner;
let isPendingUser = false;
let typingUsers = new Set();
let isAwaitingServerSync = false;
let isFatalError = false; // Flag to halt generic reconnect/load processes
let pickerOpen = false;

// Initial state checks
const accessKey = `access_granted_${roomSlug}`;
const hasStoredAccess = sessionStorage.getItem(accessKey) === 'true';

if (document.getElementById('is-requester')) {
    // If template says pending, but storage says accessible, trust storage (reload case)
    let templatePending = JSON.parse(document.getElementById('is-requester').textContent);
    isPendingUser = hasStoredAccess ? false : templatePending;
} else {
    const urlParams = new URLSearchParams(window.location.search);
    let urlPending = urlParams.get('request') === 'true';
    isPendingUser = (!isOwner && urlPending && !hasStoredAccess);
}

// Ensure access granted state matches
if (!isOwner && !isPendingUser) {
    isAccessGranted = true;
}

// Initial UI setup
currentUsernameSpan.textContent = fixedUsername;
if (isOwner) updateRequestPanelContent();

if (creatorInfoContainer) {
    if (isOwner) {
        // Show the info if the current user is the owner
        creatorInfoContainer.style.display = 'block'; // Or 'flex', depending on your CSS
    } else {
        // Hide the info if the current user is not the owner
        creatorInfoContainer.style.display = 'none';
    }
}

// --- UTILITY FUNCTIONS ---

/**
 * Fallback UUID generator (V4-like) for browsers that do not support crypto.randomUUID().
 * @returns {string} A universally unique identifier.
 */
function generateUUID() {
    let d = new Date().getTime();
    let d2 = (performance && performance.now && (performance.now() * 1000)) || 0;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        let r = Math.random() * 16;
        if (d > 0) {
            r = (d + r) % 16 | 0;
            d = Math.floor(d / 16);
        } else {
            r = (d2 + r) % 16 | 0;
            d2 = Math.floor(d2 / 16);
        }
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

/**
 * Formats a given timestamp (Date object or string) into a short time string.
 * Returns 'Time unknown' if the timestamp is invalid.
 * @param {Date|string|null} timestamp - The message timestamp.
 * @returns {string} Formatted time string or error message.
 */
function formatTimestamp(timestamp) {
    // If no timestamp is provided, return the current time (e.g., for system notices)
    if (!timestamp) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    try {
        const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
        // The core check: if new Date() failed to parse the input, getTime() returns NaN
        if (isNaN(date.getTime())) return 'Time unknown';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return 'Time unknown';
    }
}

function getParticipantCountValue() {
    const count = parseInt(userCountSpan.textContent.trim(), 10);
    return isNaN(count) ? 1 : count;
}

/**
 * Replaces URLs in a string with anchor tags, opening in a new window.
 * @param {string} text
 * @returns {string} HTML string with clickable links.
 */
function linkify(text) {
    const urlRegex = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,6}\b)/ig;

    return text.replace(urlRegex, function (url) {
        let href = url;
        if (url.toLowerCase().startsWith('www.')) {
            href = 'http://' + url;
        }

        const maxDisplayLength = 60;
        let displayText = url;

        if (url.length > maxDisplayLength) {
            const startLength = 35;
            const endLength = 20;

            const start = url.substring(0, startLength);
            const end = url.substring(url.length - endLength);

            displayText = `${start}...${end}`;
        }

        return `<a href="${href}" target="_blank" rel="noopener noreferrer" 
                   class="full-link"
                   title="${url}">${displayText}</a>`;
    });
}

/**
 * Attempts to create an HTML element for embedding a known service (like YouTube).
 * @param {string} message - The raw message text.
 * @returns {{content: string, isEmbed: boolean}}
 */
function embedLink(message) {
    const youtubePattern = /(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}(?:\S*))$/i;
    const linkMatch = message.trim().match(youtubePattern);

    if (linkMatch) {
        const fullLink = linkMatch[0];
        const remainingText = message.trim().replace(fullLink, '').trim();

        if (remainingText.length === 0) {

            const previewCard = `
                <a href="${fullLink}" target="_blank" rel="noopener noreferrer" 
                   class="full-link block mt-2 mb-1 p-3 bg-gray-700 rounded-lg shadow-md hover:bg-gray-600 transition duration-150">
                    
                    <div class="font-bold text-sm text-red-400">
                        YouTube Link
                    </div>
                
                    <div class="text-xs text-gray-300 truncate mt-1">
                        ${fullLink}
                    </div>
                </a>
            `;

            return { content: previewCard, isEmbed: true };
        }
    }

    return { content: message, isEmbed: false };
}

/**
 * The standard browser event handler to trigger an exit confirmation prompt.
 * This should run on every page load to prevent accidental exits.
 * @param {Event} event - The browser's beforeunload event.
 */
function confirmExitHandler(event) {
    // Check if the user is not leaving. 
    // We removed the chatSocket state check to ensure the confirmation appears 
    // even if the socket is reconnecting, lost, or not yet initialized (e.g., on page reload).
    if (!isUserLeaving) {
        // NOTE: Modern browsers ignore the custom string and display a generic message.
        const message = "Are you sure you want to leave the chat room? Your current session will end.";
        (event || window.event).returnValue = message;
        return message;
    }
}

function enableExitPrevention() {
    window.addEventListener('beforeunload', confirmExitHandler);
    console.log("Exit prevention enabled 2.");
}

function disableExitPrevention() {
    window.removeEventListener('beforeunload', confirmExitHandler);
    console.log("Exit prevention disabled.");
}

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

// ===================================================================
// NETWORKING LOGIC
// ===================================================================

const debouncedSendTypingStop = debounce(sendTypingStop, 1500);

function connectWebSocket() {
    if (isFatalError) {
        console.log("Fatal error detected (Secret Check/Access Denial). Halting WebSocket connection attempt.");
        return;
    }

    if (isPendingUser) {
        if (mainChatContainer) mainChatContainer.style.display = 'none';
        if (requestOverlay) requestOverlay.style.display = 'flex';
    } else {
        if (mainChatContainer) mainChatContainer.style.display = 'flex';
        if (requestOverlay) requestOverlay.style.display = 'none';
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
    chatSocket.onclose = handleSocketClose;
    chatSocket.onerror = handleSocketError;
}

function handleSocketOpen() {
    reconnectAttempts = 0;
    if (isOwner || !isPendingUser) {
        // Send a session active status after the connection is confirmed OPEN
        sendStatusUpdate('session_active');
    }

    // Reinforce the back button trap once the connection (and potentially page interaction) is established
    engageBackTrap();

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
            }).then(() => {
                sessionStorage.removeItem(`access_granted_${roomSlug}`); // Clear access on failure
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
                sessionStorage.removeItem(`access_granted_${roomSlug}`); // Clear access on failure
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
    chatSocket.send(JSON.stringify({
        'type': 'message',
        'sender': sender,
        'message': message,
        'message_id': generateUUID()
    }));

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

function deleteSelectedMessages() {
    if (selectedMessageIds.length === 0 || !deleteModal) return;

    const allMine = selectedMessageIds.every(id => messageOwnership[id] === fixedUsername);

    if (deleteForAllBtn) deleteForAllBtn.style.display = allMine ? 'inline-flex' : 'none';
    if (messageCountSpan) messageCountSpan.textContent = selectedMessageIds.length;

    const modalTitle = document.querySelector('#modal-title');
    const modalBodyText = document.querySelector('#modal-body-text');

    if (modalTitle) modalTitle.textContent = allMine ?
        `Delete ${selectedMessageIds.length} of Your Message(s)` :
        `Delete ${selectedMessageIds.length} Message(s)`;

    if (modalBodyText) modalBodyText.textContent = allMine ?
        'All selected messages are yours. Choose how you want to delete them.' :
        'Some selected messages belong to others. You can only "Delete for Me Only".';

    deleteModal.style.display = 'flex';
}

function processDeletion(choiceType) {
    if (selectedMessageIds.length === 0 || !chatSocket || chatSocket.readyState !== WebSocket.OPEN) return;

    chatSocket.send(JSON.stringify({
        'type': choiceType,
        'sender': fixedUsername,
        'message_ids': selectedMessageIds
    }));

    document.querySelectorAll('.message-selected').forEach(el => el.classList.remove('message-selected'));
    selectedMessageIds = [];
    updateDeleteButton();
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


// ===================================================================
// MESSAGE RECEIVING HANDLER
// ===================================================================

function handleSocketMessage(e) {
    const data = JSON.parse(e.data);

    switch (data.type) {

        case 'access_granted':
            if (!isOwner) {
                // Persist access for reloads
                sessionStorage.setItem(`access_granted_${roomSlug}`, 'true');

                if (!isAccessGranted && isPendingUser) {
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
            if (!isOwner) {
                // Clear any stored access
                sessionStorage.removeItem(`access_granted_${roomSlug}`);

                if (isPendingUser || isAccessGranted) { // Also handle if they were previously granted
                    isAccessGranted = false;
                    isAwaitingServerSync = false;
                    isPendingUser = false; // Effectively leaving
                    if (overlayStatusMessage) overlayStatusMessage.textContent = "Access Denied.";
                    if (denialMessageDisplay) denialMessageDisplay.style.display = 'block';
                    if (sendJoinRequestBtn) sendJoinRequestBtn.style.display = 'none';

                    // Force UI switch back to overlay if they were viewing chat
                    if (mainChatContainer) mainChatContainer.style.display = 'none';
                    if (requestOverlay) requestOverlay.style.display = 'flex';

                    setTimeout(() => {
                        isUserLeaving = true;
                        window.location.assign(`/chat/lobby/?username=${fixedUsername}`);
                    }, 3000);
                }
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

        case 'message':
            if (isAwaitingServerSync) {
                isAccessGranted = true;
                isAwaitingServerSync = false;
            }
            // data.timestamp is correctly passed here
            displayMessage(data.sender, data.message, data.message_id, data.timestamp);
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

        default:
            console.warn('Unknown message type received:', data.type);
    }
}


// ===================================================================
// UI RENDERING & MANAGEMENT
// ===================================================================

function displayMessage(sender, message, messageId, timestamp = null, suppressScroll = false) {
    // Safety check for critical DOM element
    if (!chatLogDom) return;

    const isSystemMessage = sender.startsWith('System') || sender === 'System';
    const isMe = sender === fixedUsername;

    if (!isSystemMessage) messageOwnership[messageId] = sender;
    if (document.getElementById('msg-' + messageId)) return;

    const messageWrapper = document.createElement('div');
    messageWrapper.id = 'msg-' + messageId;

    // UI Classes and styles setup...
    messageWrapper.style.display = 'flex';
    messageWrapper.style.marginBottom = '1rem';
    messageWrapper.classList.add(isSystemMessage ? 'system-message-wrapper' : 'message-wrapper');
    if (!isSystemMessage) {
        messageWrapper.style.justifyContent = isMe ? 'flex-end' : 'flex-start';

        messageWrapper.onclick = function (event) {
            if (event.target.closest('a')) {
                event.stopPropagation();
                return;
            }

            if (messageOwnership[messageId] !== fixedUsername) return;
            const index = selectedMessageIds.indexOf(messageId);
            if (index > -1) {
                selectedMessageIds.splice(index, 1);
                messageWrapper.classList.remove('message-selected');
            } else {
                selectedMessageIds.push(messageId);
                messageWrapper.classList.add('message-selected');
            }
            updateDeleteButton();
        };
    }

    const messageBubble = document.createElement('div');
    messageBubble.classList.add(isSystemMessage ? 'system-message-bubble' : 'message-bubble');
    if (!isSystemMessage) messageBubble.classList.add(isMe ? 'message-mine' : 'message-other');

    if (!isSystemMessage && !isMe) {
        const senderSpan = document.createElement('span');
        senderSpan.classList.add('message-sender');
        senderSpan.textContent = sender;
        messageBubble.appendChild(senderSpan);
    }

    // --- LINK/EMBED/FORMATTING LOGIC ---
    let contentHtml = '';

    if (isSystemMessage) {
        contentHtml = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    } else {
        const embedResult = embedLink(message);

        if (embedResult.isEmbed) {
            contentHtml = embedResult.content;
        } else {
            let linkedText = linkify(message);
            contentHtml = linkedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        }
    }
    // --- END LOGIC ---

    const content = document.createElement('p');
    content.innerHTML = contentHtml;

    // Optimization for embeds: remove the default <p> element spacing
    if (contentHtml.trim().startsWith('<a href') && contentHtml.includes('block mt-2 mb-1 p-3')) {
        content.style.margin = '0';
        content.style.padding = '0';
    }

    messageBubble.appendChild(content);


    if (!isSystemMessage) {
        const timeSpan = document.createElement('span');
        timeSpan.classList.add('message-timestamp');
        // FIX CONFIRMED: Using the actual timestamp variable passed to the function
        timeSpan.textContent = formatTimestamp(timestamp);
        messageBubble.appendChild(timeSpan);
    }

    messageWrapper.appendChild(messageBubble);
    chatLogDom.appendChild(messageWrapper);

    if (!suppressScroll && !isReceivingHistory) {
        chatLogDom.scrollTop = chatLogDom.scrollHeight;
    }
}

function updateTypingIndicator(users) {
    if (!typingIndicatorDom) return;

    const othersTyping = users.filter(user => user !== fixedUsername);

    if (othersTyping.length === 0) {
        typingIndicatorDom.innerHTML = '';
        typingIndicatorDom.classList.add('hidden');
    } else {
        typingIndicatorDom.classList.remove('hidden');
        let indicatorText = '';
        if (othersTyping.length === 1) {
            indicatorText = `<span class="font-semibold text-white">${othersTyping[0]}</span> is typing...`;
        } else if (othersTyping.length === 2) {
            indicatorText = `<span class="font-semibold text-white">${othersTyping[0]}</span> and <span class="font-semibold text-white">${othersTyping[1]}</span> are typing...`;
        } else {
            const firstTwo = othersTyping.slice(0, 2).join(', ');
            indicatorText = `<span class="font-semibold text-white">${firstTwo}</span> and ${othersTyping.length - 2} others are typing...`;
        }

        const dotsHTML = `<div class="typing-indicator-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
        typingIndicatorDom.innerHTML = indicatorText + dotsHTML;
    }
}

function toggleUserList() {
    if (userListDrawer) {
        userListDrawer.classList.toggle('is-open');
        document.body.classList.toggle('no-scroll');
    }
}

function updateUserListDisplay(users) {
    if (!userListContainer) return;

    const otherUsers = users.filter(user => user !== fixedUsername);
    const currentUser = users.find(user => user === fixedUsername);
    otherUsers.sort((a, b) => a.localeCompare(b));
    const sortedUsers = currentUser ? [currentUser, ...otherUsers] : otherUsers;

    userListContainer.innerHTML = '';

    sortedUsers.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user;
        li.classList.add('user-list-item-base');

        if (user === fixedUsername) {
            li.textContent += ' (You)';
            li.classList.add('current-user-highlight');
        }
        userListContainer.appendChild(li);
    });
}

function updateDeleteButton() {
    const deleteBtn = document.querySelector('#delete-selected-btn');
    if (deleteBtn) {
        deleteBtn.style.display = selectedMessageIds.length > 0 ? 'block' : 'none';
    }
}

function handleMessageDeletion(messageIds) {
    messageIds.forEach(id => {
        const msgElement = document.getElementById('msg-' + id);
        if (msgElement) {
            msgElement.remove();
            if (messageOwnership) delete messageOwnership[id];
            if (selectedMessageIds) {
                const selectedIndex = selectedMessageIds.indexOf(id);
                if (selectedIndex > -1) selectedMessageIds.splice(selectedIndex, 1);
            }
        }
    });
    updateDeleteButton();
    if (deleteModal) deleteModal.style.display = 'none';
}

function updateBellIconColor(count) {
    if (!bellIconDom) return;
    const numericCount = parseInt(count);

    if (numericCount > 0) {
        bellIconDom.classList.add('notification-active');
    } else {
        bellIconDom.classList.remove('notification-active');
    }
}

function updateRequestPanelContent() {
    if (!isOwner || !pendingRequestsContainer) return;

    const noRequestsMessage = pendingRequestsContainer.querySelector('.no-requests-message');
    if (noRequestsMessage) noRequestsMessage.remove();

    if (parseInt(requestCountSpan.textContent) === 0 && pendingRequestsContainer.children.length === 0) {
        pendingRequestsContainer.innerHTML = '<p class="no-requests-message" style="color: #9CA3AF; padding: 10px; text-align: center;">No Requests...</p>';
    }
}

function displayRequestCard(requester, updateCount = true) {
    const requestId = 'req-' + requester;
    if (document.getElementById(requestId)) return;

    const noRequestsMessage = pendingRequestsContainer.querySelector('.no-requests-message');
    if (noRequestsMessage) noRequestsMessage.remove();

    const requestWrapper = document.createElement('div');
    requestWrapper.id = requestId;
    requestWrapper.classList.add('request-card-wrapper', 'system-message-wrapper');

    const card = document.createElement('div');
    card.classList.add('request-card-bubble', 'system-message-bubble');

    const messageP = document.createElement('p');
    messageP.classList.add('request-message-text');
    messageP.innerHTML = `**${requester}** is requesting to join.`;

    const buttonGroup = document.createElement('div');
    buttonGroup.classList.add('request-button-group');

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept';
    acceptBtn.classList.add('request-accept-btn');
    acceptBtn.onclick = () => sendApprovalDecision('accept', requester);

    const denyBtn = document.createElement('button');
    denyBtn.textContent = 'Deny';
    denyBtn.classList.add('request-deny-btn');
    denyBtn.onclick = () => sendApprovalDecision('deny', requester);

    buttonGroup.appendChild(acceptBtn);
    buttonGroup.appendChild(denyBtn);
    card.appendChild(messageP);
    card.appendChild(buttonGroup);
    requestWrapper.appendChild(card);

    pendingRequestsContainer.appendChild(requestWrapper);

    if (updateCount) {
        const currentCount = parseInt(requestCountSpan.textContent);
        requestCountSpan.textContent = currentCount + 1;
        updateBellIconColor(currentCount + 1);
    }
}

// --- USER ACTIONS (SENDING/DELETION) ---

function confirmAndLeave() {
    const participantCount = getParticipantCountValue();
    const redirectToLobby = () => {
        isUserLeaving = true;
        // --- FIX 2B: Clear the unload handler before navigating ---
        disableExitPrevention();

        if (chatSocket) chatSocket.close();
        sessionStorage.setItem('user_left_room', 'true');
        const redirectUrl = `/chat/lobby/?username=${fixedUsername}`;
        // history.replaceState(null, '', redirectUrl);
        window.location.replace(redirectUrl);
    };

    // 1. Owner Check Logic (Block leaving if others present)
    if (isOwner && participantCount > 1) {
        Swal.fire({
            title: 'Cannot Leave Room!',
            html: `
                <p class="text-lg">You cannot leave while <strong style="color: #FBBF24;">${participantCount - 1} other participant(s)</strong> are still active!</p>
                <p class="text-sm mt-3" style="color: #9CA3AF;">Please wait for all other participants to leave before you exit the room and close the session.</p>
            `,
            icon: 'warning',
            customClass: { container: 'mobile-alert-responsive-container' },
            confirmButtonText: 'Stay in Room',
            confirmButtonColor: '#4F46E5'
        });
        return;
    }

    // 2. Owner is last person: Offer delete options
    if (isOwner && participantCount <= 1) {
        Swal.fire({
            title: 'Confirm Exit and Close Room',
            html: 'You may leave the room now.<br> <strong class="text-red-400">Select "Leave and Delete Room".</strong>',
            icon: 'warning',
            customClass: { container: 'mobile-alert-responsive-container' },
            showCancelButton: true,
            showDenyButton: false,

            // Button Colors
            confirmButtonColor: '#DC2626', // Red for immediate Delete
            // denyButtonColor: '#4B5563',
            cancelButtonColor: '#4B5563',

            // Button Texts
            confirmButtonText: 'Yes, Leave and Delete Room', // Deletes immediately via WS
            // denyButtonText: 'Stay in Room',
            cancelButtonText: 'Stay in Room'
        }).then((result) => {
            if (result.isConfirmed) {
                // ACTION: Send DELETE command via WebSocket immediately, then redirect.
                sendDeleteRoom();
                redirectToLobby();
            } else if (result.isDenied) {
                // ACTION: Standard exit without deletion signal
                redirectToLobby();
            }
            // If cancelled, do nothing
        });

    } else {
        // 3. Non-Owner logic
        const title = 'Are you sure you want to leave?';
        const htmlText = 'You will be disconnected from the chat. You will not be able to view previous messages when you rejoin.';

        Swal.fire({
            title: title,
            html: htmlText,
            icon: 'warning',
            customClass: { container: 'mobile-alert-responsive-container' },
            showCancelButton: true,
            confirmButtonColor: '#DC2626',
            cancelButtonColor: '#4B5563',
            confirmButtonText: 'Yes, Leave Room',
            cancelButtonText: 'Stay in Room'
        }).then((result) => {
            if (result.isConfirmed) {
                redirectToLobby();
            }
        });
    }
}

// --- INITIALIZATION AND EVENT LISTENERS ---
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
if (hamburgerMenuBtn) hamburgerMenuBtn.addEventListener('click', toggleUserList);
if (sendJoinRequestBtn) sendJoinRequestBtn.addEventListener('click', sendJoinRequest);
if (requestsPanel && requestToggleBtn) {
    requestToggleBtn.addEventListener('click', () => requestsPanel.classList.toggle('hidden-panel'));
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

if (messageInputDom) {
    // Enter key sends message
    messageInputDom.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Input event for typing indicator
    messageInputDom.addEventListener('input', function () {
        sendTypingStart();
        debouncedSendTypingStop();
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

// Emoji Picker Logic
if (emojiToggleBtn) emojiToggleBtn.addEventListener('click', () => {
    pickerOpen = !pickerOpen;
    pickerContainer.classList.toggle('open', pickerOpen);
});

if (emojiPicker && messageInputDom) {
    emojiPicker.addEventListener('emoji-click', event => {
        const emoji = event.detail.emoji.unicode;

        const start = messageInputDom.selectionStart;
        const end = messageInputDom.selectionEnd;

        const value = messageInputDom.value;
        messageInputDom.value = value.substring(0, start) + emoji + value.substring(end);

        messageInputDom.selectionStart = messageInputDom.selectionEnd = start + emoji.length;

        messageInputDom.focus();
    });
}

document.addEventListener('click', (e) => {
    const isClickInside = (pickerContainer && pickerContainer.contains(e.target)) || (emojiToggleBtn && emojiToggleBtn.contains(e.target));

    if (pickerOpen && !isClickInside) {
        pickerContainer.classList.remove('open');
        pickerOpen = false;
    }
});

if (messageInputDom) {
    messageInputDom.addEventListener('keydown', () => {
        if (pickerOpen) {
            pickerContainer.classList.remove('open');
            pickerOpen = false;
        }
    });
}