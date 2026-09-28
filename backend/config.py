import os
from pathlib import Path

from dotenv import load_dotenv

# Load env variables
load_dotenv()

# Base directories
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
CHECKLIST_PATH = FRONTEND_DIR / "checklists.json"
FONTS_DIR = BACKEND_DIR / "assets" / "fonts"

# Data locations (a Docker volume in production)
DATA_DIR = Path(os.getenv("DATA_DIR", str(PROJECT_ROOT)))
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", str(BACKEND_DIR / "uploads")))
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(DATA_DIR / "inspector.db")))

# Ensure data directories exist
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

# Bot and WebApp settings
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
WEBAPP_BASE = os.getenv("WEBAPP_URL", "http://localhost:8000").rstrip("/")
# Bot username for deep links and OpenAppButton; resolved via get_me() when empty
BOT_USERNAME = os.getenv("BOT_USERNAME", "")
# "openapp": buttons open the mini-app bound to the bot (initData auth)
# "link": buttons open WEBAPP_URL with a signed token (until the mini-app is bound)
MINIAPP_MODE = os.getenv("MINIAPP_MODE", "link").strip().lower()
# Start bot polling together with the API (disabled in tests).
# Without a token the API and the mini-app still start; the bot stays off
BOT_POLLING = os.getenv("BOT_POLLING", "1") == "1" and bool(BOT_TOKEN)

# Shifts older than this are closed automatically
SHIFT_MAX_HOURS = 12
# Accept initData not older than this (the mini-app can stay open for a work day)
INIT_DATA_MAX_AGE_S = 48 * 3600
# Signed links in bot messages stay valid this long
LINK_TOKEN_TTL_S = 30 * 24 * 3600
# Uploaded photo limits
UPLOAD_MAX_BYTES = 10 * 1024 * 1024
UPLOAD_MAX_SIDE_PX = 1600

# Readiness rule: index threshold and no open violations
READY_INDEX_PERCENT = 90
