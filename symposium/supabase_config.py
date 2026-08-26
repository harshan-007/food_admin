import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def _create_supabase_client(key):
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[:-len("/rest/v1")]
    return create_client(url, key)


def get_supabase():
    return _create_supabase_client(os.getenv("SUPABASE_KEY"))


def get_supabase_admin():
    return _create_supabase_client(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))