// ===================================================================
// ROOM UI MANAGEMENT (room_ui.js)
// ===================================================================

const REACTION_MAP = {
    'like': '👍',
    'love': '❤️',
    'haha': '😂',
    'wow': '😮',
    'dislike': '👎'
};

let currentReplyId = null; // Track active reply


// Inject Reaction Styles removed and moved to input.css
(function injectReactionStyles() {
    // Moved to input.css
})();

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


// Updated signature to accept attachment data, reactions, and reply info
function displayMessage(sender, message, messageId, timestamp = null, suppressScroll = false, attachmentUrl = null, isImage = false, reactions = {}, replyTo = null) {
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
            if (event.target.closest('a') || event.target.closest('img')) {
                event.stopPropagation();
                if (event.target.closest('img')) {
                    // Optional: Open image modal
                }
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

    // --- REPLY CONTENT RENDERING ---
    if (replyTo) {
        const quoteDiv = document.createElement('div');
        quoteDiv.classList.add('reply-quote');
        quoteDiv.onclick = () => {
            const targetMsg = document.getElementById('msg-' + replyTo.message_id);
            if (targetMsg) {
                targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetMsg.classList.add('highlight-flash');
                setTimeout(() => targetMsg.classList.remove('highlight-flash'), 2000);
            }
        };

        const quoteSender = document.createElement('span');
        quoteSender.classList.add('reply-quote-sender');
        quoteSender.textContent = replyTo.sender;

        const quoteText = document.createElement('span');
        quoteText.classList.add('reply-quote-text');
        quoteText.textContent = replyTo.message;

        quoteDiv.appendChild(quoteSender);
        quoteDiv.appendChild(quoteText);
        messageBubble.appendChild(quoteDiv);
    }

    // --- ATTACHMENT RENDERING ---
    if (attachmentUrl) {
        const attachmentContainer = document.createElement('div');
        attachmentContainer.style.marginBottom = '0.5rem';

        if (isImage) {
            const img = document.createElement('img');
            img.src = attachmentUrl;
            img.style.maxWidth = '200px';
            img.style.maxHeight = '200px';
            img.style.borderRadius = '8px';
            img.style.cursor = 'pointer';
            img.onclick = () => window.open(attachmentUrl, '_blank');
            attachmentContainer.appendChild(img);
        } else {
            const link = document.createElement('a');
            link.href = attachmentUrl;
            link.target = '_blank';
            link.textContent = '📎 Download Attachment';
            link.style.color = isMe ? '#e0e7ff' : '#4f46e5';
            link.style.textDecoration = 'underline';
            attachmentContainer.appendChild(link);
        }
        messageBubble.appendChild(attachmentContainer);
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

            // --- MENTION PARSING ---
            // Find @username and wrap it in a span.
            // Check if the mentioned username matches the current user's username for special styling.
            linkedText = linkedText.replace(/@(\w+)/g, function (match, username) {
                if (username === fixedUsername) {
                    return `<span class="mention-me">@${username}</span>`;
                } else {
                    return `<span class="mention">@${username}</span>`;
                }
            });
            // -----------------------

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

        // --- ADD REACTION BUTTON ---
        const reactBtn = document.createElement('span');
        reactBtn.classList.add('add-reaction-btn');
        reactBtn.innerHTML = '<i class="far fa-smile"></i>'; // FontAwesome icon
        reactBtn.title = "Add Reaction";
        reactBtn.style.alignSelf = 'center';
        reactBtn.style.margin = '0 8px';
        reactBtn.onclick = (e) => {
            e.stopPropagation();
            toggleReactionPicker(messageId, messageBubble);
        };

        // --- ADD REPLY BUTTON ---
        const replyBtn = document.createElement('span');
        replyBtn.classList.add('reply-btn');
        replyBtn.innerHTML = '<i class="fas fa-reply"></i>'; // FontAwesome icon
        replyBtn.title = "Reply";
        replyBtn.style.alignSelf = 'center';
        replyBtn.onclick = (e) => {
            e.stopPropagation();
            startReply(messageId, sender, message);
        };

        // Append Reaction button next to timestamp
        messageBubble.appendChild(timeSpan);

        // Append elements to wrapper based on side
        // If Me: Button First (Left of Bubble)
        if (isMe) {
            messageWrapper.appendChild(replyBtn); // Reply Button far left
            messageWrapper.appendChild(reactBtn); // React Button
            messageWrapper.appendChild(messageBubble);
        } else {
            // If Other: Bubble First, then Button (Right of Bubble)
            messageWrapper.appendChild(messageBubble);
            messageWrapper.appendChild(reactBtn); // React Button
            messageWrapper.appendChild(replyBtn); // Reply Button far right (or swap order if desired)
        }
    } else {
        // System message just appends bubble
        messageWrapper.appendChild(messageBubble);
    }

    // --- REACTION CONTAINER ---
    const reactionContainer = document.createElement('div');
    reactionContainer.id = `reactions-${messageId}`;
    reactionContainer.classList.add('reaction-container');
    messageBubble.appendChild(reactionContainer);

    // Initial Render
    updateMessageReactions(messageId, reactions);

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
    if (typeof userListDrawer !== 'undefined' && userListDrawer) {
        userListDrawer.classList.toggle('is-open');
        document.body.classList.toggle('no-scroll');
    }
    // Safe check for drawerBackdrop from room_config.js
    if (typeof drawerBackdrop !== 'undefined' && drawerBackdrop) {
        drawerBackdrop.classList.toggle('hidden');
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
        li.classList.add('user-list-item-base');

        // Create a container for the username
        const usernameSpan = document.createElement('span');
        usernameSpan.textContent = user;
        usernameSpan.classList.add('participant-username');

        if (user === fixedUsername) {
            usernameSpan.textContent += ' (You)';
            li.classList.add('current-user-highlight');
            li.appendChild(usernameSpan);
        } else {
            // Other users are selectable for calls
            li.classList.add('selectable-participant');

            // Check if user was already selected
            if (selectedCallParticipants.has(user)) {
                li.classList.add('selected-for-call');
            }

            li.onclick = (e) => {
                // Don't toggle selection if clicking the remove button
                if (e.target.closest('.remove-participant-btn')) {
                    return;
                }

                const isSelected = li.classList.toggle('selected-for-call');
                if (isSelected) {
                    selectedCallParticipants.add(user);
                    console.log(`User ${user} selected for targeted call.`);
                } else {
                    selectedCallParticipants.delete(user);
                    console.log(`User ${user} deselected.`);
                }
            };

            li.appendChild(usernameSpan);

            // Add remove button if current user is the owner
            if (isOwner) {
                const removeBtn = document.createElement('button');
                removeBtn.classList.add('remove-participant-btn');
                removeBtn.innerHTML = '<i class="fas fa-times"></i>';
                removeBtn.title = `Remove ${user}`;
                removeBtn.onclick = (e) => {
                    e.stopPropagation(); // Prevent triggering the li click
                    removeParticipant(user);
                };
                li.appendChild(removeBtn);
            }
        }
        userListContainer.appendChild(li);
    });

    // --- UPDATE GLOBAL PARTICIPANTS LIST FOR MENTIONS ---
    window.availableParticipants = sortedUsers;
    console.log("Updated participants for mentions:", window.availableParticipants);
}

