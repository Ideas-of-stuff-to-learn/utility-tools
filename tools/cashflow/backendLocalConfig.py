import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

LOCAL_DEV              = os.environ.get('VITE_LOCAL_DEV', 'false').lower() == 'true'
LOCAL_IP               = os.environ.get('LOCAL_IP', '')
BACKEND_PORT           = int(os.environ.get('BACKEND_PORT', 5050))
ADMIN_ACCOUNT_MIN_LEVEL    = int(os.environ.get('ADMIN_ACCOUNT_MIN_LEVEL', 30))
ADMIN_LEVEL_OVERRIDE_MIN   = int(os.environ.get('ADMIN_LEVEL_OVERRIDE_MIN', 80))
ADMIN_AUDIT_MIN_LEVEL      = int(os.environ.get('ADMIN_AUDIT_MIN_LEVEL', 60))

CORS_ORIGINS = (
    [r"http://localhost(:\d+)?$", rf"http://{LOCAL_IP}(:\d+)?$"]
    if LOCAL_DEV
    else ["https://ideas-of-stuff-to-learn.github.io"]
)
print(f"[startup] LOCAL_DEV={LOCAL_DEV}, LOCAL_IP={LOCAL_IP}, BACKEND_PORT={BACKEND_PORT}, CORS_ORIGINS={CORS_ORIGINS}", flush=True)
