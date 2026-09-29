import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from config import UPLOAD_MAX_BYTES, UPLOAD_MAX_SIDE_PX, UPLOADS_DIR
from services.auth import CurrentUser, current_user

router = APIRouter(prefix="/api", tags=["uploads"])

# MPO is what some phone cameras produce for JPEG shots
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "MPO"}


# Upload a photo: only images, re-encoded to JPEG with EXIF (incl. GPS) stripped.
# A plain def: FastAPI runs it in a thread, so decoding a big photo does not stall the bot
@router.post("/upload")
def upload_photo(file: UploadFile = File(...), user: CurrentUser = Depends(current_user)):
    content = file.file.read(UPLOAD_MAX_BYTES + 1)
    if len(content) > UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Фото больше 10 МБ, сделайте снимок поменьше")
    try:
        image = Image.open(io.BytesIO(content))
        if image.format not in ALLOWED_FORMATS:
            raise HTTPException(status_code=415, detail="Нужна фотография в формате JPG, PNG или WEBP")
        # JPEG decodes straight at a reduced scale: much faster for big camera shots
        image.draft("RGB", (UPLOAD_MAX_SIDE_PX, UPLOAD_MAX_SIDE_PX))
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Image.DecompressionBombError:
        raise HTTPException(status_code=413, detail="Слишком большое разрешение фото, сделайте снимок поменьше")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=415, detail="Не получилось прочитать фото, попробуйте ещё раз")

    image.thumbnail((UPLOAD_MAX_SIDE_PX, UPLOAD_MAX_SIDE_PX))
    filename = f"{uuid.uuid4().hex}.jpg"
    image.save(UPLOADS_DIR / filename, "JPEG", quality=82, optimize=True)
    return {"url": f"/uploads/{filename}"}
