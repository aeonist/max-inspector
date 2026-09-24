import os
from pathlib import Path
from dotenv import load_dotenv

# Load env variables
load_dotenv()

# Base directories
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
UPLOADS_DIR = BACKEND_DIR / "uploads"
FRONTEND_DIR = PROJECT_ROOT / "frontend"

# Ensure uploads directory exists
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Bot and WebApp settings
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEBAPP_BASE = os.getenv("WEBAPP_URL", "https://46.29.114.201.sslip.io")
LAW_URL = "https://www.consultant.ru/document/cons_doc_LAW_358890/578f4477c77c1d76378415d86ef8e3648e42994c/"
