from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.http import JsonResponse
from django.utils import timezone
import json
from symposium.supabase_config import get_supabase

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
    
    total = len(participants)
    claimed = len([p for p in participants if p.get('food_claimed')])
    unclaimed = total - claimed
    
    context = {
        'total': total,
        'claimed': claimed,
        'unclaimed': unclaimed,
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
        token = data.get('token')
    except:
        return JsonResponse({'error': 'Invalid data'}, status=400)
    
    if not token:
        return JsonResponse({'error': 'Token required'}, status=400)
    
    supabase = get_supabase()
    response = supabase.table("participants").select("*").eq("qr_token", token).execute()
    
    if not response.data:
        return JsonResponse({'error': 'Invalid QR code'}, status=404)
    
    participant = response.data[0]
    
    if participant.get('food_claimed'):
        return JsonResponse({
            'valid': False,
            'message': 'Food already claimed',
            'claimed_at': participant.get('claimed_at'),
        })
    
    return JsonResponse({
        'valid': True,
        'message': 'Valid QR code',
        'participant': {
            'id': participant['id'],
            'name': participant['name'],
            'email': participant['email'],
        }
    })

@login_required
def claim_food(request):
    """Claim food for participant"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    
    try:
        data = json.loads(request.body)
        token = data.get('token')
    except:
        return JsonResponse({'error': 'Invalid data'}, status=400)
    
    if not token:
        return JsonResponse({'error': 'Token required'}, status=400)
    
    supabase = get_supabase()
    
    # Get participant
    response = supabase.table("participants").select("*").eq("qr_token", token).execute()
    
    if not response.data:
        return JsonResponse({'error': 'Invalid QR code'}, status=404)
    
    participant = response.data[0]
    
    if participant.get('food_claimed'):
        return JsonResponse({
            'success': False,
            'message': 'Food already claimed',
        }, status=400)
    
    # Use one timestamp for both the participant record and the audit row.
    claimed_at = timezone.now().isoformat()
    update_data = {
        'food_claimed': True,
        'claimed_at': claimed_at,
    }
    
    update_response = supabase.table("participants").update(update_data).eq("id", participant['id']).execute()
    if not update_response.data:
        return JsonResponse({'error': 'Participant could not be updated'}, status=409)
    
    # Keep a separate audit record for each successful distribution.
    claim_data = {
        'participant_id': participant['id'],
        'claimed_by_admin': request.user.username,
        'claimed_at': claimed_at,
    }
    claim_response = supabase.table("claims").insert(claim_data).execute()
    if not claim_response.data:
        return JsonResponse({'error': 'Claim was not recorded'}, status=502)
    
    return JsonResponse({
        'success': True,
        'message': f'Food claimed for {participant["name"]}',
        'participant': {
            'id': participant['id'],
            'name': participant['name'],
            'email': participant.get('email'),
            'claimed_at': update_data['claimed_at'],
        },
    })