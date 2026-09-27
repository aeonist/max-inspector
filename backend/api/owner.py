from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import bad_request, get_owner_facility, uploaded_photos
from database import get_db
from max_bot.instance import bot_username
from models import Defect, Employee, Facility, InspectionSession
from schemas import (
    AnswerRequest,
    DefectResolveRequest,
    DefectReturnRequest,
    NewStaff,
    SetupRequest,
    ShiftRoleRequest,
    StaffUpdateRequest,
)
from services import audit, notifier
from services.auth import CurrentUser, current_user, make_file_token
from services.facility import (
    add_employee,
    archive_employee,
    detach_facility,
    ensure_invite_token,
    facility_state,
    save_setup,
    set_owner_works_shift,
    staff_to_dict,
)
from services.report import qr_svg
from utils.timefmt import utcnow

router = APIRouter(prefix="/api/owner", tags=["owner"])

# The cabinet can stay open a while before the owner taps "download"
FILE_LINK_TTL_S = 6 * 3600


def invite_url(db: Session, facility: Facility) -> str | None:
    username = bot_username()
    if not username:
        return None
    return f"https://max.ru/{username}?start=join_{ensure_invite_token(db, facility)}"


# Links for WebApp.downloadFile: the MAX client downloads without our headers,
# and the link must be ready at click time (no await between click and download)
def _file_links(facility: Facility) -> dict:
    return {
        "report": {
            "url": f"/api/files/report/{make_file_token('report', facility.id, FILE_LINK_TTL_S)}.pdf",
            "file_name": f"Акт внутреннего аудита — {facility.name}.pdf",
        },
        "poster": {
            "url": f"/api/files/poster/{make_file_token('poster', facility.id, FILE_LINK_TTL_S)}.pdf",
            "file_name": f"QR для сотрудников — {facility.name}.pdf",
        },
    }


def _state(db: Session, facility: Facility) -> dict:
    state = facility_state(db, facility, invite_url(db, facility))
    state["files"] = _file_links(facility)
    return state


def _staff_member(db: Session, facility: Facility, employee_id: int) -> Employee:
    emp = db.get(Employee, employee_id)
    if not emp or emp.facility_id != facility.id or emp.archived:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return emp


def _defect(db: Session, facility: Facility, defect_id: int) -> Defect:
    defect = db.get(Defect, defect_id)
    if not defect or defect.facility_id != facility.id:
        raise HTTPException(status_code=404, detail="Нарушение не найдено")
    return defect


