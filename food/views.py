import os
from datetime import datetime

from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
import json
from symposium.supabase_config import get_supabase, get_supabase_admin
from .email_utils import send_and_record_participant_email


def format_claimed_at(value):
    if not value:
        return None

    try:
        if isinstance(value, str):
            claimed_at = datetime.fromisoformat(value.replace('Z', '+00:00'))
        elif isinstance(value, datetime):
            claimed_at = value
        else:
            return str(value)

        ist_tz = timezone.get_fixed_timezone(330)  # IST (UTC+05:30)
        if timezone.is_naive(claimed_at):
            claimed_at = timezone.make_aware(claimed_at, ist_tz)
        else:
            claimed_at = claimed_at.astimezone(ist_tz)
        return claimed_at.strftime('%I:%M %p, %d %b %Y')
    except (TypeError, ValueError, Exception):
        return str(value)


def get_claim_for_participant(supabase, participant_id):
    response = supabase.table('claims').select(
        'claimed_at'
    ).eq('participant_id', participant_id).limit(1).execute()
    return response.data[0] if response.data else None


def get_participant_for_code(supabase, code):
    code_str = str(code).strip()
    if not code_str:
        return None

    # Check participant_id
    try:
        response = supabase.table('participants').select('*').eq(
            'participant_id', code_str
        ).execute()
        if response.data:
            return response.data[0]
    except Exception:
        pass

    # Check id (uuid or integer id)
    try:
        response = supabase.table('participants').select('*').eq(
            'id', code_str
        ).execute()
        if response.data:
            return response.data[0]
    except Exception:
        pass

    # Check qr_token
    try:
        response = supabase.table('participants').select('*').eq(
            'qr_token', code_str
        ).execute()
        if response.data:
            return response.data[0]
    except Exception:
        pass

    # Check manual_code
    try:
        response = supabase.table('participants').select('*').eq(
            'manual_code', code_str
        ).execute()
        if response.data:
            return response.data[0]
    except Exception:
        pass

    return None


# ========== AUTHENTICATION ==========

def login_view(request):
    next_url = request.GET.get('next') or request.POST.get('next')

    if request.user.is_authenticated:
        if next_url and not next_url.startswith('//') and next_url != request.path:
            return redirect(next_url)
        return redirect('food:dashboard')
    
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        user = authenticate(request, username=username, password=password)
        
        if user is not None:
            login(request, user)
            if next_url and not next_url.startswith('//') and next_url != request.path:
                return redirect(next_url)
            return redirect('food:dashboard')
        else:
            messages.error(request, 'Invalid username or password')
    
    return render(request, 'partials/login.html', {'next': next_url})

@login_required
def logout_view(request):
    logout(request)
    messages.success(request, 'Logged out successfully')
    return redirect('food:login')

# ========== DASHBOARD ==========

@login_required
def dashboard(request):
    participants = []
    claims = []
    is_supabase_active = False

    try:
        supabase = get_supabase()
        response = supabase.table("participants").select("*").execute()
        participants = response.data or []
        is_supabase_active = True
    except Exception as e:
        messages.warning(request, f"Supabase sync unavailable: {str(e)}")

    try:
        if is_supabase_active:
            claims_res = supabase.table('claims').select('participant_id, claimed_at').execute()
            claims = claims_res.data or []
    except Exception:
        claims = []

    claims_by_participant = {
        claim['participant_id']: claim for claim in claims if isinstance(claim, dict) and 'participant_id' in claim
    }
    for participant in participants:
        claim = claims_by_participant.get(participant.get('id'))
        participant['food_claimed'] = claim is not None
        participant['claimed_at'] = claim.get('claimed_at') if claim else None
        participant['claimed_at_display'] = format_claimed_at(participant['claimed_at'])
        participant['display_id'] = participant.get('manual_code') or participant.get('participant_id') or participant.get('id')

    total = len(participants)
    claimed = sum(bool(participant.get('food_claimed')) for participant in participants)
    unclaimed = max(0, total - claimed)
    veg_participants = [
        participant for participant in participants
        if str(participant.get('food_preference', '')).lower() == 'veg'
    ]
    non_veg_participants = [
        participant for participant in participants
        if str(participant.get('food_preference', '')).lower() != 'veg'
    ]
    
    context = {
        'total': total,
        'claimed': claimed,
        'unclaimed': unclaimed,
        'veg_total': len(veg_participants),
        'non_veg_total': len(non_veg_participants),
        'veg_claimed': sum(bool(participant.get('food_claimed')) for participant in veg_participants),
        'non_veg_claimed': sum(bool(participant.get('food_claimed')) for participant in non_veg_participants),
        'is_supabase_active': is_supabase_active,
        'participants': participants,
    }
    return render(request, 'food/dashboard.html', context)

# ========== SCANNER ==========

@login_required
def scanner(request):
    return render(request, 'food/scanner.html')


@login_required
def email_page(request):
    return render(request, 'food/email.html')


@login_required
def mail_participants_list(request):
    participants = get_supabase_admin().table('participants').select(
        'id,name,email,mail_sent,mail_sent_at,mail_delivered,mail_delivered_at'
    ).order('name').execute().data
    return JsonResponse(participants, safe=False)


