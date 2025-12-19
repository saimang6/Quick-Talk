# chat/routing.py

from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # FIX: Change the named group to 'room_slug' to match the consumer's expectations.
    # We use [^/]+ instead of \w+ to allow more characters in the slug (though \w+ is likely fine).
    re_path(r'ws/chat/(?P<room_slug>[^/]+)/$', consumers.ChatConsumer.as_asgi()),
]