// Function to remove a participant (owner only)
function removeParticipant(username) {
    if (!isOwner) {
        console.error("Only the room owner can remove participants.");
        return;
    }

    Swal.fire({
        title: 'Remove Participant?',
        html: `Are you sure you want to remove <strong style="color: #EF4444;">${username}</strong> from the room?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#DC2626',
        cancelButtonColor: '#4B5563',
        confirmButtonText: 'Yes, Remove',
        cancelButtonText: 'Cancel',
        customClass: { container: 'mobile-alert-responsive-container' }
    }).then((result) => {
        if (result.isConfirmed) {
            // Send remove request to server
            if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
                chatSocket.send(JSON.stringify({
                    'type': 'remove_participant',
                    'target_username': username,
                    'sender': fixedUsername
                }));
                console.log(`Sent remove request for ${username}`);
            }
        }
    });
}

function updateDeleteButton() {
    const deleteBtn = document.querySelector('#delete-selected-btn');
    if (deleteBtn) {
        if (selectedMessageIds.length > 0) {
            deleteBtn.classList.remove('hidden');
            deleteBtn.style.display = 'block'; // Ensure it overrides any other hiding mechanisms
        } else {
            deleteBtn.classList.add('hidden');
            deleteBtn.style.display = 'none';
        }
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

function confirmAndLeave() {
    const redirectToLobby = (isExplicitLeave = false) => {
        isUserLeaving = true;
        disableExitPrevention();

        if (isExplicitLeave && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({ 'type': 'explicit_leave', 'sender': fixedUsername }));
        }

        setTimeout(() => {
            sessionStorage.setItem('user_left_room', 'true');
            const redirectUrl = `/chat/lobby/?username=${encodeURIComponent(fixedUsername)}`;
            window.location.replace(redirectUrl);
        }, 150);
    };

    const title = 'Leave Chat Room?';
    const htmlText = isOwner 
        ? 'You are about to leave the room. The room will remain active unless you delete it from the lobby.'
        : 'You will be disconnected from the chat and won\'t see previous messages when you rejoin.';

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
            redirectToLobby(true);
        }
    });
}

// --- NEW: MENTION LOGIC ---

function hideMentionSuggestions() {
    const suggestionsEl = document.getElementById('mention-suggestions');
    if (suggestionsEl) {
        suggestionsEl.classList.add('hidden');
        suggestionsEl.style.display = 'none !important'; // Force hide
        suggestionsEl.style.removeProperty('display'); // Or just remove the inline style to let class take over
        suggestionsEl.innerHTML = '';
    }
}

function renderMentionSuggestions(users, query) {
    const suggestionsEl = document.getElementById('mention-suggestions');
    if (!suggestionsEl) {
        console.error("Mention suggestion DOM element not found!");
        return;
    }

    // Clear previous
    suggestionsEl.innerHTML = '';

    if (users.length === 0) {
        hideMentionSuggestions();
        return;
    }

    // console.log("Rendering suggestions for:", users);

    users.forEach(user => {
        const item = document.createElement('div');
        item.classList.add('mention-item');

        // Avatar (initials)
        const avatar = document.createElement('div');
        avatar.classList.add('mention-avatar');
        avatar.textContent = user.charAt(0).toUpperCase();

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('mention-name');
        nameSpan.textContent = user;

        item.appendChild(avatar);
        item.appendChild(nameSpan);

        item.onclick = function () {
            selectMention(user, query);
        };

        suggestionsEl.appendChild(item);
    });

    // Explicitly set display to flex (or block) to override any hidden class issues
    suggestionsEl.classList.remove('hidden');
    suggestionsEl.style.display = 'flex';
    console.log("Suggestions rendered and displayed:", suggestionsEl);
}

function selectMention(username, query) {
    if (!messageInputDom) return;

    const cursorPosition = messageInputDom.selectionStart;
    const textBeforeCursor = messageInputDom.value.substring(0, cursorPosition);
    const textAfterCursor = messageInputDom.value.substring(cursorPosition);

    // Find the last '@'
    const lastAtPos = textBeforeCursor.lastIndexOf('@');

    // Construct new text
    // Replace text from lastAtPos up to cursor with "@username "
    const newTextBefore = textBeforeCursor.substring(0, lastAtPos) + `@${username} `;

    messageInputDom.value = newTextBefore + textAfterCursor;

    // Move cursor to end of inserted name
    const newCursorPos = newTextBefore.length;
    messageInputDom.setSelectionRange(newCursorPos, newCursorPos);
    messageInputDom.focus();

    messageInputDom.focus();
    messageInputDom.focus();
    hideMentionSuggestions();
}

function startReply(id, sender, content) {
    currentReplyId = id;
    const previewBar = document.getElementById('reply-preview-bar');
    const replySender = document.getElementById('reply-to-sender');
    const replyText = document.getElementById('reply-to-text');
    const cancelBtn = document.getElementById('cancel-reply-btn');

    if (previewBar) {
        replySender.textContent = sender;
        replyText.textContent = content;
        previewBar.classList.remove('hidden');

        if (messageInputDom) messageInputDom.focus();
    }
}

function cancelReply() {
    currentReplyId = null;
    const previewBar = document.getElementById('reply-preview-bar');
    const replySender = document.getElementById('reply-to-sender');
    const replyText = document.getElementById('reply-to-text');

    if (previewBar) {
        previewBar.classList.add('hidden');
    }
    if (replySender) replySender.textContent = '';
    if (replyText) replyText.textContent = '';
}

// Global Event Listener for Cancel Button
(function bindCancelButton() {
    const cancelBtn = document.getElementById('cancel-reply-btn');
    if (cancelBtn) {
        console.log("Binding Cancel Reply Button...");
        cancelBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log("Cancel Reply Clicked");
            cancelReply();
        };
    } else {
        console.warn("Cancel Reply Button not found in DOM during bind attempt.");
    }
})();

// --- MOBILE MENU INITIALIZATION ---
// The drawerBackdrop event listener is moved here to be safe
(function initMobileMenu() {
    if (typeof drawerBackdrop !== 'undefined' && drawerBackdrop) {
        drawerBackdrop.addEventListener('click', toggleUserList);
    }
})();

// --- EMOJI PICKER LOGIC ---
if (typeof emojiToggleBtn !== 'undefined' && emojiToggleBtn && typeof emojiPickerPopover !== 'undefined' && emojiPickerPopover) {
    emojiToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPickerPopover.classList.toggle('hidden');
        
        // Position the picker above the button
        const rect = emojiToggleBtn.getBoundingClientRect();
        emojiPickerPopover.style.bottom = `${window.innerHeight - rect.top + 10}px`;
        emojiPickerPopover.style.left = `${rect.left}px`;
    });
}

if (typeof emojiPickerElement !== 'undefined' && emojiPickerElement && typeof messageInputDom !== 'undefined' && messageInputDom) {
    emojiPickerElement.addEventListener('emoji-click', event => {
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
    if (typeof emojiPickerPopover !== 'undefined' && emojiPickerPopover && typeof emojiToggleBtn !== 'undefined' && emojiToggleBtn) {
        if (!emojiPickerPopover.contains(e.target) && !emojiToggleBtn.contains(e.target)) {
            emojiPickerPopover.classList.add('hidden');
        }
    }
});

// --- REACTION HELPERS ---

function toggleReactionPicker(messageId, bubbleElement) {
    // Check if picker already exists
    const existingPicker = bubbleElement.querySelector('.reaction-picker-popover');
    if (existingPicker) {
        existingPicker.remove();
        return;
    }

    // Close other pickers
    document.querySelectorAll('.reaction-picker-popover').forEach(el => el.remove());

    const picker = document.createElement('div');
    picker.classList.add('reaction-picker-popover');

    // Position depends on user (mine vs other)
    const isMine = bubbleElement.classList.contains('message-mine');
    picker.style.right = isMine ? '0' : 'auto';
    picker.style.left = isMine ? 'auto' : '0';

    Object.keys(REACTION_MAP).forEach(key => {
        const option = document.createElement('span');
        option.classList.add('reaction-option');
        option.textContent = REACTION_MAP[key];
        option.onclick = (e) => {
            e.stopPropagation();
            sendReaction(messageId, key);
            picker.remove();
        };
        picker.appendChild(option);
    });

    bubbleElement.appendChild(picker);

    // Auto-close on outside click (handled by global listener slightly or added here)
    const closeListener = (e) => {
        if (!picker.contains(e.target) && !bubbleElement.contains(e.target)) {
            picker.remove();
            document.removeEventListener('click', closeListener);
        }
    };
    // Delay adding listener to avoid immediate trigger
    setTimeout(() => document.addEventListener('click', closeListener), 0);
}

function updateMessageReactions(messageId, reactionsData) {
    const container = document.getElementById(`reactions-${messageId}`);
    if (!container) return;

    container.innerHTML = '';

    if (!reactionsData || Object.keys(reactionsData).length === 0) return;

    Object.keys(reactionsData).forEach(emojiKey => {
        const users = reactionsData[emojiKey];
        if (!users || users.length === 0) return;

        const emojiChar = REACTION_MAP[emojiKey] || emojiKey; // Fallback
        const count = users.length;
        const isMyReaction = users.includes(fixedUsername);

        const badge = document.createElement('div');
        badge.classList.add('reaction-badge');
        if (isMyReaction) badge.classList.add('my-reaction');

        badge.innerHTML = `${emojiChar} <span style="font-size: 0.75rem; font-weight: 600;">${count}</span>`;
        badge.title = users.join(', '); // Tooltip with usernames

        // Clicking badge also toggles/adds that reaction
        badge.onclick = (e) => {
            e.stopPropagation();
            sendReaction(messageId, emojiKey);
        };

        container.appendChild(badge);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const chatLog = document.getElementById('chat-log');
    const scrollBtn = document.getElementById('scroll-to-bottom-btn');

    const handleScroll = () => {
        // Mobile browsers sometimes have fractional scroll values
        const scrollPos = chatLog.scrollTop + chatLog.clientHeight;
        const totalHeight = chatLog.scrollHeight;

        // If user is more than 200px away from the bottom, show button
        if (totalHeight - scrollPos > 200) {
            scrollBtn.classList.add('show');
        } else {
            scrollBtn.classList.remove('show');
        }
    };

    // Use a passive listener for better scroll performance on mobile
    chatLog.addEventListener('scroll', handleScroll, { passive: true });

    scrollBtn.addEventListener('click', () => {
        chatLog.scrollTo({
            top: chatLog.scrollHeight,
            behavior: 'smooth'
        });
    });

    // Special: Hide button when keyboard opens to prevent UI clutter
    const inputField = document.getElementById('chat-message-input');
    inputField.addEventListener('focus', () => {
        // Optional: Hide button when typing to save screen space
        scrollBtn.classList.remove('show');
    });
});