def _send_mail_for_participant(request, participant_id, resend=False):
    supabase = get_supabase_admin()
    participant_response = supabase.table('participants').select('*').eq(
        'id', participant_id
    ).limit(1).execute()
    if not participant_response.data:
        return JsonResponse({'error': 'Participant not found'}, status=404)

    participant = participant_response.data[0]
    if participant.get('mail_sent') and not resend:
        return JsonResponse({'success': False, 'error': 'Email already sent'}, status=400)

    try:
        sent = send_and_record_participant_email(participant)
    except Exception as error:
        return JsonResponse({'success': False, 'error': str(error)}, status=502)

    participant.update(sent)
    participant['mail_sent'] = True
    return JsonResponse({'success': True, 'participant': participant})


@login_required
def send_mail_participant(request, participant_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    return _send_mail_for_participant(request, participant_id)


@login_required
def resend_mail_participant(request, participant_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    return _send_mail_for_participant(request, participant_id, resend=True)


@csrf_exempt
def brevo_webhook(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    webhook_token = request.headers.get('X-Brevo-Webhook-Token') or request.GET.get('token')
    if not settings.BREVO_WEBHOOK_TOKEN or webhook_token != settings.BREVO_WEBHOOK_TOKEN:
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    try:
        event = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    event_name = str(event.get('event', '')).lower()
    message_id = event.get('message-id') or event.get('messageId')
    email = event.get('email')
    supabase = get_supabase_admin()
    if message_id:
        query = supabase.table('participants').update({
            'mail_delivered': event_name == 'delivered',
            'mail_delivered_at': timezone.now().isoformat() if event_name == 'delivered' else None,
        }).eq('brevo_message_id', message_id)
    elif email:
        query = supabase.table('participants').update({
            'mail_delivered': event_name == 'delivered',
            'mail_delivered_at': timezone.now().isoformat() if event_name == 'delivered' else None,
        }).eq('email', email)
    else:
        return JsonResponse({'ok': True})
    query.execute()
    return JsonResponse({'ok': True})

# ========== API ENDPOINTS ==========

@login_required
def verify_qr(request):
    """Verify QR token or Participant ID"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    
    try:
        data = json.loads(request.body)
        token = data.get('token') or data.get('participant_id') or data.get('manual_code')
    except:
        return JsonResponse({'error': 'Invalid data'}, status=400)
    
    if not token:
        return JsonResponse({'error': 'Participant ID or QR code required'}, status=400)
    
    supabase = get_supabase()
    participant = get_participant_for_code(supabase, token)
    if not participant:
        return JsonResponse({'error': 'Participant not found with given ID/code'}, status=404)
    
    display_id = participant.get('manual_code') or participant.get('participant_id') or participant.get('id')
    claim = get_claim_for_participant(supabase, participant['id'])
    if claim:
        claimed_at_raw = claim.get('claimed_at')
        claimed_at_ist = format_claimed_at(claimed_at_raw)
        return JsonResponse({
            'valid': False,
            'claimed': True,
            'message': 'Warning: Meal already claimed by this participant!',
            'claimed_at': claimed_at_raw,
            'claimed_at_display': claimed_at_ist,
            'participant': {
                'id': display_id,
                'name': participant.get('name'),
                'email': participant.get('email'),
                'qr_token': participant.get('qr_token'),
                'manual_code': participant.get('manual_code'),
                'participant_id': display_id,
                'claimed_at': claimed_at_raw,
                'claimed_at_display': claimed_at_ist,
            },
        })

    return JsonResponse({
        'valid': True,
        'claimed': False,
        'message': 'Valid participant',
        'participant': {
            'id': display_id,
            'name': participant.get('name'),
            'email': participant.get('email'),
            'qr_token': participant.get('qr_token'),
            'manual_code': participant.get('manual_code'),
            'participant_id': display_id,
        }
    })

@login_required
def claim_food(request):
    """Claim food for participant"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    
    try:
        data = json.loads(request.body)
        token = data.get('token') or data.get('participant_id') or data.get('manual_code')
    except:
        return JsonResponse({'error': 'Invalid data'}, status=400)
    
    if not token:
        return JsonResponse({'error': 'Participant ID or QR code required'}, status=400)
    
    supabase = get_supabase()
    
    # Get participant
    participant = get_participant_for_code(supabase, token)
    if not participant:
        return JsonResponse({'error': 'Participant not found'}, status=404)
    
    if get_claim_for_participant(supabase, participant['id']):
        return JsonResponse({
            'success': False,
            'message': 'Warning: Meal already claimed by this participant!',
        }, status=400)

    claimed_at = timezone.localtime(timezone.now()).isoformat()
    supabase.table('claims').insert({
        'participant_id': participant['id'],
        'claimed_by_admin': request.user.username,
        'claimed_at': claimed_at,
    }).execute()
    
    display_id = participant.get('manual_code') or participant.get('participant_id') or participant.get('id')
    return JsonResponse({
        'success': True,
        'message': f'Food distributed to {participant["name"]}',
        'participant': {
            'id': display_id,
            'name': participant.get('name'),
            'email': participant.get('email'),
            'manual_code': participant.get('manual_code'),
            'participant_id': display_id,
            'claimed_at': claimed_at,
            'claimed_at_display': format_claimed_at(claimed_at),
        },
    })