@router.get("/state")
def get_state(facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    return _state(db, facility)


# Setup wizard and settings
@router.put("/setup")
async def put_setup(
    payload: SetupRequest,
    facility: Facility = Depends(get_owner_facility),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
):
    first_time = not facility.setup_done
    try:
        save_setup(db, facility, payload.model_dump(), user.full_name)
    except ValueError as e:
        raise bad_request(e)
    if first_time and facility.geo_required and not facility.has_coords:
        await notifier.send_facility_geo_request(facility)
    return _state(db, facility)


# "Я тоже работаю на смене" from the role switch: one account tries both roles
@router.put("/shift-role")
def put_shift_role(
    payload: ShiftRoleRequest,
    facility: Facility = Depends(get_owner_facility),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
):
    if payload.works and payload.position not in facility.positions:
        raise HTTPException(status_code=400, detail="Выберите должность из списка")
    # Keep the name the owner chose in the wizard; MAX profile name only for a new profile
    name = payload.name or ("" if audit.owner_employee(db, facility, include_archived=True) else user.full_name)
    try:
        set_owner_works_shift(db, facility, payload.works, payload.position, name)
    except ValueError as e:
        raise bad_request(e)
    return _state(db, facility)


# Ask the owner for the facility location in the chat (new place or first time)
@router.post("/geo/request")
async def request_geo(facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    facility.geo_pending = True
    db.commit()
    sent = await notifier.send_facility_geo_request(facility)
    return {"sent": sent}


# "Delete and start over" (e.g. after the demo cafe); history is kept
@router.delete("/facility")
def delete_facility(facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    detach_facility(db, facility)
    return {"status": "ok"}


@router.post("/staff")
def post_staff(payload: NewStaff, facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    if payload.position not in facility.positions:
        raise HTTPException(status_code=400, detail="Сначала добавьте такую должность")
    try:
        emp = add_employee(db, facility, payload.full_name, payload.position)
    except ValueError as e:
        raise bad_request(e)
    return staff_to_dict(db, emp)


@router.patch("/staff/{employee_id}")
def patch_staff(
    employee_id: int,
    payload: StaffUpdateRequest,
    facility: Facility = Depends(get_owner_facility),
    db: Session = Depends(get_db),
):
    emp = _staff_member(db, facility, employee_id)
    if payload.position is not None:
        if payload.position not in facility.positions:
            raise HTTPException(status_code=400, detail="Нет такой должности")
        emp.position = payload.position
    if payload.full_name:
        emp.full_name = " ".join(payload.full_name.split())
    db.commit()
    return staff_to_dict(db, emp)


@router.delete("/staff/{employee_id}")
def delete_staff(employee_id: int, facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    emp = _staff_member(db, facility, employee_id)
    if emp.is_owner:
        raise HTTPException(status_code=400, detail="Это вы. Снимите отметку «Я тоже работаю на смене» в настройках")
    archive_employee(db, emp)
    db.commit()
    return {"status": "ok"}


# Detach a MAX account so the person can join again (new phone, wrong profile chosen)
@router.post("/staff/{employee_id}/unlink")
def unlink_staff(employee_id: int, facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    emp = _staff_member(db, facility, employee_id)
    if emp.is_owner:
        raise HTTPException(status_code=400, detail="Свой аккаунт отвязать нельзя")
    emp.user_id = None
    db.commit()
    return staff_to_dict(db, emp)


@router.get("/audit")
def get_audit(facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    session = audit.current_session(db, facility)
    answers = audit.answers_by_item(db, session)
    return {
        "answers": {
            str(item_id): {"status": a.status, "photos": a.photos, "source": a.source}
            for item_id, a in answers.items()
        },
        "summary": audit.summary(db, facility),
    }


# Answer a checklist question; a violation goes straight to the responsible staff
@router.put("/audit/{item_id}")
async def put_answer(
    item_id: int,
    payload: AnswerRequest,
    facility: Facility = Depends(get_owner_facility),
    db: Session = Depends(get_db),
):
    photos = uploaded_photos(payload.photos)
    try:
        answer, defect, _ = audit.set_answer(db, facility, item_id, payload.status, photos, payload.assign_to)
    except ValueError as e:
        raise bad_request(e)
    delivered = await notifier.send_defect_card(db, facility, defect) if defect else []
    return {
        "answer": {"status": answer.status, "photos": answer.photos, "source": answer.source},
        "defect": audit.defect_to_dict(defect, facility) if defect else None,
        "delivered": delivered,
        "summary": audit.summary(db, facility),
    }


@router.post("/audit/finish")
def finish_audit(facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    session = audit.current_session(db, facility)
    session.finished_at = utcnow()
    session.status = "finished"
    db.commit()
    return audit.summary(db, facility)


# Start a fresh audit; unresolved violations stay in work
@router.post("/audit/restart")
def restart_audit(facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    db.add(InspectionSession(facility_id=facility.id, status="in_progress"))
    db.commit()
    audit.sync_features(db, facility)
    return audit.summary(db, facility)


@router.post("/defects/{defect_id}/accept")
async def accept_defect(defect_id: int, facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    defect = _defect(db, facility, defect_id)
    if defect.status != "fixed":
        raise HTTPException(status_code=400, detail="Исправление ещё не прислали")
    audit.accept_defect(db, defect)
    await notifier.send_fix_accepted(defect.fixed_by, defect)
    return {"defect": audit.defect_to_dict(defect, facility), "summary": audit.summary(db, facility)}


@router.post("/defects/{defect_id}/return")
async def return_defect(
    defect_id: int,
    payload: DefectReturnRequest,
    facility: Facility = Depends(get_owner_facility),
    db: Session = Depends(get_db),
):
    defect = _defect(db, facility, defect_id)
    try:
        audit.return_defect(db, defect, payload.reason.strip() or "Нужно переделать")
    except ValueError as e:
        raise bad_request(e)
    await notifier.send_fix_returned(defect.fixed_by, defect)
    return {"defect": audit.defect_to_dict(defect, facility), "summary": audit.summary(db, facility)}


# The owner closes their own task (documents, premises) directly
@router.post("/defects/{defect_id}/resolve")
def resolve_defect(
    defect_id: int,
    payload: DefectResolveRequest,
    facility: Facility = Depends(get_owner_facility),
    db: Session = Depends(get_db),
):
    defect = _defect(db, facility, defect_id)
    try:
        audit.resolve_by_owner(db, defect, uploaded_photos(payload.photos))
    except ValueError as e:
        raise bad_request(e)
    return {"defect": audit.defect_to_dict(defect, facility), "summary": audit.summary(db, facility)}


@router.get("/invite")
def get_invite(facility: Facility = Depends(get_owner_facility), db: Session = Depends(get_db)):
    url = invite_url(db, facility)
    if not url:
        raise HTTPException(status_code=503, detail="Бот ещё не готов, попробуйте через минуту")
    return {"url": url, "qr_svg": qr_svg(url), "files": _file_links(facility)}
