/**
 * room_gif.js - Handles GIPHY integration and GIF picking functionality
 */

(function () {
    // --- CONFIGURATION ---
    const GIPHY_API_KEY = 'duF7OdkZqhmAZom9sWNQcZPiOfCNDZ5c'; // User should replace this
    const GIPHY_SEARCH_ENDPOINT = 'https://api.giphy.com/v1/gifs/search';
    const GIPHY_TRENDING_ENDPOINT = 'https://api.giphy.com/v1/gifs/trending';

    // --- DOM ELEMENTS ---
    const gifToggleBtn = document.getElementById('gif-toggle-btn');
    const gifPickerContainer = document.getElementById('gif-picker-container');
    const gifSearchInput = document.getElementById('gif-search-input');
    const gifResults = document.getElementById('gif-results');
    const closeGifPicker = document.getElementById('close-gif-picker');
    const emojiToggleBtn = document.getElementById('emoji-toggle-btn');
    const emojiPickerContainer = document.getElementById('emoji-picker-container');

    let isGifPickerOpen = false;
    let searchTimeout = null;

    // --- INITIALIZATION ---
    if (gifToggleBtn) {
        gifToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGifPicker();
        });
    }

    if (closeGifPicker) {
        closeGifPicker.addEventListener('click', () => {
            hideGifPicker();
        });
    }

    if (gifSearchInput) {
        gifSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();

            // Debounce search
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (query.length > 0) {
                    searchGIFs(query);
                } else {
                    loadTrendingGIFs();
                }
            }, 500);
        });
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (isGifPickerOpen && !gifPickerContainer.contains(e.target) && e.target !== gifToggleBtn) {
            hideGifPicker();
        }
    });

    // --- FUNCTIONS ---

    function toggleGifPicker() {
        if (isGifPickerOpen) {
            hideGifPicker();
        } else {
            showGifPicker();
        }
    }

    function showGifPicker() {
        // Close emoji picker if open
        if (typeof pickerOpen !== 'undefined' && pickerOpen) {
            emojiToggleBtn.click();
        } else if (emojiPickerContainer && emojiPickerContainer.classList.contains('open')) {
            emojiPickerContainer.classList.remove('open');
        }

        gifPickerContainer.classList.remove('hidden');
        gifToggleBtn.classList.add('active');
        isGifPickerOpen = true;

        // Load trending GIFs if search is empty
        if (!gifSearchInput.value.trim()) {
            loadTrendingGIFs();
        }
    }

    function hideGifPicker() {
        gifPickerContainer.classList.add('hidden');
        gifToggleBtn.classList.remove('active');
        isGifPickerOpen = false;
    }

    async function searchGIFs(query) {
        try {
            const response = await fetch(`${GIPHY_SEARCH_ENDPOINT}?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=20&rating=g`);
            const data = await response.json();
            renderGIFs(data.data);
        } catch (error) {
            console.error('Error fetching GIFs:', error);
            gifResults.innerHTML = '<p class="error">Failed to load GIFs.</p>';
        }
    }

    async function loadTrendingGIFs() {
        try {
            const response = await fetch(`${GIPHY_TRENDING_ENDPOINT}?api_key=${GIPHY_API_KEY}&limit=20&rating=g`);
            const data = await response.json();
            renderGIFs(data.data);
        } catch (error) {
            console.error('Error fetching trending GIFs:', error);
            gifResults.innerHTML = '<p class="error">Failed to load trending GIFs.</p>';
        }
    }

    function renderGIFs(gifs) {
        gifResults.innerHTML = '';

        if (gifs.length === 0) {
            gifResults.innerHTML = '<p class="no-results">No GIFs found.</p>';
            return;
        }

        gifs.forEach(gif => {
            const img = document.createElement('img');
            img.src = gif.images.fixed_height.url;
            img.className = 'gif-item';
            img.alt = gif.title;
            img.loading = 'lazy';

            img.addEventListener('click', () => {
                sendGIF(gif.images.original.url);
                hideGifPicker();
            });

            gifResults.appendChild(img);
        });
    }

    function sendGIF(url) {
        // Use the existing chatSocket if available
        if (typeof chatSocket !== 'undefined' && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({
                'type': 'message',
                'message': '', // Empty message for GIF-only
                'attachment_url': url,
                'is_image': true,
                'sender': typeof fixedUsername !== 'undefined' ? fixedUsername : 'Anonymous'
            }));
        } else {
            console.warn('chatSocket not found or not open. GIF could not be sent.');
        }
    }
    // --- EXPOSE GLOBALLY ---
    window.searchGIFsByTerm = (term) => {
        if (!isGifPickerOpen) {
            showGifPicker();
        }
        gifSearchInput.value = term;
        searchGIFs(term);
    };

})();
