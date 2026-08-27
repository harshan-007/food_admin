import base64
import json
import secrets
import urllib.error
import urllib.request

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.template.loader import render_to_string

from food.qr_utils import create_qr_code
from symposium.supabase_config import get_supabase, get_supabase_admin


class Command(BaseCommand):
    help = "Generate and email QR codes for participants stored in Supabase"

    def send_qr_email(self, participant, qr):
        participant_name = participant.get("name", "Participant")
        payload = {
            "sender": {
                "email": settings.BREVO_SENDER_EMAIL,
                "name": settings.BREVO_SENDER_NAME,
            },
            "to": [{
                "email": participant["email"],
                "name": participant_name,
            }],
            "subject": "Your TECHNOVANZA 2026 Food Pass",
            "textContent": (
                f"Hello {participant_name},\n\n"
                "Your TECHNOVANZA 2026 food pass is attached as a PNG file. "
                "Please show it at the food counter to collect your food. "
                "Do not share this QR code."
            ),
            "htmlContent": render_to_string(
                "food/emails/food_pass.html",
                {
                    "participant_name": participant_name,
                    "manual_code": participant.get("manual_code", ""),
                },
            ),
            "attachment": [{
                "content": base64.b64encode(qr["binary_data"]).decode("ascii"),
                "name": qr["filename"],
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
                if response.status not in (200, 201, 202):
                    raise RuntimeError(f"Brevo returned HTTP {response.status}")
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Brevo email failed ({error.code}): {details}"
            ) from error

    def create_manual_code(self, supabase, used_codes):
        while True:
            code = f"{secrets.randbelow(1000000):06d}"
            if code not in used_codes:
                used_codes.add(code)
                return code

    def handle(self, *args, **options):
        if not settings.BREVO_API_KEY or not settings.BREVO_SENDER_EMAIL:
            raise CommandError(
                "BREVO_API_KEY and BREVO_SENDER_EMAIL must be configured"
            )
        if not settings.SUPABASE_SERVICE_ROLE_KEY:
            raise CommandError(
                "SUPABASE_SERVICE_ROLE_KEY must be configured for QR Storage uploads"
            )

        supabase = get_supabase_admin()
        participants = supabase.table("participants").select("*").execute().data
        used_codes = {
            str(participant["manual_code"])
            for participant in participants
            if participant.get("manual_code")
        }
        processed = 0
        skipped = 0
        failed = []

        for participant in participants:
            participant_id = participant.get("id", "unknown")
            token = participant.get("qr_token")
            email = participant.get("email")
            if not token or not email:
                skipped += 1
                continue

            try:
                manual_code = participant.get("manual_code")
                if not manual_code:
                    manual_code = self.create_manual_code(supabase, used_codes)
                    supabase.table("participants").update({
                        "manual_code": manual_code,
                    }).eq("id", participant_id).execute()

                filename = f"qr_{participant_id}.png"
                qr = create_qr_code(manual_code, filename, manual_code)
                if not qr:
                    raise RuntimeError("QR generation failed")
                if not participant.get("qr_image_url"):
                    supabase.table("participants").update({
                        "qr_image_url": qr["url"],
                    }).eq("id", participant_id).execute()
                    self.send_qr_email({**participant, "manual_code": manual_code}, qr)
                    processed += 1
                else:
                    supabase.table("participants").update({
                        "qr_image_url": qr["url"],
                    }).eq("id", participant_id).execute()
                    skipped += 1
            except Exception as error:
                failed.append(f"{participant_id}: {error}")

        if failed:
            self.stderr.write("\n".join(failed))
        self.stdout.write(self.style.SUCCESS(
            f"Processed {processed}, skipped {skipped}, failed {len(failed)}"
        ))
        if failed:
            raise CommandError("Some participants could not be processed")
