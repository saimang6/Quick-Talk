from django.db import models
from django.utils import timezone
from django.db.models import JSONField # Import JSONField

class Room(models.Model):
    # The name displayed to users (e.g., "Python Dev Group")
    name = models.CharField(max_length=255, unique=True) 
    
    # The unique identifier used in the URL/WebSocket (e.g., "python-dev")
    slug = models.SlugField(max_length=255, unique=True) 
    
    # The username of the user who created the room
    owner_username = models.CharField(max_length=100) 

    # NEW FIELD: Stores the secret number/code known only to the owner
    secret_number = models.CharField(max_length=50, default='')
    
    # NEW FIELD: Persistently stores a list of usernames that are waiting for approval.
    # This ensures requests survive owner disconnects/reloads.
    pending_requesters = JSONField(default=list) 

    def __str__(self):
        return self.name

# --- NEW: Message Model ---
class Message(models.Model):
    # Links the message to a specific room. If the room is deleted, so are its messages (CASCADE).
    room = models.ForeignKey(Room, related_name='messages', on_delete=models.CASCADE)
    
    # Who sent the message
    sender = models.CharField(max_length=255)
        
    # The content of the message
    content = models.TextField()
    
    # CRITICAL: Stores when the message was created. Used for sorting and catch-up logic.
    timestamp = models.DateTimeField(default=timezone.now)

    # NEW: Store file attachments
    attachment = models.FileField(upload_to='attachments/', blank=True, null=True)
    
    # NEW: Store external URLs (like GIPHY)
    external_attachment_url = models.URLField(max_length=500, blank=True, null=True)

    # NEW: Reply functionality
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='replies')

    class Meta:
        # Ensures messages are always retrieved in chronological order
        ordering = ('timestamp',) 

    def __str__(self):
        return f'{self.sender}: {self.content[:30]}...'

class Reaction(models.Model):
    REACTION_CHOICES = (
        ('like', '👍'),
        ('love', '❤️'),
        ('haha', '😂'),
        ('wow', '😮'),
        ('dislike', '👎'),
    )
    message = models.ForeignKey(Message, related_name='reactions', on_delete=models.CASCADE)
    user = models.CharField(max_length=255) # Storing username
    emoji = models.CharField(max_length=20, choices=REACTION_CHOICES)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('message', 'user') # One reaction per user per message