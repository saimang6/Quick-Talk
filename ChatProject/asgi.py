# ChatProject/asgi.py - CORRECTED VERSION

# import os
# from channels.routing import ProtocolTypeRouter
# from django.core.asgi import get_asgi_application

# # 1. Set the DJANGO_SETTINGS_MODULE environment variable FIRST.
# os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ChatProject.settings')

# # 2. Import your custom routing AFTER the environment is set.
# # This prevents the circular import/ImproperlyConfigured error.
# from . import routing

# # 3. Define the ProtocolTypeRouter using the imported routing logic.
# application = ProtocolTypeRouter({
#     "http": get_asgi_application(),
#     "websocket": routing.application, # 'routing.application' is your AuthMiddlewareStack(URLRouter...)
# })

# ChatProject/asgi.py - FIX: Use standard channels imports

# import os
# from django.core.asgi import get_asgi_application
# from channels.routing import ProtocolTypeRouter, URLRouter
# from channels.auth import AuthMiddlewareStack
# import chat.routing  # <-- Import the application-specific routing file

# # 1. Set the DJANGO_SETTINGS_MODULE environment variable FIRST.
# os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ChatProject.settings')

# # Get the basic Django ASGI application for HTTP requests
# django_asgi_app = get_asgi_application()

# # 2. Define the ProtocolTypeRouter
# application = ProtocolTypeRouter({
#     # Handles normal HTTP requests (runserver, Django views, etc.)
#     "http": django_asgi_app, 
    
#     # Handles WebSocket connections
#     "websocket": AuthMiddlewareStack(
#         URLRouter(
#             chat.routing.websocket_urlpatterns # Points to your list of URLs
#         )
#     ),
# })

# ChatProject/asgi.py

import os
import django
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
# Note: chat.routing is now imported LATER, after django.setup()

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ChatProject.settings')

# --- CRITICAL FIX: Explicitly set up Django before any app/model imports ---
# This ensures the App Registry is fully loaded. 
django.setup()
# -------------------------------------------------------------------------

# Import routing AFTER Django has been set up to avoid AppRegistryNotReady
import chat.routing 

django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
    "http": django_asgi_app, 
    "websocket": AuthMiddlewareStack(
        URLRouter(
            chat.routing.websocket_urlpatterns
        )
    ),
})