from django.urls import path
from . import views

app_name = 'food'

urlpatterns = [
    # Authentication
    path('', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    
    # Dashboard
    path('dashboard/', views.dashboard, name='dashboard'),
    
    # Scanner
    path('scanner/', views.scanner, name='scanner'),
    
    # API
    path('api/verify/', views.verify_qr, name='verify_qr'),
    path('api/claim/', views.claim_food, name='claim_food'),
]