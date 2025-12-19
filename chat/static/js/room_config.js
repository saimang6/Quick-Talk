// ===================================================================
// ROOM CONFIGURATION AND GLOBAL STATE (room_config.js)
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
const fileInputDom = document.querySelector('#file-input');
const attachmentBtn = document.querySelector('#attachment-btn');
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
const closeRequestsBtn = document.getElementById('close-requests-btn');
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

// Ensure global accessibility
window.availableParticipants = [];

// --- MENTION DOM ---
const mentionSuggestionsDom = document.querySelector('#mention-suggestions');

// Initial state checks
if (document.getElementById('is-requester')) {
    isPendingUser = JSON.parse(document.getElementById('is-requester').textContent);
} else {
    const urlParams = new URLSearchParams(window.location.search);
    // Check if URL has request arg OR just force pending for all non-owners (as per latest requirement)
    // We force pending because backend forces pending on connect.
    isPendingUser = !isOwner;
}

// Initial UI setup
currentUsernameSpan.textContent = fixedUsername;
if (isOwner && typeof updateRequestPanelContent === 'function') updateRequestPanelContent(); // Will be defined later, safe to skip here

if (creatorInfoContainer) {
    if (isOwner) {
        // Show the info if the current user is the owner
        creatorInfoContainer.style.display = 'block'; // Or 'flex', depending on your CSS
    } else {
        // Hide the info if the current user is not the owner
        creatorInfoContainer.style.display = 'none';
    }
}
