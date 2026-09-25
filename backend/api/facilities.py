import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Employee, Facility
from schemas.facility import (
    AddStaffRequest,
    DefectNotifyRequest,
    FacilityAuditRequest,
    FacilityAuthRequest,
    FacilityUpdateRequest,
)
from services.notifier import (
    notify_employees_defect,
    notify_owner_facility_saved,
)
from utils.generators import generate_unique_employee_code
from utils.shifts import expire_old_shifts

router = APIRouter(prefix="/api/facility", tags=["facilities"])
logger = logging.getLogger(__name__)


# Get facility info
@router.get("/{code}")
def get_facility(code: str, db: Session = Depends(get_db)):
    fac = db.query(Facility).filter(Facility.code == code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    expire_old_shifts(db, fac.id)

    staff = []
    for emp in fac.employees:
        staff.append(
            {
                "id": emp.id,
                "personal_code": emp.personal_code,
                "full_name": emp.full_name,
                "position": emp.position,
                "user_id": emp.user_id,
                "shift_active": emp.shift_active,
                "shift_started_at": (
                    emp.shift_started_at.strftime("%H:%M")
                    if emp.shift_started_at
                    else None
                ),
                "last_geo_distance": emp.last_geo_distance,
                "completed_tasks": json.loads(emp.completed_tasks_json or "[]"),
                "task_photos": json.loads(emp.task_photos_json or "{}"),
            }
        )

    return {
        "code": fac.code,
        "name": fac.name,
        "address": fac.address,
        "geo_lat": fac.geo_lat,
        "geo_lon": fac.geo_lon,
        "geo_required": fac.geo_required,
        "staff_count": fac.staff_count,
        "positions": json.loads(fac.positions_json or "[]"),
        "duties": json.loads(fac.duties_json or "[]"),
        "audit_answers": json.loads(fac.audit_answers_json or "{}"),
        "audit_progress": fac.audit_progress or 0,
        "staff": staff,
    }


# Save facility audit answers and progress
@router.post("/{code}/audit")
def update_facility_audit(
    code: str, payload: FacilityAuditRequest, db: Session = Depends(get_db)
):
    fac = db.query(Facility).filter(Facility.code == code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    fac.audit_answers_json = json.dumps(payload.audit_answers, ensure_ascii=False)
    fac.audit_progress = payload.audit_progress
    db.commit()

    return {"status": "ok", "audit_progress": fac.audit_progress}


# Verify facility auth
@router.post("/auth")
def verify_facility_auth(
    payload: FacilityAuthRequest, db: Session = Depends(get_db)
):
    fac = db.query(Facility).filter(Facility.code == payload.code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")
    if fac.admin_pin != payload.admin_pin:
        raise HTTPException(status_code=403, detail="Неверный ПИН-код администратора")
    return {"status": "ok", "code": fac.code, "name": fac.name}


# Update facility
@router.post("/{code}")
async def update_facility(
    code: str, payload: FacilityUpdateRequest, db: Session = Depends(get_db)
):
    fac = db.query(Facility).filter(Facility.code == code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    if payload.name:
        fac.name = payload.name
    fac.address = payload.address
    fac.geo_lat = payload.geo_lat
    fac.geo_lon = payload.geo_lon
    fac.geo_required = payload.geo_required
    if payload.admin_pin:
        fac.admin_pin = payload.admin_pin
    fac.staff_count = payload.staff_count
    fac.positions_json = json.dumps(payload.positions, ensure_ascii=False)
    fac.duties_json = json.dumps(payload.duties, ensure_ascii=False)

    if payload.staff_list:
        for item in payload.staff_list:
            existing = (
                db.query(Employee)
                .filter(
                    Employee.facility_id == fac.id,
                    Employee.full_name == item.full_name,
                )
                .first()
            )
            if not existing:
                code_emp = generate_unique_employee_code(db, fac.id)
                new_emp = Employee(
                    facility_id=fac.id,
                    personal_code=code_emp,
                    full_name=item.full_name,
                    position=item.position,
                )
                db.add(new_emp)

    db.commit()

    if fac.owner_user_id:
        await notify_owner_facility_saved(fac.owner_user_id, fac.code, fac.name)

    return {"status": "ok", "code": fac.code}


# Add staff member
@router.post("/{code}/staff")
def add_staff_member(
    code: str, payload: AddStaffRequest, db: Session = Depends(get_db)
):
    fac = db.query(Facility).filter(Facility.code == code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    pcode = generate_unique_employee_code(db, fac.id)
    emp = Employee(
        facility_id=fac.id,
        personal_code=pcode,
        full_name=payload.full_name,
        position=payload.position,
    )
    db.add(emp)
    db.commit()

    return {
        "status": "ok",
        "id": emp.id,
        "personal_code": emp.personal_code,
        "full_name": emp.full_name,
        "position": emp.position,
    }


# Unlink staff member
@router.post("/{code}/staff/{employee_id}/unlink")
def unlink_staff_member(
    code: str, employee_id: int, db: Session = Depends(get_db)
):
    fac = db.query(Facility).filter(Facility.code == code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    emp = (
        db.query(Employee)
        .filter(Employee.id == employee_id, Employee.facility_id == fac.id)
        .first()
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    emp.user_id = None
    emp.shift_active = False
    emp.shift_ended_at = datetime.utcnow()
    db.commit()

    return {"status": "ok", "employee_id": emp.id}


# Broadcast defect alert to facility employees
@router.post("/{code}/notify-defect")
async def notify_facility_defect(
    code: str, payload: DefectNotifyRequest, db: Session = Depends(get_db)
):
    fac = db.query(Facility).filter(Facility.code == code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    await notify_employees_defect(
        db=db,
        facility_id=fac.id,
        facility_name=fac.name,
        duty_title=payload.title,
        violation=payload.violation,
        remediation=payload.remediation,
        assigned_role=payload.assigned_role or "Персонал кухни / зала",
        reporter_name=payload.reporter_name or "Контролер / Руководитель",
    )
    return {"status": "ok", "message": "Оповещение отправлено сотрудникам"}

