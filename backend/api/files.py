from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db
from models import Facility
from services.auth import verify_file_token
from services.report import build_act_pdf

router = APIRouter(prefix="/api/files", tags=["files"])


def _facility(db: Session, token: str, kind: str) -> Facility:
    facility_id = verify_file_token(token, kind)
    facility = db.get(Facility, facility_id) if facility_id else None
    if not facility:
        raise HTTPException(status_code=404, detail="Ссылка устарела, сформируйте документ ещё раз")
    return facility


def _pdf(content: bytes, file_name: str) -> Response:
    disposition = f"attachment; filename*=UTF-8''{quote(file_name)}"
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": disposition})


@router.get("/report/{token}.pdf")
def get_report(token: str, db: Session = Depends(get_db)):
    facility = _facility(db, token, "report")
    return _pdf(build_act_pdf(db, facility), f"Акт внутреннего аудита — {facility.name}.pdf")
