from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from config import UPLOADS_DIR
from database import get_db
from models import Employee, Facility
from services.auth import CurrentUser, current_user
from services.facility import employee_of, owner_facility


# Facility owned by the current MAX user
def get_owner_facility(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> Facility:
    facility = owner_facility(db, user.user_id)
    if not facility:
        raise HTTPException(status_code=404, detail="Заведение не найдено. Создайте его в чате с ботом.")
    return facility


# Employee profile of the current MAX user
def get_employee(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> Employee:
    employee = employee_of(db, user.user_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Вы ещё не подключены к заведению")
    return employee


# Photo reference sent by the client must point to a file uploaded to us
def uploaded_photo(url: str | None, required: bool = False) -> str | None:
    if not url:
        if required:
            raise HTTPException(status_code=400, detail="Прикрепите фото")
        return None
    name = url.removeprefix("/uploads/")
    if not url.startswith("/uploads/") or "/" in name or not (UPLOADS_DIR / name).is_file():
        raise HTTPException(status_code=400, detail="Фото не найдено, загрузите его ещё раз")
    return url


def bad_request(error: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(error))
