// ===================================================================
// ROOM UTILITIES (room_utils.js)
// ===================================================================

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

        // Updated truncation logic: "Show first few letters with....."
        const maxDisplayLength = 30; // Shorter limit
        let displayText = url;

        if (url.length > maxDisplayLength) {
            displayText = url.substring(0, maxDisplayLength - 5) + '.....';
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
    // REVERTED: User requested to remove the card/embed and just show a clickable link.
    // We return isEmbed: false so that the main UI logic falls back to 'linkify()' 
    // which renders a standard <a> tag.
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
