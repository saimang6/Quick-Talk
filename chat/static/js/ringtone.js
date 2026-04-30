// ===================================================================
// RINGTONE MANAGER
// ===================================================================
// Creates and manages a ringtone for incoming voice/video calls

class RingtoneManager {
    constructor() {
        this.audioContext = null;
        this.oscillator = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.audioElement = null; // Alternative: HTML5 Audio element
    }

    /**
     * Initializes the audio context (required for Web Audio API)
     */
    init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    /**
     * Plays a ringtone using Web Audio API
     * Creates a pleasant dual-tone ringtone pattern
     */
    async playWebAudioRingtone() {
        if (this.isPlaying) return;

        this.init();

        // CRITICAL: Resume AudioContext if suspended (browser autoplay policy)
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('🔊 AudioContext resumed from suspended state');
            } catch (error) {
                console.error('Failed to resume AudioContext:', error);
                return;
            }
        }

        this.isPlaying = true;

        // Create a repeating pattern
        const playTone = () => {
            if (!this.isPlaying) return;

            // Create two oscillators for a richer sound
            const osc1 = this.audioContext.createOscillator();
            const osc2 = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            // Configure frequencies (pleasant dual-tone)
            osc1.frequency.value = 800; // First tone (E5)
            osc2.frequency.value = 1000; // Second tone (B5)

            // Configure volume
            gainNode.gain.value = 0.3; // Increased to 30% volume for better audibility

            // Connect oscillators through gain to output
            osc1.connect(gainNode);
            osc2.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            // Start oscillators
            osc1.start();
            osc2.start();

            // First tone duration: 400ms
            setTimeout(() => {
                osc1.stop();
                osc2.stop();

                // Pause for 200ms, then play again
                if (this.isPlaying) {
                    setTimeout(playTone, 200);
                }
            }, 400);
        };

        playTone();
    }

    /**
     * Plays a simple HTML5 audio ringtone
     * This is an alternative method that uses a looping audio file
     */
    playAudioElement() {
        if (this.isPlaying) return;

        // Check if we have a ringtone file
        const audioPath = '/static/audio/ringtone.mp3';

        if (!this.audioElement) {
            this.audioElement = new Audio(audioPath);
            this.audioElement.loop = true;
            this.audioElement.volume = 0.3; // 30% volume
        }

        this.isPlaying = true;

        // Try to play, with fallback to Web Audio API if file doesn't exist
        this.audioElement.play().catch((error) => {
            console.warn('Audio file not found, using Web Audio API instead:', error);
            this.playWebAudioRingtone();
        });
    }

    /**
     * Plays the ringtone (tries audio file first, falls back to Web Audio API)
     */
    async play() {
        if (this.isPlaying) {
            console.log('Ringtone is already playing');
            return;
        }

        console.log('🔔 Playing ringtone...');

        // Try HTML5 audio first (if you have a ringtone file)
        // Otherwise use Web Audio API
        await this.playWebAudioRingtone();
    }

    /**
     * Stops the ringtone
     */
    stop() {
        if (!this.isPlaying) return;

        console.log('🔕 Stopping ringtone...');
        this.isPlaying = false;

        // Stop HTML5 audio if it's being used
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
        }

        // Clean up Web Audio API oscillators (they auto-stop when isPlaying becomes false)
    }

    /**
     * Checks if the ringtone is currently playing
     */
    isRinging() {
        return this.isPlaying;
    }
}

// Create a global ringtone manager instance
window.ringtoneManager = new RingtoneManager();

// ===================================================================
// AUDIO UNLOCK - Initialize AudioContext on first user interaction
// ===================================================================
// This is CRITICAL for bypassing browser autoplay policies.
// Without this, the AudioContext will remain suspended even if we try
// to resume it later, because it needs an initial user gesture.

(function unlockAudio() {
    let isUnlocked = false;

    const unlock = async () => {
        if (isUnlocked) return;

        try {
            // Initialize the AudioContext
            window.ringtoneManager.init();

            // Resume if suspended
            if (window.ringtoneManager.audioContext.state === 'suspended') {
                await window.ringtoneManager.audioContext.resume();
            }

            isUnlocked = true;
            console.log('✅ Audio unlocked! AudioContext state:', window.ringtoneManager.audioContext.state);

            // Remove the event listeners once unlocked
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
            document.removeEventListener('keydown', unlock);
        } catch (error) {
            console.warn('Failed to unlock audio:', error);
        }
    };

    // Listen for any user interaction to unlock audio
    document.addEventListener('click', unlock, { passive: true });
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });

    console.log('🎵 Audio unlock listeners registered. Click/tap anywhere to enable ringtone.');
})();
