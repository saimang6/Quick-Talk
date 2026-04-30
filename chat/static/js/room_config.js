// ===================================================================
// ROOM CONFIGURATION AND GLOBAL STATE (room_config.js)
// ===================================================================

// --- CONFIGURATION AND DATA CONTEXT ---
var fixedUsername = JSON.parse(document.getElementById('user-name').textContent);
var creatorUsernameContext = JSON.parse(document.getElementById('creator-username').textContent);
var roomSlug = JSON.parse(document.getElementById('room-slug').textContent);
var isOwner = JSON.parse(document.getElementById('is-owner').textContent);

// --- DOM ELEMENT SELECTION ---
var messageInputDom = document.querySelector('#chat-message-input');
var submitButtonDom = document.querySelector('#chat-message-submit');
var chatLogDom = document.querySelector('#chat-log');
var fileInputDom = document.querySelector('#file-input');
var attachmentBtn = document.querySelector('#attachment-btn');
var deleteSelectedBtn = document.querySelector('#delete-selected-btn');
var leaveRoomBtn = document.querySelector('#leave-room-btn');

// Header Display
var roomNameDisplay = document.querySelector('#room-name-display');
var creatorUsernameDisplay = document.querySelector('#creator-username-display');
var currentUsernameSpan = document.querySelector('#current-username-span');
var userCountSpan = document.querySelector('#user-count');
var typingIndicatorDom = document.querySelector('#typing-indicator');

// User List and Mobile Menu Elements
var hamburgerMenuBtn = document.querySelector('#hamburger-menu-btn');
var userListDrawer = document.querySelector('#user-list-drawer');
var userListContainer = document.querySelector('#user-list-container');
var drawerBackdrop = document.querySelector('#drawer-backdrop');

// Modal Elements (Deletion Modals)
var deleteModal = document.querySelector('#delete-modal');
var messageCountSpan = document.querySelector('#message-count');
var deleteForAllBtn = document.querySelector('#delete-for-all-btn');
var deleteForMeBtn = document.querySelector('#delete-for-me-btn');
var deleteCancelBtn = document.querySelector('#delete-cancel-btn');

// Connection Lost Modals
var connectionLostModal = document.querySelector('#connection-lost-modal');
var connectionReloadBtn = document.querySelector('#connection-reload-btn');
var connectionCancelBtn = document.querySelector('#connection-cancel-btn');

// Request/Access Elements
var sendJoinRequestBtn = document.querySelector('#send-join-request-btn');
var requestOverlay = document.querySelector('#request-overlay');
var overlayStatusMessage = document.querySelector('#overlay-status-message');
var denialMessageDisplay = document.querySelector('#denial-message-display');
var mainChatContainer = document.querySelector('.main-chat-container');

var requestsPanel = document.getElementById('requests-panel');
var closeRequestsBtn = document.getElementById('close-requests-btn');
var requestCountSpan = document.getElementById('request-count');
var requestToggleBtn = document.getElementById('request-display-toggle');
var pendingRequestsContainer = document.getElementById('pending-requests-container');
var bellIconDom = document.querySelector('#request-display-toggle .fas.fa-bell');
var creatorInfoContainer = document.querySelector('#creator-info');
var currentUserDisplay = document.querySelector('#current-user-display');
var emojiToggleBtn = document.getElementById('emoji-toggle-btn');
var emojiPickerPopover = document.getElementById('emoji-picker-popover');
var emojiPickerElement = document.querySelector('emoji-picker');
var pickerContainer = document.getElementById('emoji-picker-container');
var emojiPicker = pickerContainer ? pickerContainer.querySelector('emoji-picker') : null; // Safely select emoji picker

// --- STATE VARIABLES ---
var selectedMessageIds = [];
var messageOwnership = {};
var isUserLeaving = false;
var chatSocket = null;
var reconnectAttempts = 0;
var MAX_RECONNECT_ATTEMPTS = 5;
var isReceivingHistory = false;
var isTyping = false;
var isAccessGranted = isOwner;
var isPendingUser = false;
var typingUsers = new Set();
var isAwaitingServerSync = false;
var isFatalError = false; // Flag to halt generic reconnect/load processes
var pickerOpen = false;
var selectedCallParticipants = new Set();

// Ensure global accessibility
window.availableParticipants = [];

// --- MENTION DOM ---
var mentionSuggestionsDom = document.querySelector('#mention-suggestions');

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
if (currentUsernameSpan && typeof fixedUsername !== 'undefined') {
    currentUsernameSpan.textContent = fixedUsername;
}

if (typeof isOwner !== 'undefined' && isOwner && typeof updateRequestPanelContent === 'function') {
    updateRequestPanelContent(); 
}

if (creatorInfoContainer) {
    if (typeof isOwner !== 'undefined' && isOwner) {
        // Show the info if the current user is the owner
        creatorInfoContainer.style.display = 'block'; 
    } else {
        // Hide the info if the current user is not the owner
        creatorInfoContainer.style.display = 'none';
        if (currentUserDisplay) currentUserDisplay.style.marginTop = '23px';
    }
}
