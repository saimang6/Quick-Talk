 def connect(self):
        self.room_slug = self.scope['url_route']['kwargs']['room_slug'] 
        self.room_group_name = 'chat_%s' % self.room_slug
        self.room_instance = None 
        
        # Extract Username and is_request flag from Query Parameters
        query_params = self.scope['query_string'].decode()
        parsed_qs = urllib.parse.parse_qs(query_params)
        self.username = parsed_qs.get('username', ['Anonymous'])[0]
        
        # Check if the connection URL contains the request flag (meaning user is a requester)
        is_request_join = parsed_qs.get('request', ['false'])[0] == 'true'

        # --- Room Existence Check ---
        is_new_room = 'new' in parsed_qs
        try:
            if is_new_room:
                 new_room_name = parsed_qs.get('name', [''])[0]
                 owner_username = parsed_qs.get('owner_username', [''])[0] or self.username 
                 if not Room.objects.filter(slug=self.room_slug).exists():
                     self.room_instance = Room.objects.create(
                         name=new_room_name,
                         slug=self.room_slug,
                         owner_username=owner_username
                     )
            
            if not self.room_instance:
                self.room_instance = Room.objects.get(slug=self.room_slug)
        except Room.DoesNotExist:
            self.close(code=4004)
            return
        
        self.is_owner = self.room_instance.owner_username == self.username

        # Accept connection immediately
        self.accept()
        
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
        
        # Determine if this user is currently pending approval
        self.is_pending = is_request_join and not self.is_owner
        
        # --- NEW CONNECTION LOGIC: PENDING VS ACTIVE ---
        
        if self.is_pending:
            # 1. PENDING: Only track their channel for direct messages (approval/denial)
            self.ROOM_REQUESTERS[self.room_slug][self.username] = self.channel_name
            
            # 2. DO NOT add them to the main room group (chat group)
            # 3. DO NOT add them to the ROOM_USERS list (participant panel)
            print(f"User {self.username} connected and is marked as PENDING.")
            
        else:
            # ACTIVE/OWNER LOGIC
            
            # 1. Add user's channel to the main Channel Layer Group
            async_to_sync(self.channel_layer.group_add)(
                self.room_group_name,
                self.channel_name
            )

            # 2. Add user to the ROOM_USERS list (for participant display)
            user_joined = self.username not in self.ROOM_USERS.get(self.room_slug, {}) 
            self.ROOM_USERS[self.room_slug][self.username] = self.channel_name 
            
            # 3. Handle Owner Tracking
            if self.is_owner:
                self.ROOM_OWNER_CHANNELS[self.room_slug] = self.channel_name
            
            # 4. Execute Join Logic (Update last seen)
            if user_joined:
                self.USER_LAST_SEEN[self.username] = timezone.now()
                # self.send_system_message(f"{self.username} has joined the room.") # System message sent only on acceptance/unblocking
            
            # 5. Broadcast the updated user list
            self.broadcast_user_list(send_join_message=False)
        
        # 6. Always Sync the request count for the owner on connect
        if self.is_owner:
            self.broadcast_request_count_to_owner() # Corrected helper call
        
        # --- CATCH-UP LOGIC START ---
        # Only send history to users who are ACTIVE
        if not self.is_pending:
            last_seen_time = self.USER_LAST_SEEN.get(self.username)
            if last_seen_time:
                 self.send_catch_up_messages(last_seen_time)
        # ------------------------------------------------------------------
