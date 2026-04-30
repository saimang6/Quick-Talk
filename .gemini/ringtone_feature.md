# Ringtone Feature Implementation

## Overview
Added a ringtone notification system that plays when users receive incoming voice or video calls, helping participants know when someone is calling them.

## What was added:

### 1. **RingtoneManager Class** (`/chat/static/js/ringtone.js`)
   - A reusable JavaScript class that manages ringtone playback
   - Uses **Web Audio API** to generate pleasant dual-tone ringtones (800Hz + 1000Hz)
   - Plays a repeating pattern: 400ms tone, 200ms pause
   - Volume set to 15% to be noticeable but not jarring
   - Fallback support for custom audio files (if you want to add a custom ringtone MP3)
   - Global instance: `window.ringtoneManager`

### 2. **Integration Points** (`/chat/static/js/room_socket.js`)

#### When ringtone **starts playing**:
   - `showCallInterface(true)` - Incoming voice call
   - `showVideoCallInterface(true)` - Incoming video call

#### When ringtone **stops playing**:
   - User accepts the call (`acceptCall()`, `acceptVideoCall()`)
   - User denies the call (`denyCall()`, `denyVideoCall()`)
   - Call interface is hidden (`hideCallInterface()`, `hideVideoCallInterface()`)
   - Call transitions from incoming to ongoing state

### 3. **Template Update** (`/chat/templates/chat/room.html`)
   - Added `<script src="{% static 'js/ringtone.js' %}"></script>` before other room scripts
   - This ensures the RingtoneManager is available when the socket code runs

## How it works:

1. **User A initiates a call** → sends WebRTC offer to User B
2. **User B receives the offer** → `handleIncomingCall()` is triggered
3. **System shows call UI** → `showCallInterface(true)` or `showVideoCallInterface(true)`
4. **🔔 Ringtone starts playing** automatically
5. **User B accepts/denies** → ringtone stops immediately
6. **If call times out or is cancelled** → ringtone stops when interface closes

## Technical Details:

- **No audio files required** - Uses Web Audio API to synthesize tones
- **Browser-compatible** - Works in all modern browsers
- **Non-blocking** - Ringtone plays asynchronously
- **Graceful degradation** - If audio fails, no errors occur
- **Resource-efficient** - Clean start/stop mechanism prevents memory leaks

## Future Enhancements (Optional):

If you want to customize the ringtone:
1. Add a custom ringtone file to `/chat/static/audio/ringtone.mp3`
2. The system will automatically try to use it (with Web Audio API as fallback)
3. You can also modify the frequencies in `ringtone.js` to change the tone

## Testing:

To test this feature:
1. Open the chat room in two different browsers/tabs
2. One user clicks the Voice Call or Video Call button
3. The other user should hear a ringtone
4. Accept or deny the call - the ringtone should stop immediately
