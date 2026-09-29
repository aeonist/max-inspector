from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from config import MINIAPP_MODE
from database import get_db
from max_bot.instance import bot_username
from services.auth import CurrentUser, current_user
from services.demo import start_demo
from services.facility import create_facility, employee_of, owner_facility

router = APIRouter(prefix="/api", tags=["me"])


# Liveness check for Docker and monitoring
@router.get("/health")
def get_health():
    return {"status": "ok"}


# Public: where to send a user who opened the page outside the bot
@router.get("/bot")
def get_bot():
    return {"username": bot_username()}


# Who is the user and where the mini-app should open
@router.get("/me")
def get_me(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    facility = owner_facility(db, user.user_id)
    employee = employee_of(db, user.user_id)
    return {
        "user": {"id": user.user_id, "name": user.full_name},
        "start_param": user.start_param,
        "owner": (
            {"name": facility.name, "setup_done": bool(facility.setup_done)} if facility else None
        ),
        "employee": (
            {
                "full_name": employee.full_name,
                "position": employee.position,
                "facility_name": employee.facility.name,
                "is_owner": bool(employee.is_owner),
            }
            if employee
            else None
        ),
        "bot_username": bot_username(),
        "miniapp_mode": MINIAPP_MODE,
    }


# Owner starts from the mini-app instead of the chat button
@router.post("/facility")
def create_my_facility(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    try:
        facility = create_facility(db, user.user_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"name": facility.name, "setup_done": bool(facility.setup_done)}


# Pre-filled demo cafe (test data, geo control off) to try the full cycle quickly
@router.post("/facility/demo")
def create_my_demo(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    try:
        facility = start_demo(db, user.user_id, user.full_name)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"name": facility.name, "setup_done": True}
