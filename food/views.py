import os

from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.http import JsonResponse
import json
from symposium.supabase_config import get_supabase


def get_claim_for_participant(supabase, participant_id):
    response = supabase.table('claims').select(
        'claimed_at'
    ).eq('participant_id', participant_id).limit(1).execute()
    return response.data[0] if response.data else None


def get_participant_for_code(supabase, code):
    response = supabase.table('participants').select('*').eq(
        'qr_token', str(code)
    ).execute()
    if not response.data:
        response = supabase.table('participants').select('*').eq(
            'manual_code', str(code)
        ).execute()
    return response.data[0] if response.data else None


# ========== AUTHENTICATION ==========

def login_view(request):
    if request.user.is_authenticated:
        return redirect('food:dashboard')
    
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        user = authenticate(request, username=username, password=password)
        
        if user is not None:
            login(request, user)
            return redirect('food:dashboard')
        else:
            messages.error(request, 'Invalid username or password')
    
    return render(request, 'partials/login.html')

@login_required
def logout_view(request):
    logout(request)
    messages.success(request, 'Logged out successfully')
    return redirect('food:login')

# ========== DASHBOARD ==========

@login_required
def dashboard(request):
    supabase = get_supabase()

    # Get all participants
    response = supabase.table("participants").select("*").execute()
    participants = response.data

    claims = supabase.table('claims').select('participant_id, claimed_at').execute().data
    claims_by_participant = {
        claim['participant_id']: claim for claim in claims
    }
    for participant in participants:
        claim = claims_by_participant.get(participant.get('id'))
        participant['food_claimed'] = claim is not None
        participant['claimed_at'] = claim.get('claimed_at') if claim else None

    total = len(participants)
    claimed = sum(participant['food_claimed'] for participant in participants)
    unclaimed = total - claimed
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
        'veg_claimed': sum(participant['food_claimed'] for participant in veg_participants),
        'non_veg_claimed': sum(participant['food_claimed'] for participant in non_veg_participants),
        'is_supabase_active': bool(os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_KEY')),
        'participants': participants,
    }
    return render(request, 'food/dashboard.html', context)

# ========== SCANNER ==========

@login_required
def scanner(request):
    return render(request, 'food/scanner.html')

# ========== API ENDPOINTS ==========

@login_required
def verify_qr(request):
    """Verify QR token"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    
    try:
        data = json.loads(request.body)
        token = data.get('token') or data.get('manual_code')
    except:
        return JsonResponse({'error': 'Invalid data'}, status=400)
    
    if not token:
        return JsonResponse({'error': 'Token required'}, status=400)
    
    supabase = get_supabase()
    participant = get_participant_for_code(supabase, token)
    if not participant:
        return JsonResponse({'error': 'Invalid QR code'}, status=404)
    
    claim = get_claim_for_participant(supabase, participant['id'])
    if claim:
        request.session.pop('verified_participant_id', None)
        return JsonResponse({
            'valid': False,
            'claimed': True,
            'message': 'Food already claimed',
            'claimed_at': claim.get('claimed_at'),
            'participant': {
                'id': participant['id'],
                'name': participant['name'],
                'email': participant.get('email'),
                'qr_token': participant.get('qr_token'),
                'manual_code': participant.get('manual_code'),
            },
        })

    request.session['verified_participant_id'] = str(participant['id'])
    return JsonResponse({
        'valid': True,
        'claimed': False,
        'message': 'Valid QR code',
        'participant': {
            'id': participant['id'],
            'name': participant['name'],
            'email': participant['email'],
            'qr_token': participant.get('qr_token'),
            'manual_code': participant.get('manual_code'),
        }
    })

@login_required
def claim_food(request):
    """Claim food for participant"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    
    try:
        data = json.loads(request.body)
        token = data.get('token') or data.get('manual_code')
    except:
        return JsonResponse({'error': 'Invalid data'}, status=400)
    
    if not token:
        return JsonResponse({'error': 'Token required'}, status=400)
    
    supabase = get_supabase()
    
    # Get participant
    participant = get_participant_for_code(supabase, token)
    if not participant:
        return JsonResponse({'error': 'Invalid QR code'}, status=404)

    if request.session.get('verified_participant_id') != str(participant['id']):
        return JsonResponse({
            'success': False,
            'message': 'Scan and verify the QR code before claiming food',
        }, status=403)
    
    if get_claim_for_participant(supabase, participant['id']):
        return JsonResponse({
            'success': False,
            'message': 'Food already claimed',
        }, status=400)

    from datetime import datetime
    claimed_at = datetime.now().isoformat()
    supabase.table('claims').insert({
        'participant_id': participant['id'],
        'claimed_by_admin': request.user.username,
        'claimed_at': claimed_at,
    }).execute()
    request.session.pop('verified_participant_id', None)
    
    return JsonResponse({
        'success': True,
        'message': f'Food claimed for {participant["name"]}',
        'participant': {
            'id': participant['id'],
            'name': participant['name'],
            'email': participant.get('email'),
            'claimed_at': claimed_at,
        },
    })