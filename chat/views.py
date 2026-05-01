from django.shortcuts import render, redirect, get_object_or_404
from django.utils.text import slugify
from django.urls import reverse
from django.http import JsonResponse, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from .models import Room, Message 

# 1. Welcome Page (Index) - Used to set the username
def index(request):
    return render(request, 'chat/index.html')

# 2. Lobby Page - List existing rooms and allow creation
def lobby(request):
    # The username must be passed from the welcome page
    username = request.GET.get('username')
    
    if not username:
        # If no username is set, redirect back to the welcome page
        return redirect(reverse('index'))
        
    all_rooms = Room.objects.all()
    from .consumers import ChatConsumer
    
    # Show all rooms from the database. 
    # Manual deletion by the owner is now the primary way rooms are removed.
    active_rooms = all_rooms

    return render(request, 'chat/lobby.html', {
        'username': username,
        'rooms': active_rooms,
    })

def get_rooms_json(request):
    """Returns all rooms as JSON for real-time updates in the lobby, filtering out inactive rooms."""
    from .consumers import ChatConsumer
    
    all_rooms = Room.objects.all().values('name', 'slug', 'owner_username')
    active_rooms = []
    
    # Return all rooms. This prevents 'flickering' in the UI when users refresh.
    active_rooms = list(all_rooms)
            
    return JsonResponse({'rooms': active_rooms})

@require_POST
@csrf_exempt
def delete_room_json(request, room_slug):
    """API endpoint for the owner to manually delete a room."""
    import json
    try:
        data = json.loads(request.body)
        username = data.get('username')
        
        room = get_object_or_404(Room, slug=room_slug)
        
        if room.owner_username != username:
            return JsonResponse({'error': 'Unauthorized. Only the owner can delete this room.'}, status=403)
            
        # Delete from DB
        room.delete()

        # 2. Static Cleanup (Force clear the memory state)
        # We must clear these so the lobby doesn't think the room is still "active"
        from .consumers import ChatConsumer
        if room_slug in ChatConsumer.ROOM_USERS:
            del ChatConsumer.ROOM_USERS[room_slug]
        if room_slug in ChatConsumer.ROOM_TYPERS:
            del ChatConsumer.ROOM_TYPERS[room_slug]
        if room_slug in ChatConsumer.ROOM_REQUESTERS:
            del ChatConsumer.ROOM_REQUESTERS[room_slug]
        if room_slug in ChatConsumer.ROOM_OWNER_CHANNELS:
            del ChatConsumer.ROOM_OWNER_CHANNELS[room_slug]
        if room_slug in ChatConsumer.ROOM_ACTIVE_CONNECTIONS:
            del ChatConsumer.ROOM_ACTIVE_CONNECTIONS[room_slug]
        
        # 3. Broadcast deletion to group so any active users are kicked
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'chat_{room_slug}',
            {
                'type': 'room_deleted_broadcast',
                'deleted_by': username
            }
        )
        
        return JsonResponse({'status': 'success'})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@require_POST
