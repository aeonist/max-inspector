from datetime import timedelta

from sqlalchemy.orm import Session

from config import SHIFT_MAX_HOURS
from models import Defect, Employee, Shift, ShiftTask
from services.checklist import duties_for_position
from utils.timefmt import utcnow


# Current shift of an employee; a shift forgotten open is closed after SHIFT_MAX_HOURS
def active_shift(db: Session, employee: Employee) -> Shift | None:
    shift = (
        db.query(Shift)
        .filter(Shift.employee_id == employee.id, Shift.ended_at.is_(None))
        .order_by(Shift.id.desc())
        .first()
    )
    if shift and utcnow() - shift.started_at > timedelta(hours=SHIFT_MAX_HOURS):
        shift.ended_at = shift.started_at + timedelta(hours=SHIFT_MAX_HOURS)
        db.commit()
        return None
    return shift


# Open a shift; a repeated check-in during a shift keeps its progress
def open_shift(db: Session, employee: Employee, geo_status: str, distance: float | None = None) -> tuple[Shift, bool]:
    shift = active_shift(db, employee)
    if shift:
        if distance is not None:
            shift.geo_distance = distance
            shift.geo_status = geo_status
            db.commit()
        return shift, False
    shift = Shift(
        employee_id=employee.id,
        facility_id=employee.facility_id,
        geo_status=geo_status,
        geo_distance=distance,
    )
    db.add(shift)
    db.commit()
    return shift, True


# Progress of a shift: done duties, all duties, violations fixed during it
def shift_stats(db: Session, employee: Employee, shift: Shift) -> dict:
    duties = duties_for_position(employee.facility, employee.position)
    duty_ids = {d["id"] for d in duties}
    done = {t.item_id for t in shift.tasks} & duty_ids
    fixed = (
        db.query(Defect)
        .filter(
            Defect.fixed_by_employee_id == employee.id,
            Defect.fixed_at.isnot(None),
            Defect.fixed_at >= shift.started_at,
        )
        .count()
    )
    return {"done": len(done), "total": len(duty_ids), "fixed": fixed}


def close_shift(db: Session, employee: Employee, shift: Shift) -> dict:
    stats = shift_stats(db, employee, shift)
    shift.ended_at = utcnow()
    db.commit()
    return stats


def set_task_done(db: Session, shift: Shift, item_id: int, done: bool, photo_url: str | None = None) -> None:
    task = db.query(ShiftTask).filter(ShiftTask.shift_id == shift.id, ShiftTask.item_id == item_id).first()
    if done:
        if not task:
            task = ShiftTask(shift_id=shift.id, item_id=item_id)
            db.add(task)
        if photo_url:
            task.photo_url = photo_url
    elif task:
        db.delete(task)
    db.commit()
