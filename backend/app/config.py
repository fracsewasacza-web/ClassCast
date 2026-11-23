"""Settings, read from the .env file in the project folder."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent      # the classcast-backend folder
load_dotenv(ROOT / ".env")

FIREBASE_KEY_PATH = ROOT / os.getenv("FIREBASE_KEY_PATH", "serviceAccountKey.json")
FIREBASE_WEB_API_KEY = os.getenv("FIREBASE_WEB_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")       # only for reading timetable images
ALLOWED_ORIGINS =[o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500,null").split(",") if o.strip()]
