import json
import urllib.error
import urllib.request

from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone

from symposium.supabase_config import get_supabase_admin
from food.qr_utils import create_qr_code


def send_participant_email(participant):
    """Send a participant's food pass through Brevo and return its message id."""
    if not settings.BREVO_API_KEY or not settings.BREVO_SENDER_EMAIL:
        raise RuntimeError("Brevo credentials (BREVO_API_KEY / BREVO_SENDER_EMAIL) are not configured")
    if not participant.get("email"):
        raise RuntimeError("Participant has no email address")

    manual_code = str(participant.get("manual_code") or participant.get("participant_id") or participant.get("id") or "").strip()
    participant_name = participant.get("name") or "Participant"
    qr_image_url = participant.get("qr_image_url")

    # Auto-generate QR code if missing
    if not qr_image_url and manual_code and participant.get("id"):
        try:
            filename = f"qr_{participant['id']}.png"
            qr_res = create_qr_code(manual_code, filename, manual_code)
            if qr_res and qr_res.get("url"):
                qr_image_url = qr_res["url"]
                get_supabase_admin().table("participants").update({
                    "qr_image_url": qr_image_url
                }).eq("id", participant["id"]).execute()
        except Exception:
            pass

    try:
        html_content = render_to_string("food/emails/food_pass.html", {
            "participant_name": participant_name,
            "manual_code": manual_code,
            "qr_image_url": qr_image_url,
        })
    except Exception:
        html_content = (
            f"<p>Hello {participant_name},</p>"
            f"<p>Thank you for registering for TECHNOVANZA 2026. Your food pass manual code is <strong>{manual_code}</strong>.</p>"
            f"<p>Your QR code pass is attached to this email. Please show it at the food counter to collect your food.</p>"
        )

    payload = {
        "sender": {
            "email": settings.BREVO_SENDER_EMAIL,
            "name": settings.BREVO_SENDER_NAME,
        },
        "to": [{"email": participant["email"], "name": participant_name}],
        "subject": "Your TECHNOVANZA 2026 Food Pass",
        "textContent": (
            f"Hello {participant_name},\n\n"
            f"Thank you for registering for TECHNOVANZA 2026. Your food pass code is {manual_code}.\n"
            "Your food pass is attached. Please show it at the food counter to collect your food."
        ),
        "htmlContent": html_content,
    }

    if qr_image_url:
        payload["attachment"] = [{
            "url": qr_image_url,
            "name": f"food-pass-{manual_code}.png",
        }]

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
