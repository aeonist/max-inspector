import uuid
from pathlib import Path
from fastapi import APIRouter, File, UploadFile
from config import UPLOADS_DIR

router = APIRouter(prefix="/api", tags=["uploads"])


# Upload task photo
@router.post("/upload")
async def upload_photo(file: UploadFile = File(...)):
    filename = f"{uuid.uuid4().hex}_{file.filename}"
    upload_path = UPLOADS_DIR / filename
    content = await file.read()
    with open(upload_path, "wb") as f:
        f.write(content)
    return {"status": "ok", "url": f"/uploads/{filename}"}
