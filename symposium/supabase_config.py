import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def get_supabase():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[:-len("/rest/v1")]
    # Django is the only caller, so use the server key for RLS-protected writes.
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    return create_client(url, key)