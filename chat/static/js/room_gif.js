/**
 * room_gif.js - Handles GIPHY integration and GIF picking functionality
 */

(function () {
    // --- CONFIGURATION ---
    const GIPHY_API_KEY = 'duF7OdkZqhmAZom9sWNQcZPiOfCNDZ5c'; 
    const GIPHY_SEARCH_ENDPOINT = 'https://api.giphy.com/v1/gifs/search';
    const GIPHY_TRENDING_ENDPOINT = 'https://api.giphy.com/v1/gifs/trending';

    // --- DOM ELEMENTS ---
    const gifToggleBtn = document.getElementById('gif-toggle-btn');
    const gifPickerContainer = document.getElementById('gif-picker-container');
    const gifSearchInput = document.getElementById('gif-search-input');
    const gifResults = document.getElementById('gif-results');
    
    // Global elements from room_config.js
    // emojiToggleBtn, emojiPickerPopover, pickerOpen

    let searchTimeout = null;

    // --- INITIALIZATION ---
    if (gifToggleBtn) {
        gifToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGifPicker();
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
        if (gifPickerContainer && !gifPickerContainer.classList.contains('hidden')) {
            if (!gifPickerContainer.contains(e.target) && (!gifToggleBtn || !gifToggleBtn.contains(e.target))) {
                hideGifPicker();
            }
        }
    });

    // --- FUNCTIONS ---

    function toggleGifPicker() {
        if (gifPickerContainer.classList.contains('hidden')) {
            showGifPicker();
        } else {
            hideGifPicker();
        }
    }

    function showGifPicker() {
        console.log("Showing GIF Picker...");
        
        // Position the picker above the button
        if (gifToggleBtn && gifPickerContainer) {
            const rect = gifToggleBtn.getBoundingClientRect();
            // Calculate position
            const bottomPos = window.innerHeight - rect.top + 10;
            const leftPos = Math.min(rect.left, window.innerWidth - 340); // Prevent overflow on right
            
            gifPickerContainer.style.bottom = `${bottomPos}px`;
            gifPickerContainer.style.left = `${Math.max(20, leftPos)}px`; // Prevent overflow on left
        }

        gifPickerContainer.classList.remove('hidden');
        gifPickerContainer.style.display = 'flex';
        if (gifToggleBtn) {
            gifToggleBtn.classList.add('active');
            gifToggleBtn.classList.add('text-indigo-400');
        }

        // Load trending GIFs if search is empty
        if (gifSearchInput && !gifSearchInput.value.trim()) {
            loadTrendingGIFs();
        }
        
        if (gifSearchInput) gifSearchInput.focus();
    }

    function hideGifPicker() {
        console.log("Hiding GIF Picker...");
        if (gifPickerContainer) {
            gifPickerContainer.classList.add('hidden');
            gifPickerContainer.style.display = 'none';
        }
        if (gifToggleBtn) {
            gifToggleBtn.classList.remove('active');
            gifToggleBtn.classList.remove('text-indigo-400');
        }
    }

    async function searchGIFs(query) {
        try {
            gifResults.innerHTML = '<div class="no-results"><i class="fas fa-spinner animate-spin"></i> Searching...</div>';
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
        // Use the existing chatSocket if available
        if (typeof chatSocket !== 'undefined' && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
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
        if (gifPickerContainer && gifPickerContainer.classList.contains('hidden')) {
            showGifPicker();
        }
        if (gifSearchInput) {
            gifSearchInput.value = term;
            searchGIFs(term);
        }
    };

})();
