from django.urls import path
from . import views

urlpatterns = [
    path('', views.dashboard_view, name='home'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
    path('scanner/', views.scanner_view, name='scanner'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
]
