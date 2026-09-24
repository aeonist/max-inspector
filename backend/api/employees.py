import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Employee, Facility
from schemas.employee import (
    EmployeeClaimRequest,
    EmployeeRegisterRequest,
    EmployeeTasksRequest,
)
from services.notifier import notify_employee_registered
from utils.generators import generate_unique_employee_code
from utils.shifts import expire_old_shifts

router = APIRouter(prefix="/api/employee", tags=["employees"])


# Register employee
@router.post("/register")
async def register_employee(
    payload: EmployeeRegisterRequest, db: Session = Depends(get_db)
):
    fac = db.query(Facility).filter(Facility.code == payload.code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    emp = db.query(Employee).filter(Employee.user_id == payload.user_id).first()
    if not emp:
        pcode = generate_unique_employee_code(db, fac.id)
        emp = Employee(
            facility_id=fac.id,
            personal_code=pcode,
            user_id=payload.user_id,
            full_name=payload.full_name,
            position=payload.position,
        )
        db.add(emp)
    else:
        emp.facility_id = fac.id
        emp.full_name = payload.full_name
        emp.position = payload.position
    db.commit()

    if payload.user_id:
        await notify_employee_registered(
            payload.user_id, emp.full_name, emp.position, fac.code
        )

    return {"status": "ok", "employee_id": emp.id}


# Claim employee profile
@router.post("/claim")
async def claim_employee(
    payload: EmployeeClaimRequest, db: Session = Depends(get_db)
):
    fac = db.query(Facility).filter(Facility.code == payload.code).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    emp = (
        db.query(Employee)
        .filter(Employee.id == payload.employee_id, Employee.facility_id == fac.id)
        .first()
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    emp.user_id = payload.user_id
    db.commit()

    if payload.user_id:
        await notify_employee_registered(
            payload.user_id, emp.full_name, emp.position, fac.name
        )

    return {
        "status": "ok",
        "employee_id": emp.id,
        "full_name": emp.full_name,
        "position": emp.position,
    }


# Get employee info
@router.get("/{user_id}")
def get_employee(user_id: int, db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.user_id == user_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    if emp.facility_id:
        expire_old_shifts(db, emp.facility_id)

    fac = emp.facility
    return {
        "user_id": emp.user_id,
        "personal_code": emp.personal_code,
        "full_name": emp.full_name,
        "position": emp.position,
        "facility_code": fac.code if fac else "",
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


# End shift
@router.post("/{user_id}/shift/end")
def end_shift(user_id: int, db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.user_id == user_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    emp.shift_active = False
    emp.shift_ended_at = datetime.utcnow()
    db.commit()

    return {
        "status": "ok",
        "shift_ended_at": emp.shift_ended_at.strftime("%H:%M"),
    }


# Save employee tasks
@router.post("/{user_id}/tasks")
def update_employee_tasks(
    user_id: int, payload: EmployeeTasksRequest, db: Session = Depends(get_db)
):
    emp = db.query(Employee).filter(Employee.user_id == user_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    if not emp.shift_active:
        raise HTTPException(
            status_code=403,
            detail="Смена не открыта. Отметка требований доступна только на объекте.",
        )

    emp.completed_tasks_json = json.dumps(payload.completed_task_ids)
    if payload.task_photos:
        emp.task_photos_json = json.dumps(payload.task_photos)
    db.commit()
    return {"status": "ok"}
