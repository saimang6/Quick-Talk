import json
import logging
from channels.generic.websocket import WebsocketConsumer
from asgiref.sync import async_to_sync
import uuid 
import urllib.parse
from django.utils import timezone 
from .models import Room, Message, Reaction 

# --- CONFIGURATION ---
MAX_INITIAL_MESSAGES = 100 
logger = logging.getLogger(__name__)

class ChatConsumer(WebsocketConsumer):
    
    # --- CLASS-LEVEL STATE TRACKING ---
    # { 'room_slug': { 'username': 'channel_name' } } 
    ROOM_USERS = {} # ACTIVE, APPROVED USERS ONLY
    USER_LAST_SEEN = {} # { 'room_slug': { 'username': timestamp } } 
    ROOM_TYPERS = {}
    # { 'room_slug': 'owner_channel_name' } - Maps slug directly to owner's channel
    ROOM_OWNER_CHANNELS = {} 
    # { 'room_slug': { 'requester_username': 'channel_name' } }
    ROOM_REQUESTERS = {} # PENDING USERS ONLY
    # { 'room_slug': set([username1, username2]) }
    ROOM_ACTIVE_CONNECTIONS = {} # TRACKS ACTUAL OPEN SOCKETS
    # { 'room_slug': set([username1, username2]) }
    ROOM_CALL_PARTICIPANTS = {} # TRACKS USERS ACTIVELY IN A VOICE/VIDEO CALL
    # { 'room_slug': 'video' or 'voice' }
    ROOM_CALL_STATE = {} # TRACKS THE TYPE OF THE CURRENT ACTIVE CALL
    # ----------------------------------------
    
    def connect(self):
        try:
            self.room_slug = self.scope['url_route']['kwargs']['room_slug'] 
            self.room_group_name = 'chat_%s' % self.room_slug
            self.room_instance = None 
            
            # Extract Username and is_request flag from Query Parameters
            query_params = self.scope['query_string'].decode()
            parsed_qs = urllib.parse.parse_qs(query_params)
            self.username = parsed_qs.get('username', ['Anonymous'])[0]
            logger.warning(
                "WebSocket connect start room=%s user=%s query=%s",
                self.room_slug,
                self.username,
                query_params,
            )
            
            # Check if the connection URL contains the request flag (meaning user is a requester)
            is_request_join = parsed_qs.get('request', ['false'])[0] == 'true'
            # Flags for owner access
            is_owner_access_attempt = parsed_qs.get('owner_access', ['false'])[0] == 'true'
            submitted_secret = parsed_qs.get('secret', [''])[0]

            # --- Room Existence Check ---
            is_new_room = 'new' in parsed_qs
            if is_new_room:
                new_room_name = parsed_qs.get('name', [''])[0]
                owner_username = parsed_qs.get('owner_username', [''])[0] or self.username 
                # Get secret from parsed_qs
                new_room_secret = parsed_qs.get('secret', [''])[0]

                if not Room.objects.filter(slug=self.room_slug).exists():
                    self.room_instance = Room.objects.create(
                        name=new_room_name,
                        slug=self.room_slug,
                        owner_username=owner_username,
                        secret_number=new_room_secret
                    )
            
            if not self.room_instance:
                self.room_instance = Room.objects.get(slug=self.room_slug)
            
            # Verify ownership via session OR provided secret
            session_secret = self.scope.get('session', {}).get(f'room_secret_{self.room_slug}')
            
            self.is_owner = (self.room_instance.owner_username == self.username) and (
                self.room_instance.secret_number == submitted_secret or 
                self.room_instance.secret_number == session_secret
            )

            # === START FIX: Ensure proper close code transmission ===
            if (self.room_instance.owner_username == self.username) and is_owner_access_attempt:
                # Check 1: If the user has the owner's name and is trying to access as owner, 
                # but failed the secret check (both submitted and session)
                if not self.is_owner:
                    
                    # CRITICAL FIX: Accept connection first to transmit custom close code
                    self.accept() 

                    # Send a client-side message (optional, but good)
                    self.send(text_data=json.dumps({
                        'type': 'auth_failure', 
                        'code': 'secret_mismatch',
                        'message': 'Secret number incorrect. Closing connection.'
                    }))
                    
                    # DENY ACCESS - Close the connection with a specific code (4005)
                    self.close(code=4005) 
                    print(f"Owner impersonation attempt by {self.username} failed due to secret mismatch.")
                    return
                # If the secret matches, the user is confirmed as the owner.
            
            elif is_owner_access_attempt and not self.is_owner:
                # Check 2: If a NON-OWNER tries to use the owner_access flag 
                
                # CRITICAL FIX: Accept connection first to transmit custom close code
                self.accept() 
                
                self.close(code=4006)
                print(f"Non-owner {self.username} attempted illegal owner access.")
                return

            # Check 3: If the user has the OWNER's USERNAME but didn't provide a secret.
            if (self.username == self.room_instance.owner_username) and (not self.is_owner) and (not is_owner_access_attempt):
                is_request_join = True 
            # ======================================================================

            # === FINAL ACCEPT FOR SUCCESSFUL CONNECTION PATH ===
            # Accept connection immediately (This is the only remaining accept() call for success)
            self.accept()
            logger.warning(
                "WebSocket accepted room=%s user=%s owner=%s pending_check_start",
                self.room_slug,
                self.username,
                self.is_owner,
            )
            
            self.send(text_data=json.dumps({
                'type': 'room_info',
                'room_name': self.room_instance.name,
                'creator_username': self.room_instance.owner_username,
            }))
        
            # ------------------------------------------------------------------
        # Initialize nested dictionaries if they don't exist
        self.ROOM_USERS.setdefault(self.room_slug, {})
        self.ROOM_TYPERS.setdefault(self.room_slug, set())
        self.ROOM_REQUESTERS.setdefault(self.room_slug, {})
        self.ROOM_ACTIVE_CONNECTIONS.setdefault(self.room_slug, set())
        self.ROOM_CALL_PARTICIPANTS.setdefault(self.room_slug, set())

        # Mark this user as ACTIVELY CONNECTED
        self.ROOM_ACTIVE_CONNECTIONS[self.room_slug].add(self.username)
        
        # Initialize last seen for this room if not exists
        self.USER_LAST_SEEN.setdefault(self.room_slug, {})
        
        # --- CRITICAL FIX: Determine initial pending state ---
        # 1. First, check if the client URL indicates a join request.
        is_request_attempt = is_request_join and not self.is_owner
        
        # 2. Check the persistent list (DB) to see if the user was accepted/denied while offline.
        persistent_requesters = self._get_persistent_requesters()
        is_still_pending_in_db = self.username in persistent_requesters
        
        # For simplicity and safety, we only mark them as pending if the URL flag is set.
        # UPDATE: User wants re-request on every connection/reload.
        # REVISED (Soft Reconnect): If user is currently active in the room (e.g. just tab switched),
        # allow them to rejoin without pending status.
        is_active_in_room = self.username in self.ROOM_USERS.get(self.room_slug, {})
        
        self.is_pending = not self.is_owner and not is_active_in_room
        # ----------------------------------------------------------------------
        
        # Determine if this is truly a timeout (was active in this room before)
        is_returning_to_room = self.username in self.USER_LAST_SEEN.get(self.room_slug, {})
        
        # --- NEW CONNECTION LOGIC: PENDING VS ACTIVE ---
        
        if self.is_pending:
            # PENDING LOGIC (This runs for ANY new join request, and on reconnect if they haven't been approved yet)
            
            # 1. Notify the client immediately that they are in pending state
            # This is crucial for users returning after a timeout who assume they are still active.
            self.send(text_data=json.dumps({
                'type': 'session_status',
                'status': 'pending', 
                'reason': 'timeout' if is_returning_to_room and not is_new_room and not is_request_join else 'new_join'
            }))
            
            # 1. PENDING: Only track their channel for direct messages (approval/denial)
            self.ROOM_REQUESTERS[self.room_slug][self.username] = self.channel_name
            
            # 2. DO NOT add them to the main room group (chat group)
            # 3. DO NOT add them to the ROOM_USERS list (participant panel)
            print(f"User {self.username} connected and is marked as PENDING.")

            # Note: The 'join_request' message (which triggers persistence) is sent by the client after connect. 
            # We don't send the notification here unless they are already in the DB.
            if is_still_pending_in_db:
                 owner_channel = self.ROOM_OWNER_CHANNELS.get(self.room_slug)
                 if owner_channel:
                     async_to_sync(self.channel_layer.send)(
                         owner_channel,
                         {
                             'type': 'join_request_notification',
                             'requester_username': self.username,
                         }
                     )
        else:
            # ACTIVE/OWNER LOGIC
            
            # 0. Notify client of active status
            self.send(text_data=json.dumps({
                'type': 'session_status',
                'status': 'active'
            }))

            # 1. Add user's channel to the main Channel Layer Group
            print(f"Adding user {self.username} to group {self.room_group_name}...")
            async_to_sync(self.channel_layer.group_add)(
                self.room_group_name,
                self.channel_name
            )
            print(f"User {self.username} successfully added to group.")

            # 2. Add user to the ROOM_USERS list (for participant display)
            user_joined = self.username not in self.ROOM_USERS.get(self.room_slug, {}) 
            self.ROOM_USERS[self.room_slug][self.username] = self.channel_name 
            
            # 3. Handle Owner Tracking
            if self.is_owner:
                self.ROOM_OWNER_CHANNELS[self.room_slug] = self.channel_name
            
            # 4. Execute Join Logic (Update last seen)
            if user_joined:
                self.USER_LAST_SEEN[self.room_slug][self.username] = timezone.now()
                self.send_system_message(f"{self.username} has joined the room.")
                
            # 5. Broadcast the updated user list
            self.broadcast_user_list(send_join_message=False)
            
            # --- REMOVED OVER-EAGER ACCESS GRANTED ---
            # We no longer assume that "not in pending list" means "approved".
            # This prevents denied users from re-entering automatically.
            # If they were approved while offline, they'll be in ROOM_USERS on reconnect
            # or they can just wait for a new approval.
        
        # 7. Always Sync the request count for the owner on connect
            if self.is_owner:
                self.broadcast_request_count_to_owner() 
            
        # 8. CLEANUP STALE USERS (New Logic)
        # Check for users who disconnected > 2.5 minutes ago and haven't returned.
        # This handles users who closed the tab but didn't trigger 'explicit_leave' 
        # (e.g., browser crash or just closed tab on mobile)
            self.cleanup_stale_users()
        
        # --- CATCH-UP LOGIC START ---
        # Only send history to users who are ACTIVE
            if not self.is_pending:
                last_seen_time = self.USER_LAST_SEEN.get(self.room_slug, {}).get(self.username)
                if last_seen_time:
                     self.send_catch_up_messages(last_seen_time)
            logger.warning(
                "WebSocket connect complete room=%s user=%s pending=%s active_users=%s",
                self.room_slug,
                self.username,
                self.is_pending,
                list(self.ROOM_USERS.get(self.room_slug, {}).keys()),
            )
            # ------------------------------------------------------------------
        except Room.DoesNotExist:
            logger.warning("WebSocket room missing room=%s user=%s", getattr(self, "room_slug", "?"), getattr(self, "username", "?"))
            self.close(code=4004)
            return
        except Exception:
            logger.exception(
                "WebSocket connect crashed room=%s user=%s",
                getattr(self, "room_slug", "?"),
                getattr(self, "username", "?"),
            )
            self.close(code=1011)
            return

    def disconnect(self, close_code):
        if self.room_slug in self.USER_LAST_SEEN:
            self.USER_LAST_SEEN[self.room_slug][self.username] = timezone.now()
        
        # Remove from ACTIVE CONNECTIONS (Current socket is dead)
        if self.room_slug in self.ROOM_ACTIVE_CONNECTIONS:
            self.ROOM_ACTIVE_CONNECTIONS[self.room_slug].discard(self.username)

        # If the user was pending, they were never added to the group, but this is safe
        async_to_sync(self.channel_layer.group_discard)(
            self.room_group_name,
            self.channel_name
        )
        
        # 2. Remove owner tracking if the disconnecting user is the owner
        if self.is_owner and self.room_slug in self.ROOM_OWNER_CHANNELS and self.ROOM_OWNER_CHANNELS[self.room_slug] == self.channel_name:
            # We enforce immediate removal for owner channels to prevent routing valid requests to dead channels
            del self.ROOM_OWNER_CHANNELS[self.room_slug]
            
        # Check if this user explicitly requested to leave (via 'explicit_leave' message)
        has_explicitly_left = getattr(self, 'has_explicitly_left', False)

        # 3. Remove from requesters list if they disconnect while waiting
        is_pending_disconnect = False
        if self.room_slug in self.ROOM_REQUESTERS and self.username in self.ROOM_REQUESTERS[self.room_slug]:
             if self.ROOM_REQUESTERS[self.room_slug][self.username] == self.channel_name:
                 del self.ROOM_REQUESTERS[self.room_slug][self.username]
                 is_pending_disconnect = True
                 
                 # NEW: If they explicitly left, remove from persistent list too
                 if has_explicitly_left:
                     self._remove_persistent_requester(self.username)
                     print(f"Removed persistent requester {self.username} due to explicit leave.")

                 # IMPORTANT: Broadcast request count update to owner
                 self.broadcast_request_count_to_owner() 

        # 4. ACTIVE USER HANDLING (Modified for Persistence)

        user_left = False
        if self.room_slug in self.ROOM_USERS and self.username in self.ROOM_USERS[self.room_slug]:
             # Only modify if this is the active channel stored for this user
             if self.ROOM_USERS[self.room_slug][self.username] == self.channel_name:
                
                # CRITICAL CHANGE: Only remove from ROOM_USERS if they explicitly left.
                # If they just disconnected (network/background), we keep them in the list.
                if has_explicitly_left:
                    del self.ROOM_USERS[self.room_slug][self.username]
                    user_left = True
                else:
                    print(f"User {self.username} disconnected but NOT removed (persisting for reconnect).")
                    # We do NOT delete from ROOM_USERS here.
                    # They will be cleaned up by the 'stale check' in connect() if they don't return.

        # 5. If the user truly left (was removed from ROOM_USERS), broadcast the update
        if user_left:
            self.broadcast_user_list(send_join_message=False)
            self.send_system_message(f"{self.username} has left the room.")
            
            # Note: Automatic room deletion when empty is now disabled.
            # Owners must delete rooms manually from the lobby.
            pass

        # 8. Remove from call participants if they were in one
        if self.room_slug in self.ROOM_CALL_PARTICIPANTS and self.username in self.ROOM_CALL_PARTICIPANTS[self.room_slug]:
             self.ROOM_CALL_PARTICIPANTS[self.room_slug].discard(self.username)
             self.check_and_end_call()

        print(f"User {self.username} disconnected (Code: {close_code}). Explicit Leave: {has_explicitly_left}")


    # ------------------------------------------------------------------
    # --- HELPER METHODS ---
    # ------------------------------------------------------------------
    
    # NEW HELPER: Send request count to owner
    def broadcast_request_count_to_owner(self):
        """Sends the current list of pending requests to the room owner."""
        owner_channel = self.ROOM_OWNER_CHANNELS.get(self.room_slug)

        persistent_requesters = self._get_persistent_requesters()

        if owner_channel:
            requesters = list(self.ROOM_REQUESTERS.get(self.room_slug, {}).keys())
            
            async_to_sync(self.channel_layer.send)(
                owner_channel,
                {
                    'type': 'request_count_sync',
                    'count': len(persistent_requesters),
                    'requesters': persistent_requesters, 
                }
            )

    def send_system_message(self, message_content):
        """Sends a system-generated message to the room group."""
        sender = 'System' 
        
        # 1. Save the message to the database
        # Check if room_instance still exists before saving
        try:
            self.room_instance.refresh_from_db()
        except Room.DoesNotExist:
            print(f"Attempted to send system message to deleted room {self.room_slug}.")
            return

        new_message = Message.objects.create(
            room=self.room_instance,
            sender=sender,
            content=message_content,
        )

        # 2. Broadcast the message to the group
        async_to_sync(self.channel_layer.group_send)(
            self.room_group_name,
            {
                'type': 'chat_message',  # Uses the existing chat_message handler
                'message': message_content,
                'sender': sender,
                'message_id': str(new_message.pk), 
            }
        )
    
    def broadcast_user_list(self, send_join_message=False):
        """Sends an updated list of active users to the entire room group."""
        
        # CRITICAL: Only active users in ROOM_USERS are broadcasted now
        active_users_dict = self.ROOM_USERS.get(self.room_slug, {})
        active_users = list(active_users_dict.keys())
        
        async_to_sync(self.channel_layer.group_send)(
            self.room_group_name,
            {
                'type': 'user_list_update', 
                'users': active_users,
            }
        )

    def broadcast_typing_users(self):
        """Broadcasts the current list of users who are typing."""
        
        typers = list(self.ROOM_TYPERS.get(self.room_slug, set()))
        
        async_to_sync(self.channel_layer.group_send)(
            self.room_group_name,
            {
                'type': 'chat_typing_update',
                'typing_users': typers
            }
        )
        
    def send_catch_up_messages(self, last_seen_time):
        """Sends historical messages to the connecting user based on their last seen time."""
        
        # 1. Determine the message query
        if last_seen_time:
            # Send all messages sent since the user was last seen
            messages_qs = Message.objects.filter(
                room=self.room_instance,
                timestamp__gt=last_seen_time 
            ).order_by('timestamp')
        else:
            # Send the last MAX_INITIAL_MESSAGES for a brand new connection
            messages_qs = Message.objects.filter(
                room=self.room_instance
            ).order_by('-timestamp')[:MAX_INITIAL_MESSAGES]
            
            # Reverse the list so the client renders them in chronological order
            messages_qs = reversed(list(messages_qs)) 

        # 2. Format the messages
        messages_to_send = []
        for message in messages_qs:
            # Determine the attachment URL: prioritized external_attachment_url (GIFs) over internal attachment
            attachment_url = message.external_attachment_url
            if not attachment_url and message.attachment:
                attachment_url = message.attachment.url

            is_image = False
            if attachment_url:
                # Simple check for image extension or GIPHY/external image
                if message.external_attachment_url:
                    is_image = True # Assume external URLs passed here are images (GIFs)
                elif message.attachment and message.attachment.name:
                    is_image = any(message.attachment.name.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp'])

            messages_to_send.append({
                'type': 'message',
                'message': message.content,
                'sender': message.sender,
                'message_id': str(message.pk),
                'timestamp': str(message.timestamp),
                'attachment_url': attachment_url,
                'is_image': is_image,
                'reactions': self.get_message_reactions(message.pk),
                'reply_to': {
                    'sender': message.reply_to.sender,
                    'message': message.reply_to.content[:50] + '...' if len(message.reply_to.content) > 50 else message.reply_to.content,
                    'message_id': str(message.reply_to.pk)
                } if message.reply_to else None
            })

        # 3. Send the messages to the connecting user only
        if messages_to_send:
            self.send(text_data=json.dumps({
                'type': 'catch_up_messages',
                'messages': messages_to_send
            }))

    def get_message_reactions(self, message_id):
        """Helper to get reactions for a message."""
        reactions = Reaction.objects.filter(message_id=message_id)
        result = {}
        for r in reactions:
            if r.emoji not in result:
                result[r.emoji] = []
            result[r.emoji].append(r.user)
        return result

    # ------------------------------------------------------------------
    # --- RECEIVE METHOD (UPDATED) ---
    # ------------------------------------------------------------------

    def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message_type = text_data_json.get('type', 'message')
        
        # --- DEPRECATED HANDLER: ROOM DELETION ---
        if message_type == 'delete_room':
             pass
        
        # --- NEW HANDLER: EXPLICIT LEAVE ---
        elif message_type == 'explicit_leave':
            # Mark this consumer instance as intentionally leaving
            self.has_explicitly_left = True
            print(f"User {self.username} sent explicit_leave signal.")
            # The actual removal happens in disconnect() which is triggered by client closing socket or redirecting
            
        # --- NEW HANDLER: STATUS UPDATE (JOIN/ACTIVE SIGNAL) ---
        # This handles the client's first message after connect() and prevents errors.
        elif message_type == 'status_update':
            # This signal is now redundant as connect() handles registration, 
            # but we must handle it explicitly to prevent an unhandled message error 
            # that leads to immediate disconnect.
            print(f"Received status_update from {self.username}. Registration complete in connect(), ignoring signal.")
            return # Simply acknowledge and stop processing.

        # --- HANDLER: INITIAL JOIN REQUEST ---
        elif message_type == 'join_request':
            requester_username = text_data_json.get('requester_username', 'Unknown User')
            
            self._add_persistent_requester(requester_username)
            
            owner_channel = self.ROOM_OWNER_CHANNELS.get(self.room_slug)
            
            if owner_channel:
                async_to_sync(self.channel_layer.send)(
                    owner_channel,
                    {
                        'type': 'join_request_notification',
                        'requester_username': requester_username,
                    }
                )
                print(f"Join request from {requester_username} sent to owner.")
            else:
                 print("Error: Join request received but no owner is currently connected.")

        # --- HANDLER: ACCEPT REQUEST (CRITICAL UPDATE) ---
        elif message_type == 'accept_request':
            requester_username = text_data_json.get('requester_username')
            # Get the channel name of the pending requester
            requester_channel = self.ROOM_REQUESTERS.get(self.room_slug, {}).get(requester_username)
            
            # 1. REMOVE FROM PERSISTENT LIST (Always do this first on resolution)
            self._remove_persistent_requester(requester_username)

            if requester_channel:
                
                # 2. Add them to the main room group
                async_to_sync(self.channel_layer.group_add)(
                    self.room_group_name,
                    requester_channel 
                )
                
                # 3. Promote them to the ROOM_USERS active list
                self.ROOM_USERS[self.room_slug][requester_username] = requester_channel
                
                # 4. Send the signal to UNBLOCK the non-owner client
                async_to_sync(self.channel_layer.send)(
                    requester_channel,
                    {'type': 'consumer.access_promote'} # New internal message type
                )
                
                # 5. Remove them from the block list
                del self.ROOM_REQUESTERS[self.room_slug][requester_username]
                
                # 6. Broadcast the updated user list 
                self.broadcast_user_list(send_join_message=False) 

                # 7. Send system message
                self.send_system_message(f"{requester_username} has joined the room.")

            else:
                print(f"Cannot accept request: Requester {requester_username} not found in blocked list or already accepted.")
            
            # 7. Update the request count panel for the owner
            self.broadcast_request_count_to_owner() 

        # --- HANDLER: DENY REQUEST (CLEANED LOGIC) ---
        elif message_type == 'deny_request':
            requester_username = text_data_json.get('requester_username')
            requester_channel = self.ROOM_REQUESTERS.get(self.room_slug, {}).get(requester_username)

            # 1. REMOVE FROM PERSISTENT LIST (Always do this first on resolution)
            self._remove_persistent_requester(requester_username)
            
            if requester_channel:
                # 2. Send the signal to the non-owner client (show denial message/disconnect)
                async_to_sync(self.channel_layer.send)(
                    requester_channel,
                    {'type': 'access_denied'}
                )
                
                # 3. Remove them from the block list
                del self.ROOM_REQUESTERS[self.room_slug][requester_username]
                print(f"Request denied for {requester_username}.")
                
            else:
                print(f"Cannot deny request: Requester {requester_username} not found.")

            # 4. Update the request count panel for the owner
                self.broadcast_request_count_to_owner() 

        # --- HANDLER: REMOVE PARTICIPANT (OWNER ONLY) ---
        elif message_type == 'remove_participant':
            # Only the room owner can remove participants
            if not self.is_owner:
                self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Only the room owner can remove participants.'
                }))
                return
            
            target_username = text_data_json.get('target_username')
            
            # Prevent owner from removing themselves
            if target_username == self.username:
                self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'You cannot remove yourself from the room.'
                }))
                return
            
            # Check if the target user is in the room
            if self.room_slug in self.ROOM_USERS and target_username in self.ROOM_USERS[self.room_slug]:
                target_channel = self.ROOM_USERS[self.room_slug][target_username]
                
                # Send notification to the removed user
                async_to_sync(self.channel_layer.send)(
                    target_channel,
                    {
                        'type': 'participant_removed',
                        'removed_by': self.username
                    }
                )
                
                # Remove the user from the room
                del self.ROOM_USERS[self.room_slug][target_username]
                
                # Remove from typing list if present
                if self.room_slug in self.ROOM_TYPERS and target_username in self.ROOM_TYPERS[self.room_slug]:
                    self.ROOM_TYPERS[self.room_slug].discard(target_username)
                    self.broadcast_typing_users()
                
                # Remove from group
                async_to_sync(self.channel_layer.group_discard)(
                    self.room_group_name,
                    target_channel
                )
                
                # Broadcast updated user list
                self.broadcast_user_list(send_join_message=False)
                
                # Send system message
                self.send_system_message(f"**{target_username}** was removed from the room by {self.username}.")
                
                print(f"User {target_username} was removed from room {self.room_slug} by owner {self.username}")
            else:
                self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': f'User {target_username} is not in the room.'
                }))
 

        # --- HANDLER: STANDARD MESSAGE (ACTIVE USER ONLY) ---
        elif message_type == 'message':
            # IMPORTANT: Prevent pending users from sending messages
            if self.is_pending:
                self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Access denied. Please wait for approval before sending messages.'
                }))
                return
            
            message_content = text_data_json['message']
            sender = self.scope["user"].username if self.scope["user"].is_authenticated else text_data_json.get('sender', self.username)
            
            # Check if this is a reply
            reply_to_id = text_data_json.get('reply_to_id')
            reply_to_instance = None
            if reply_to_id:
                try:
                    reply_to_instance = Message.objects.get(pk=reply_to_id)
                except Message.DoesNotExist:
                    pass
             
            # Check if room_instance still exists before saving
            try:
                self.room_instance.refresh_from_db()
            except Room.DoesNotExist:
                self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Cannot send message: Room has been deleted.'
                }))
                return
                
            external_attachment_url = text_data_json.get('attachment_url')
            is_image = text_data_json.get('is_image', False)

            new_message = Message.objects.create(
                room=self.room_instance,
                sender=sender,
                content=message_content,
                reply_to=reply_to_instance,
                external_attachment_url=external_attachment_url
            )
            
            reply_to_data = None
            if new_message.reply_to:
                 reply_to_data = {
                    'sender': new_message.reply_to.sender,
                    'message': new_message.reply_to.content[:50] + '...' if len(new_message.reply_to.content) > 50 else new_message.reply_to.content,
                    'message_id': str(new_message.reply_to.pk)
                }
             
            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name,
                {
                    'type': 'chat_message', 
                    'message': message_content,
                    'sender': sender,
                    'message_id': str(new_message.pk), 
                    'reply_to': reply_to_data,
                    'attachment_url': external_attachment_url,
                    'is_image': is_image
                }
            )

        # --- HANDLER: TYPING START/STOP (ACTIVE USER ONLY) ---
        elif message_type == 'typing_start' or message_type == 'typing_stop':
            # IMPORTANT: Prevent pending users from signaling typing
            if self.is_pending and not self.is_owner:
                 return

            sender = self.scope["user"].username if self.scope["user"].is_authenticated else text_data_json.get('sender', self.username)
            
            if not sender or sender == 'Anonymous': sender = self.username
            
            room_typers = self.ROOM_TYPERS.get(self.room_slug)
            if not room_typers:
                self.ROOM_TYPERS[self.room_slug] = set()
                room_typers = self.ROOM_TYPERS[self.room_slug]

            if message_type == 'typing_start': room_typers.add(sender)
            elif message_type == 'typing_stop': room_typers.discard(sender)
            
            self.broadcast_typing_users()
            
        # --- HANDLERS FOR DELETION (UNCHANGED) ---
        elif message_type == 'delete_for_all':
             message_ids = text_data_json['message_ids'] 
             requesting_sender = text_data_json.get('sender')
             current_user = self.scope["user"].username if self.scope["user"].is_authenticated else requesting_sender

             if not current_user or current_user == 'Anonymous':
                 self.send(text_data=json.dumps({
                     'type': 'error',
                     'message': 'Sender identity required for "Delete for Everyone".'
                 }))
                 return

             # Check if room_instance still exists before deleting
             try:
                 self.room_instance.refresh_from_db()
             except Room.DoesNotExist:
                 self.send(text_data=json.dumps({
                     'type': 'error',
                     'message': 'Cannot delete messages: Room has been deleted.'
                 }))
                 return

             Message.objects.filter(pk__in=message_ids, room=self.room_instance).delete()

             async_to_sync(self.channel_layer.group_send)(
                 self.room_group_name,
                 {
                     'type': 'chat.delete_all',
                     'message_id': message_ids
                 }
             )

        elif message_type == 'delete_for_me':
            message_ids = text_data_json['message_ids']
            self.delete_for_me_confirmed({ 'message_id': message_ids })

        # --- NEW HANDLER: ADD REACTION ---
        elif message_type == 'add_reaction':
            message_id = text_data_json.get('message_id')
            emoji = text_data_json.get('emoji')
            
            # Basic validation
            if not message_id or not emoji: return

            # Ensure message exists in this room
            try:
                message = Message.objects.get(pk=message_id, room=self.room_instance)
            except Message.DoesNotExist:
                return 

            # Toggle Logic
            existing_reaction = Reaction.objects.filter(message=message, user=self.username).first()
            
            if existing_reaction:
                if existing_reaction.emoji == emoji:
                    # Toggle OFF
                    existing_reaction.delete()
                else:
                    # Change Reaction
                    existing_reaction.emoji = emoji
                    existing_reaction.save()
            else:
                # Add Query
                Reaction.objects.create(message=message, user=self.username, emoji=emoji)

            # Broadcast Update
            reactions_data = self.get_message_reactions(message_id)
            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name,
                {
                    'type': 'reaction_update',
                    'message_id': message_id,
                    'reactions': reactions_data
                }
            )
        
        #Webrtc
        elif message_type == 'webrtc_signal':
            target_users = text_data_json.get('target_users', 'all')
            
            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name,
                {
                    'type': 'webrtc_signal_handler', 
                    'data': text_data_json.get('data'),
                    'sender': self.username,
                    'target_users': target_users
                }
            )
            
        # --- NEW HANDLER: LEAVE CALL ---
        elif message_type == 'leave_call':
            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name, 
                {
                    'type': 'leave_call_handler',
                    'sender': self.username
                }
            )

        # --- NEW HANDLER: ACTIVE CALL PING ---
        elif message_type == 'active_call_ping':
            # Add user to call participants list
            if self.room_slug in self.ROOM_CALL_PARTICIPANTS:
                self.ROOM_CALL_PARTICIPANTS[self.room_slug].add(self.username)
            
            # Store call type
            self.ROOM_CALL_STATE[self.room_slug] = text_data_json.get('call_type', 'video')

            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name,
                {
                    'type': 'active_call_ping_handler',
                    'sender': self.username,
                    'call_type': text_data_json.get('call_type', 'video')
                }
            )
    

    def webrtc_signal_handler(self, event):
        """
        Sends signaling data (offers, answers, ICE) to the client.
        Crucial: It filters out the sender so they don't receive their own signal,
        and also filters based on target_users.
        """
        # Skip if the message is coming back to the person who sent it
        if self.username == event['sender']:
            return

        # Targeted Signaling Logic
        target_users = event.get('target_users', 'all')
        
        # Only send if it's a broadcast or if this specific consumer is in the target list
        should_send = False
        if target_users == 'all':
            should_send = True
        elif isinstance(target_users, list) and self.username in target_users:
            should_send = True
            
        if should_send:
             self.send(text_data=json.dumps({
                'type': 'webrtc_signal',
                'data': event['data'],
                'sender': event['sender']
            }))

    def leave_call_handler(self, event):
        """Broadcasts that a user has left the WebRTC call."""
        # Remove user from server-side participant tracking
        if self.room_slug in self.ROOM_CALL_PARTICIPANTS:
            self.ROOM_CALL_PARTICIPANTS[self.room_slug].discard(event['sender'])
        
        if self.username == event['sender']: return
        
        self.send(text_data=json.dumps({
            'type': 'leave_call',
            'sender': event['sender']
        }))
        
        # Check if call should end after someone left
        self.check_and_end_call()

    def check_and_end_call(self):
        """Checks if the call should be terminated based on participant count."""
        participants = self.ROOM_CALL_PARTICIPANTS.get(self.room_slug, set())
        count = len(participants)
        
        # If call dropped to 0 or 1, it should end for everyone
        print(f"[CallDebug] Room: {self.room_slug}, Participants: {participants}, Count: {count}")
        
        if count <= 1:
            print(f"[CallDebug] Ending call in {self.room_slug} (Count: {count})")
            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name,
                {
                    'type': 'call_ended_notification',
                    'sender': 'System'
                }
            )
            
            if count == 0:
                if self.room_slug in self.ROOM_CALL_PARTICIPANTS:
                    self.ROOM_CALL_PARTICIPANTS[self.room_slug].clear()
                if self.room_slug in self.ROOM_CALL_STATE:
                    del self.ROOM_CALL_STATE[self.room_slug]
        else:
            # Call is still active with >= 2 people!
            # Broadcast an immediate ping so the person who just left sees the join bar instantly.
            call_type = self.ROOM_CALL_STATE.get(self.room_slug, 'video')
            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name,
                {
                    'type': 'active_call_ping_handler',
                    'sender': 'System',
                    'call_type': call_type
                }
            )

    def call_ended_notification(self, event):
        """Broadcasts that the call has ended to everyone in the room."""
        # Clear local participant set and state for this room on the server side
        if self.room_slug in self.ROOM_CALL_PARTICIPANTS:
             self.ROOM_CALL_PARTICIPANTS[self.room_slug].clear()
        if self.room_slug in self.ROOM_CALL_STATE:
             del self.ROOM_CALL_STATE[self.room_slug]

        self.send(text_data=json.dumps({
            'type': 'call_ended',
        }))

    def active_call_ping_handler(self, event):
        """Broadcasts that a call is active to new users."""
        if self.username == event['sender']: return
        self.send(text_data=json.dumps({
            'type': 'active_call_ping',
            'sender': event['sender'],
            'call_type': event['call_type']
        }))


    # def webrtc_signal_handler(self, event):
    #     # Only send to the browser if they are the intended recipient
    #     if self.username == event['target_user'] or event['target_user'] == 'all':
    #         self.send(text_data=json.dumps({
    #             'type': 'webrtc_signal',
    #             'data': event['data'],
    #             'sender': event['sender']
    #         }))


    # ------------------------------------------------------------------
    # --- CHANNEL LAYER HANDLERS (UNCHANGED) ---
    # ------------------------------------------------------------------

    # def access_granted(self, event):
        # """Handler for when the owner accepts the join request."""
        # Client side should unblock UI and update state
        # self.send(text_data=json.dumps({'type': 'access_granted'}))

    def access_denied(self, event):
        """Handler for when the owner denies the join request."""
        # Client side should show denial message and potentially disconnect
        self.send(text_data=json.dumps({'type': 'access_denied'}))
    
    def participant_removed(self, event):
        """Handler for when a participant is removed from the room by the owner."""
        self.send(text_data=json.dumps({
            'type': 'participant_removed',
            'removed_by': event['removed_by']
        }))

        
    def join_request_notification(self, event):
        """Handler for sending a new request notification to the owner."""
        self.send(text_data=json.dumps({
            'type': 'join_request_notification',
            'requester_username': event['requester_username']
        }))

    def request_count_sync(self, event):
        """Handler for sending the updated list of requesters/count to the owner."""
        self.send(text_data=json.dumps({
            'type': 'request_count_sync',
            'count': event['count'],
            'requesters': event['requesters'], 
        }))

    def chat_message(self, event):
        self.send(text_data=json.dumps({
            'type': 'message',
            'message': event['message'],
            'sender': event['sender'],
            'message_id': event['message_id'],
            'timestamp': str(timezone.now()), # Ensure timestamp is sent if not already
            'attachment_url': event.get('attachment_url'),
            'is_image': event.get('is_image', False),
            'reactions': event.get('reactions', {}),
            'reply_to': event.get('reply_to', None)
        }))

    def chat_typing_update(self, event):
        self.send(text_data=json.dumps({
            'type': 'typing_message',
            'typing_users': event['typing_users']
        }))

    def chat_delete_all(self, event):
        self.send(text_data=json.dumps({
            'type': 'delete_confirmed',
            'message_id': event['message_id']
        }))
        
    def user_list_update(self, event):
        self.send(text_data=json.dumps({
            'type': 'user_list_update',
            'users': event['users']
        }))

    def consumer_access_promote(self, event):
        """
        INTERNAL HANDLER: Fired when a pending user is accepted. 
        It updates the consumer's instance state and tells the client to unblock.
        """
        self.is_pending = False # *** THE CRITICAL FIX: Update the consumer's instance state ***
        
        # Now send the signal to the client to unblock the UI
        self.send(text_data=json.dumps({'type': 'access_granted'}))

    def _get_persistent_requesters(self):
        """Fetches the list of pending requester usernames from the Room instance."""
        try:
            self.room_instance.refresh_from_db() # Ensure we have the latest data
            # Assuming 'pending_requesters' is a JSONField/ArrayField on the Room model 
            # and stores a list of usernames
            return getattr(self.room_instance, 'pending_requesters', []) 
        except Room.DoesNotExist:
            return []

    def _add_persistent_requester(self, username):
        """Adds a requester to the persistent list and saves."""
        try:
            current_list = self._get_persistent_requesters()
            if username not in current_list:
                current_list.append(username)
                # Assuming Room model update
                self.room_instance.pending_requesters = current_list
                self.room_instance.save(update_fields=['pending_requesters'])
        except Room.DoesNotExist:
            print(f"Cannot add requester: Room {self.room_slug} no longer exists.")


    def _remove_persistent_requester(self, username):
        """Removes a requester from the persistent list and saves."""
        try:
            current_list = self._get_persistent_requesters()
            if username in current_list:
                current_list.remove(username)
                # Assuming Room model update
                self.room_instance.pending_requesters = current_list
                self.room_instance.save(update_fields=['pending_requesters'])
        except Room.DoesNotExist:
            # If the room is gone, the requester list is implicitly gone too.
            print(f"Cannot remove requester: Room {self.room_slug} no longer exists.")

    def cleanup_stale_users(self):
        """Run on connect: Removes users from the room who haven't been seen in > 150 seconds."""
        if self.room_slug not in self.ROOM_USERS:
            return

        active_users = self.ROOM_USERS[self.room_slug]
        users_to_remove = []
        now = timezone.now()
        
        active_connections = self.ROOM_ACTIVE_CONNECTIONS.get(self.room_slug, set())

        # Timeout threshold: 600 seconds (10 minutes)
        # Allows for slower mobile app switches but cleans up zombies reasonably fast.
        STALE_TIMEOUT_SECONDS = 600 
        
        for username in list(active_users.keys()):
            # 1. SKIP ACTIVE CONNECTIONS: If they have an open socket, they are NOT stale.
            if username in active_connections:
                continue

            last_seen = self.USER_LAST_SEEN.get(self.room_slug, {}).get(username)
            if last_seen:
                diff = (now - last_seen).total_seconds()
                if diff > STALE_TIMEOUT_SECONDS:
                    # Double check: ensure it's not the *current* user who just connected!
                    if username != self.username:
                        print(f"Cleaning up stale user {username} (Last seen {diff}s ago)")
                        users_to_remove.append(username)
            else:
                 # If no last_seen record exists, maybe set it now? 
                 # Or treat as stale if they are not the current user?
                 pass

        if users_to_remove:
            changes_made = False
            for u in users_to_remove:
                if u in active_users:
                    del active_users[u]
                    changes_made = True
            
            if changes_made:
                self.broadcast_user_list(send_join_message=False)
                
                # NEW: If the room is now empty after stale cleanup, delete it
                if not self.ROOM_USERS.get(self.room_slug):
                    print(f"Room {self.room_slug} became empty after stale cleanup. Deleting.")
                    try:
                        self.room_instance.delete()
                    except Exception:
                        pass

    def delete_for_me_confirmed(self, event):
        """Sends confirmation to the user that messages should be deleted locally."""
        self.send(text_data=json.dumps({
            'type': 'delete_confirmed',
            'message_id': event['message_id']
        }))

    def reaction_update(self, event):
        """Broadcasts updated reactions for a specific message."""
        self.send(text_data=json.dumps({
            'type': 'reaction_update',
            'message_id': event['message_id'],
            'reactions': event['reactions']
        }))

    def room_deleted_broadcast(self, event):
        """Broadcasts that the room has been deleted by the owner."""
        self.send(text_data=json.dumps({
            'type': 'room_deleted',
            'deleted_by': event['deleted_by']
        }))
