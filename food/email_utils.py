import json
import urllib.error
import urllib.request

from django.conf import settings
from django.utils import timezone

from symposium.supabase_config import get_supabase_admin


def send_participant_email(participant):
    """Send a participant's food pass through Brevo and return its message id."""
    if not settings.BREVO_API_KEY or not settings.BREVO_SENDER_EMAIL:
        raise RuntimeError("Brevo credentials are not configured")
    if not participant.get("email"):
        raise RuntimeError("Participant has no email address")
    if not participant.get("qr_image_url"):
        raise RuntimeError("Participant has no QR image URL")

    participant_name = participant.get("name") or "Participant"
    payload = {
        "sender": {
            "email": settings.BREVO_SENDER_EMAIL,
            "name": settings.BREVO_SENDER_NAME,
        },
        "to": [{"email": participant["email"], "name": participant_name}],
        "subject": "Your TECHNOVANZA 2026 Food Pass",
        "textContent": (
            f"Hello {participant_name},\n\n"
            "Your food pass is attached. Please show it at the food counter."
        ),
        "htmlContent": (
            f"<p>Hello {participant_name},</p>"
            "<p>Your food pass is attached. Please show it at the food counter.</p>"
        ),
        "attachment": [{
            "url": participant["qr_image_url"],
            "name": f"food-pass-{participant.get('manual_code') or participant.get('id')}.png",
        }],
    }
    request = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "accept": "application/json",
            "api-key": settings.BREVO_API_KEY,
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8") or "{}")
            if response.status not in (200, 201, 202):
                raise RuntimeError(f"Brevo returned HTTP {response.status}")
            return result.get("messageId")
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Brevo email failed ({error.code}): {details}") from error


def send_and_record_participant_email(participant):
    message_id = send_participant_email(participant)
    sent_at = timezone.now().isoformat()
    get_supabase_admin().table("participants").update({
        "mail_sent": True,
        "mail_sent_at": sent_at,
        "brevo_message_id": message_id,
        "mail_delivered": False,
        "mail_delivered_at": None,
    }).eq("id", participant["id"]).execute()
    return {"message_id": message_id, "mail_sent_at": sent_at}
