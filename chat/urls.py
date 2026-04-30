# chat/urls.py

from django.urls import path
from . import views

urlpatterns = [
    # 1. Welcome Page
    path('', views.index, name='index'), 
    
    # 2. Lobby/Room List Page (Accepts username via GET parameter)
    path('lobby/', views.lobby, name='lobby'), 
    
    # 2b. API Endpoint for Room List (JSON)
    path('api/rooms/', views.get_rooms_json, name='get_rooms_json'),
    path('api/rooms/create/', views.create_room_json, name='create_room_json'),
    
    # 3. Dynamic Chat Room URL (uses room slug)
    path('room/<slug:room_slug>/', views.room, name='room'),

    # 4. File Upload Endpoint
    path('room/<slug:room_slug>/upload/', views.upload_attachment, name='upload_attachment'),
]