@csrf_exempt
def create_room_json(request):
    """API endpoint to create a new room and return JSON."""
    import json
    import uuid
    try:
        data = json.loads(request.body)
        room_name = data.get('room_name')
        secret_number = data.get('secret_number')
        username = data.get('username')

        if not room_name or not username:
            return JsonResponse({'error': 'Missing required fields'}, status=400)

        # Generate a unique slug
        base_slug = slugify(room_name)
        unique_slug = f"{base_slug}-{str(uuid.uuid4())[:8]}"
        
        # Check if room already exists with same name
        existing_rooms = Room.objects.filter(name=room_name)
        if existing_rooms.exists():
            from .consumers import ChatConsumer
            for old_room in existing_rooms:
                active_conns = ChatConsumer.ROOM_ACTIVE_CONNECTIONS.get(old_room.slug, set())
                persisted_users = ChatConsumer.ROOM_USERS.get(old_room.slug, {})
                
                # If the room is completely abandoned, it's safe to delete it to free up the name
                if not active_conns and not persisted_users:
                    old_room.delete()
                else:
                    return JsonResponse({'error': 'Room name already exists and is currently in use'}, status=400)

        room = Room.objects.create(
            name=room_name,
            slug=unique_slug,
            owner_username=username,
            secret_number=secret_number
        )

        return JsonResponse({
            'status': 'success',
            'slug': room.slug,
            'name': room.name
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@require_POST
@csrf_exempt
def upload_attachment(request, room_slug):
    if 'file' not in request.FILES:
        return JsonResponse({'error': 'No file provided'}, status=400)
    
    file = request.FILES['file']
    username = request.POST.get('username')
    if not username:
        return JsonResponse({'error': 'Username required'}, status=400)
        
    try:
        room = Room.objects.get(slug=room_slug)
    except Room.DoesNotExist:
        return JsonResponse({'error': 'Room not found'}, status=404)
        
    # Create the message with the attachment
    message = Message.objects.create(
        room=room,
        sender=username,
        content=f"Sent a file: {file.name}", # Fallback text
        attachment=file
    )
    
    # Notify WebSocket group
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f'chat_{room_slug}',
        {
            'type': 'chat_message',
            'message': message.content,
            'sender': username,
            'message_id': str(message.pk),
            'attachment_url': message.attachment.url, # Send the URL
            'is_image': file.content_type.startswith('image/')
        }
    )
    
    return JsonResponse({
        'status': 'success', 
        'url': message.attachment.url,
        'filename': file.name
    })


# 3. Chat Room - Joins the specific room
def room(request, room_slug):
    username = request.GET.get('username')
    
    if not username:
        # Ensure user has a username before attempting room access
        return redirect(reverse('index'))

    # --- Room Creation Logic ---
    is_new = request.GET.get('new') == 'true'
    new_name = request.GET.get('name')
    secret_number_on_creation = request.GET.get('secret')

    room_created = False
    
    if is_new and new_name:
        # Check if it already exists before trying to create it
        if not Room.objects.filter(slug=room_slug).exists():
            Room.objects.create(
                name=new_name,
                slug=room_slug,
                owner_username=username, 
                secret_number=secret_number_on_creation if secret_number_on_creation else ''
            )
            room_created = True # Set the flag
    # --- End Room Creation Logic ---

    # --- CRITICAL FIX: REDIRECT TO STRIP CREATION FLAGS ---
    # if room_created or (is_new and new_name):
    if room_created or is_new:
        clean_url = reverse('room', kwargs={'room_slug': room_slug})
        # Preserve only the necessary 'username' and 'secret' for access validation
        redirect_url = f'{clean_url}?username={username}'
        if secret_number_on_creation:
             # We should probably be using a different parameter for access validation after creation
             # Let's assume you only need 'username' for now, as the secret isn't needed here.
             pass 

        # We redirect to the clean URL, stripping 'new' and 'name' permanently from the history.
        return redirect(redirect_url)
    # --- END CRITICAL FIX --
        
    # --- START STEP 3 IMPLEMENTATION: Graceful Room Check ---
    try:
        # Attempt to retrieve the room object
        room_obj = Room.objects.get(slug=room_slug) 
    except Room.DoesNotExist:
        # If the room is not found (because it was deleted)
        
        # 1. Prepare the redirect URL back to the lobby
        redirect_url = reverse('lobby') + f'?username={username}'
        
        # 2. Redirect the user instead of throwing a 404
        return redirect(redirect_url) 
    # --- END STEP 3 IMPLEMENTATION ---
    
    is_owner = (username == room_obj.owner_username)

    # --- START CACHING PREVENTION ---
    response = render(request, 'chat/room.html', {
        'room_name': room_obj.name, 
        'room_slug': room_slug,     
        'username': username,
        'is_owner': is_owner,
        'creator_username': room_obj.owner_username,
    })
    
    # 1. Stops all caching by the browser and proxies
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    # 2. For backwards compatibility with HTTP/1.0
    response.headers['Pragma'] = 'no-cache'
    # 3. For backwards compatibility, marking the page as expired immediately
    response.headers['Expires'] = '0' 
    
    return response
    # --- END CACHING PREVENTION ---