from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import bad_request, get_employee, uploaded_photos
from database import get_db
from models import Defect, Employee
from schemas import (
    ClaimRequest,
    DefectFixRequest,
    EndShiftRequest,
    ProblemRequest,
    TaskRequest,
)
from services import audit, notifier
from services.auth import CurrentUser, current_user
from services.checklist import duties_for_employee
from services.facility import active_staff, employee_of, facility_by_invite
from services.shifts import (
    active_shift,
    close_shift,
    open_shift,
    set_task_done,
    shift_stats,
)
from utils.timefmt import format_local_time

router = APIRouter(prefix="/api", tags=["staff"])


# Invite page: facility name and free staff profiles to pick from
@router.get("/join/{token}")
def get_join(token: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    facility = facility_by_invite(db, token)
    if not facility:
        raise HTTPException(status_code=404, detail="Приглашение не найдено или устарело")
    me = employee_of(db, user.user_id)
    return {
        "facility_name": facility.name,
        "is_owner": facility.owner_user_id == user.user_id,
        "already_member": bool(me and me.facility_id == facility.id),
        "other_facility": me.facility.name if me and me.facility_id != facility.id else None,
        "free": [
            {"id": e.id, "full_name": e.full_name, "position": e.position}
            for e in active_staff(db, facility)
            if not e.user_id
        ],
    }


@router.post("/join/{token}")
async def post_join(
    token: str, payload: ClaimRequest, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
):
    facility = facility_by_invite(db, token)
    if not facility:
        raise HTTPException(status_code=404, detail="Приглашение не найдено или устарело")
    if employee_of(db, user.user_id):
        raise HTTPException(status_code=409, detail="Ваш аккаунт уже привязан к сотруднику")
    emp = db.get(Employee, payload.employee_id)
    if not emp or emp.facility_id != facility.id or emp.archived:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    if emp.user_id:
        raise HTTPException(status_code=409, detail="Этот профиль уже занят")
    emp.user_id = user.user_id
    db.commit()
    await notifier.send_staff_joined(facility, emp)
    return {"full_name": emp.full_name, "position": emp.position, "facility_name": facility.name}


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
        "facility": {"name": facility.name, "geo_required": bool(facility.geo_required)},
        "shift": (
            {
                "started": format_local_time(shift.started_at),
                "geo_status": shift.geo_status,
                "geo_distance": shift.geo_distance,
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


# Without geo control the shift can start right from the mini-app
@router.post("/shift/start")
def start_shift(emp: Employee = Depends(get_employee), db: Session = Depends(get_db)):
    if emp.facility.geo_required:
        raise HTTPException(status_code=400, detail="Смена начинается в чате: отправьте геопозицию на месте")
    open_shift(db, emp, "not_required")
    return _shift_payload(db, emp)


@router.post("/shift/tasks/{item_id}")
def post_task(item_id: int, payload: TaskRequest, emp: Employee = Depends(get_employee), db: Session = Depends(get_db)):
    shift = active_shift(db, emp)
    if not shift:
        raise HTTPException(status_code=409, detail="Смена не начата. Начните её в чате с ботом")
    if item_id not in {d["id"] for d in duties_for_employee(emp)}:
        raise HTTPException(status_code=404, detail="Это не ваша задача")
    set_task_done(db, shift, item_id, payload.done, uploaded_photos(payload.photos))
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
