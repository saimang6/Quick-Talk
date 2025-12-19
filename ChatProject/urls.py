from django.contrib import admin
from django.urls import path, include
from django.conf import settings
# Import both static() and staticfiles_urlpatterns
from django.conf.urls.static import static 
from django.contrib.staticfiles.urls import staticfiles_urlpatterns 

urlpatterns = [
    path('', include('chat.urls')),
    path('admin/', admin.site.urls),
    path('chat/', include('chat.urls')),
]

# ----------------------------------------------------
# Crucial Fix: Only for DEBUG=True in Development
# ----------------------------------------------------
if settings.DEBUG:
    # Use staticfiles_urlpatterns to correctly serve files from app/static/ folders
    urlpatterns += staticfiles_urlpatterns()
    
    # If you had media files, you would still use the standard static() helper for those:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)