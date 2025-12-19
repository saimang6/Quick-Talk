# ChatProject/routing.py

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application # <-- Must be imported
from chat.routing import websocket_urlpatterns

application = ProtocolTypeRouter({
    # HTTP requests go to the standard Django ASGI application.
    "http": get_asgi_application(), 
    
    # WebSocket requests go through authentication and then to your chat routing.
    "websocket": AuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})