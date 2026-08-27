from django.urls import path
from . import views

app_name = 'food'

urlpatterns = [
    # Authentication
    path('', views.login_view, name='login'),
    path('login/', views.login_view, name='login_page'),
    path('accounts/login/', views.login_view, name='accounts_login'),
    path('logout/', views.logout_view, name='logout'),
    
    # Dashboard
    path('dashboard/', views.dashboard, name='dashboard'),
    
    # Scanner
    path('scanner/', views.scanner, name='scanner'),
    path('mail/', views.email_page, name='email_page'),
    
    # API
    path('api/verify/', views.verify_qr, name='verify_qr'),
    path('api/claim/', views.claim_food, name='claim_food'),
    path('api/mail/participants/', views.mail_participants_list, name='mail_participants_list'),
    path('api/mail/participants/bulk-send/', views.bulk_send_mail, name='bulk_send_mail'),
    path('api/mail/participants/<uuid:participant_id>/send/', views.send_mail_participant, name='send_mail_participant'),
    path('api/mail/participants/<uuid:participant_id>/resend/', views.resend_mail_participant, name='resend_mail_participant'),
    path('api/mail/participants/<str:participant_id>/send/', views.send_mail_participant, name='send_mail_participant_str'),
    path('api/mail/participants/<str:participant_id>/resend/', views.resend_mail_participant, name='resend_mail_participant_str'),
    path('api/mail/brevo-webhook/', views.brevo_webhook, name='brevo_webhook'),
]