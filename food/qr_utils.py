import os
from io import BytesIO

import qrcode
from django.conf import settings
from PIL import Image, ImageDraw, ImageFont

from symposium.supabase_config import get_supabase_admin


def create_qr_code(token, filename, label=None):
	qr = qrcode.QRCode(
		version=1,
		error_correction=qrcode.constants.ERROR_CORRECT_L,
		box_size=10,
		border=4,
	)
	qr.add_data(token)
	qr.make(fit=True)
	image = qr.make_image(fill_color="black", back_color="white")
	image = image.convert("RGB")
	label_height = 60
	labelled_image = Image.new("RGB", (image.width, image.height + label_height), "white")
	labelled_image.paste(image, (0, 0))
	draw = ImageDraw.Draw(labelled_image)
	font = ImageFont.load_default()
	label = str(label or token)
	left, top, right, bottom = draw.textbbox((0, 0), label, font=font)
	draw.text(((image.width - (right - left)) / 2, image.height + 18), label,
	          fill="black", font=font)
	image = labelled_image

	qr_directory = os.path.join(settings.MEDIA_ROOT, "qr_codes")
	os.makedirs(qr_directory, exist_ok=True)
	file_path = os.path.join(qr_directory, filename)
	image.save(file_path)

	buffer = BytesIO()
	image.save(buffer, format="PNG")
	binary_data = buffer.getvalue()

	storage_path = f"qr_codes/{filename}"
	storage = get_supabase_admin().storage.from_(settings.SUPABASE_QR_BUCKET)
	storage.upload(
		storage_path,
		binary_data,
		{"content-type": "image/png", "upsert": "true"},
	)

	return {
		"filename": filename,
		"file_path": file_path,
		"storage_path": storage_path,
		"url": storage.get_public_url(storage_path),
		"binary_data": binary_data,
	}
