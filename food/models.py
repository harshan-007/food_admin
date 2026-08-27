from django.db import models
import uuid

class Participant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    qr_token = models.CharField(max_length=255, blank=True, null=True)
    food_claimed = models.BooleanField(default=False)
    claimed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    qr_image_url = models.URLField(max_length=500, blank=True, null=True)
    manual_code = models.CharField(max_length=100, blank=True, null=True)
    
    # 🔥 NEW MAIL FIELDS
    mail_sent = models.BooleanField(default=False)
    mail_sent_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.name} ({self.email})"