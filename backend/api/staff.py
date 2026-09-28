from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import bad_request, get_employee, uploaded_photos
from database import get_db
from models import Defect, Employee
from schemas import (
    DefectFixRequest,
    EndShiftRequest,
    ProblemRequest,
    StartShiftRequest,
    TaskRequest,
)
from services import audit, notifier
from services.auth import CurrentUser, current_user
from services.checklist import duties_for_employee
from services.facility import (
    checkin_code_valid,
    claim_invite,
    employee_by_invite,
    employee_of,
)
from services.shifts import (
    active_shift,
    close_shift,
    open_shift,
    set_task_done,
    shift_stats,
    task_photos,
)
from utils.timefmt import format_local_time

router = APIRouter(prefix="/api", tags=["staff"])


# Personal invite page: who the link is for and where
@router.get("/invite/{token}")
def get_invite(token: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    emp = employee_by_invite(db, token)
    if not emp:
        raise HTTPException(status_code=404, detail="Приглашение уже использовано или устарело. Попросите руководителя прислать новое")
    me = employee_of(db, user.user_id)
    return {
        "facility_name": emp.facility.name,
        "full_name": emp.full_name,
        "position": emp.position,
        "is_owner": emp.facility.owner_user_id == user.user_id,
        "other_facility": me.facility.name if me else None,
    }


@router.post("/invite/{token}")
async def accept_invite(token: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    emp = employee_by_invite(db, token)
    if not emp:
        raise HTTPException(status_code=404, detail="Приглашение уже использовано или устарело. Попросите руководителя прислать новое")
    try:
        claim_invite(db, emp, user.user_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await notifier.send_staff_joined(emp.facility, emp)
    return {"full_name": emp.full_name, "position": emp.position, "facility_name": emp.facility.name}


def _shift_payload(db: Session, emp: Employee) -> dict:
    facility = emp.facility
    shift = active_shift(db, emp)
    done = {t.item_id: t.photos for t in shift.tasks} if shift else {}
    duties = duties_for_employee(emp)
    for duty in duties:
        duty["done"] = duty["id"] in done
        duty["photos"] = done.get(duty["id"], [])
    defects = [audit.defect_to_dict(d, facility) for d in audit.defects_for_employee(db, emp)]
    return {
        "employee": {"full_name": emp.full_name, "position": emp.position, "is_owner": bool(emp.is_owner)},
        "facility": {
            "name": facility.name,
            "qr_checkin": bool(facility.qr_checkin),
            "task_photo_required": facility.settings["task_photo_required"],
        },
        "shift": (
            {
                "started": format_local_time(shift.started_at),
                "checkin": shift.checkin,
                **shift_stats(db, emp, shift),
            }
            if shift
            else None
        ),
        "duties": duties,
        "defects": defects,
    }


@router.get("/shift")
def get_shift(emp: Employee = Depends(get_employee), db: Session = Depends(get_db)):
    return _shift_payload(db, emp)


# Start a shift: with QR check-in on, only by scanning the workplace QR (MAX camera scanner)
@router.post("/shift/start")
def start_shift(payload: StartShiftRequest | None = None, emp: Employee = Depends(get_employee), db: Session = Depends(get_db)):
    facility = emp.facility
    if facility.qr_checkin and not checkin_code_valid(facility, payload.code if payload else None):
        raise HTTPException(status_code=403, detail="Это не QR «Начало смены» вашего заведения")
    open_shift(db, emp, "qr" if facility.qr_checkin else "button")
    return _shift_payload(db, emp)


@router.post("/shift/tasks/{item_id}")
def post_task(item_id: int, payload: TaskRequest, emp: Employee = Depends(get_employee), db: Session = Depends(get_db)):
    shift = active_shift(db, emp)
    if not shift:
        raise HTTPException(status_code=409, detail="Смена не начата. Начните её в чате с ботом")
    if item_id not in {d["id"] for d in duties_for_employee(emp)}:
        raise HTTPException(status_code=404, detail="Это не ваша задача")
    photos = uploaded_photos(payload.photos)
    photo_required = emp.facility.settings["task_photo_required"]
    if payload.done and photo_required and not photos and not task_photos(db, shift, item_id):
        raise HTTPException(status_code=400, detail="Приложите фото выполнения: так настроено в заведении")
    set_task_done(db, shift, item_id, payload.done, photos)
    return {"stats": shift_stats(db, emp, shift)}


@router.post("/shift/end")
def end_shift(payload: EndShiftRequest, emp: Employee = Depends(get_employee), db: Session = Depends(get_db)):
    shift = active_shift(db, emp)
    if not shift:
        raise HTTPException(status_code=409, detail="Смена уже закрыта")
    stats = shift_stats(db, emp, shift)
    left = stats["total"] - stats["done"]
    if left > 0 and not payload.force:
        return {"closed": False, "left": left, "stats": stats}
    return {"closed": True, "left": left, "stats": close_shift(db, emp, shift)}


# Employee sends the "after" photo; the owner gets before/after to accept or return
@router.post("/defects/{defect_id}/fix")
async def fix_defect(
    defect_id: int, payload: DefectFixRequest, emp: Employee = Depends(get_employee), db: Session = Depends(get_db)
):
    defect = db.get(Defect, defect_id)
    if not defect or defect.facility_id != emp.facility_id or not audit.is_for_employee(defect, emp):
        raise HTTPException(status_code=404, detail="Задача не найдена")
    try:
        audit.mark_fixed(db, defect, emp, uploaded_photos(payload.photos, required=True))
    except ValueError as e:
        raise bad_request(e)
    await notifier.send_review_card(emp.facility, defect, emp)
    return {"defect": audit.defect_to_dict(defect, emp.facility)}


# "Something is broken": goes to the owner as their task
@router.post("/problems")
async def report_problem(payload: ProblemRequest, emp: Employee = Depends(get_employee), db: Session = Depends(get_db)):
    text = " ".join(payload.text.split())
    defect = Defect(
        facility_id=emp.facility_id,
        kind="problem",
        title=text[:120],
        comment=text,
        to_owner=True,
        status="open",
        reported_by_employee_id=emp.id,
    )
    defect.before_photos = uploaded_photos(payload.photos)
    db.add(defect)
    db.commit()
    await notifier.send_problem(emp.facility, defect, emp)
    return {"status": "ok"}
