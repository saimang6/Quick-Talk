/**
 * room_gif.js - Handles GIPHY integration and GIF picking functionality
 */

(function () {
    // --- CONFIGURATION ---
    const GIPHY_API_KEY = 'duF7OdkZqhmAZom9sWNQcZPiOfCNDZ5c'; 
    const GIPHY_SEARCH_ENDPOINT = 'https://api.giphy.com/v1/gifs/search';
    const GIPHY_TRENDING_ENDPOINT = 'https://api.giphy.com/v1/gifs/trending';

    // --- DOM ELEMENTS ---
    let gifToggleBtn, gifPickerContainer, gifSearchInput, gifResults;

    function init() {
        gifToggleBtn = document.getElementById('gif-toggle-btn');
        gifPickerContainer = document.getElementById('gif-picker-container');
        gifSearchInput = document.getElementById('gif-search-input');
        gifResults = document.getElementById('gif-results');

        if (!gifToggleBtn || !gifPickerContainer) {
            console.warn("GIF Picker elements not found. Retrying in 500ms...");
            setTimeout(init, 500);
            return;
        }

        console.log("GIF Picker initialized.");

        // --- EVENT LISTENERS ---
        gifToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGifPicker();
        });

        if (gifSearchInput) {
            let searchTimeout = null;
            gifSearchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
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
            if (gifPickerContainer && !gifPickerContainer.classList.contains('hidden')) {
                // Also check if we clicked the emoji toggle button (to let its own listener handle it)
                const isEmojiToggle = emojiToggleBtn && emojiToggleBtn.contains(e.target);
                if (!gifPickerContainer.contains(e.target) && !gifToggleBtn.contains(e.target) && !isEmojiToggle) {
                    hideGifPicker();
                }
            }
        });
    }

    // --- FUNCTIONS ---

    function toggleGifPicker() {
        if (gifPickerContainer.classList.contains('hidden')) {
            // Close emoji picker if open
            if (typeof emojiPickerPopover !== 'undefined' && emojiPickerPopover) {
                emojiPickerPopover.classList.add('hidden');
            }
            showGifPicker();
        } else {
            hideGifPicker();
        }
    }

    function showGifPicker() {
        console.log("Opening GIF Picker...");
        
        // Position the picker above the button
        if (gifToggleBtn && gifPickerContainer) {
            const rect = gifToggleBtn.getBoundingClientRect();
            // Calculate position relative to viewport
            const bottomPos = window.innerHeight - rect.top + 12;
            const leftPos = Math.min(rect.left, window.innerWidth - 340); 
            
            gifPickerContainer.style.bottom = `${bottomPos}px`;
            gifPickerContainer.style.left = `${Math.max(20, leftPos)}px`; 
        }

        gifPickerContainer.classList.remove('hidden');
        gifPickerContainer.style.display = 'flex';
        gifPickerContainer.style.opacity = '1';
        
        if (gifToggleBtn) {
            gifToggleBtn.classList.add('text-indigo-400');
        }

        // Load trending GIFs if search is empty
        if (gifResults && gifResults.children.length === 0) {
            loadTrendingGIFs();
        }
        
        if (gifSearchInput) {
            setTimeout(() => gifSearchInput.focus(), 100);
        }
    }

    function hideGifPicker() {
        console.log("Hiding GIF Picker...");
        if (gifPickerContainer) {
            gifPickerContainer.classList.add('hidden');
            gifPickerContainer.style.display = 'none';
        }
        if (gifToggleBtn) {
            gifToggleBtn.classList.remove('text-indigo-400');
        }
    }

    async function searchGIFs(query) {
        try {
            if (gifResults) gifResults.innerHTML = '<div class="no-results"><i class="fas fa-spinner animate-spin"></i> Searching...</div>';
            const response = await fetch(`${GIPHY_SEARCH_ENDPOINT}?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=20&rating=g`);
            const data = await response.json();
            renderGIFs(data.data);
        } catch (error) {
            console.error('Error fetching GIFs:', error);
            if (gifResults) gifResults.innerHTML = '<p class="error">Failed to load GIFs.</p>';
        }
    }

    async function loadTrendingGIFs() {
        try {
            if (gifResults) gifResults.innerHTML = '<div class="no-results"><i class="fas fa-spinner animate-spin"></i> Loading...</div>';
            const response = await fetch(`${GIPHY_TRENDING_ENDPOINT}?api_key=${GIPHY_API_KEY}&limit=20&rating=g`);
            const data = await response.json();
            renderGIFs(data.data);
        } catch (error) {
            console.error('Error fetching trending GIFs:', error);
            if (gifResults) gifResults.innerHTML = '<p class="error">Failed to load trending GIFs.</p>';
        }
    }

    function renderGIFs(gifs) {
        if (!gifResults) return;
        gifResults.innerHTML = '';

        if (!gifs || gifs.length === 0) {
            gifResults.innerHTML = '<p class="no-results">No GIFs found.</p>';
            return;
        }

        gifs.forEach(gif => {
            const img = document.createElement('img');
            img.src = gif.images.fixed_height.url;
            img.className = 'gif-item';
            img.alt = gif.title;
            img.loading = 'lazy';

            img.addEventListener('click', (e) => {
                e.stopPropagation();
                sendGIF(gif.images.original.url);
                hideGifPicker();
            });

            gifResults.appendChild(img);
        });
    }

    function sendGIF(url) {
        if (typeof chatSocket !== 'undefined' && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({
                'type': 'message',
                'message': '', 
                'attachment_url': url,
                'is_image': true,
                'sender': typeof fixedUsername !== 'undefined' ? fixedUsername : 'Anonymous'
            }));
        } else {
            console.warn('chatSocket not found or not open. GIF could not be sent.');
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // --- EXPOSE GLOBALLY ---
    window.searchGIFsByTerm = (term) => {
        if (gifPickerContainer && gifPickerContainer.classList.contains('hidden')) {
            showGifPicker();
        }
        if (gifSearchInput) {
            gifSearchInput.value = term;
            searchGIFs(term);
        }
    };
})();
