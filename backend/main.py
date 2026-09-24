import asyncio
import json
import logging
import math
import os
import random
import re
import uuid
from datetime import datetime
from pathlib import Path

from database import Base, SessionLocal, engine
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from maxapi import Bot, Dispatcher, F
from maxapi.filters.command import CommandStart
from maxapi.types import MessageCallback, MessageCreated
from maxapi.types.attachments.buttons import (CallbackButton, LinkButton,
                                              RequestGeoLocationButton)
from maxapi.types.attachments.location import Location
from maxapi.utils.inline_keyboard import InlineKeyboardBuilder
from models import Employee, Facility
from pydantic import BaseModel
from sqlalchemy.orm import Session

logging.basicConfig(level=logging.INFO)

load_dotenv()

TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_BASE = os.getenv("WEBAPP_URL", "https://46.29.114.201.sslip.io")
LAW_URL = "https://www.consultant.ru/document/cons_doc_LAW_358890/578f4477c77c1d76378415d86ef8e3648e42994c/"

Base.metadata.create_all(bind=engine)

bot = Bot(TOKEN)
dp = Dispatcher()


# Generate facility code
def generate_unique_facility_code(db: Session) -> str:
    while True:
        part1 = random.randint(1000, 9999)
        part2 = random.randint(1000, 9999)
        candidate = f"{part1}-{part2}"
        existing = db.query(Facility).filter(Facility.code == candidate).first()
        if not existing:
            return candidate


# Generate staff code
def generate_unique_employee_code(db: Session, facility_id: int) -> str:
    while True:
        candidate = str(random.randint(1000, 9999))
        existing = (
            db.query(Employee)
            .filter(
                Employee.facility_id == facility_id,
                Employee.personal_code == candidate,
            )
            .first()
        )
        if not existing:
            return candidate


# Calculate distance
def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(r * c, 1)


# Expire old shifts
def expire_old_shifts(db: Session, facility_id: int | None = None):
    query = db.query(Employee).filter(Employee.shift_active == True)
    if facility_id:
        query = query.filter(Employee.facility_id == facility_id)
    for emp in query.all():
        if emp.shift_started_at:
            age = (datetime.utcnow() - emp.shift_started_at).total_seconds() / 3600
            if age >= 12:
                emp.shift_active = False
                emp.shift_ended_at = datetime.utcnow()
    db.commit()


# Database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Application lifespan
async def lifespan(app: FastAPI):
    task = asyncio.create_task(dp.start_polling(bot))
    yield
    task.cancel()


app = FastAPI(title="МАХ-Инспектор API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StaffItem(BaseModel):
    full_name: str
    position: str


class FacilityUpdateRequest(BaseModel):
    name: str | None = None
    address: str | None = None
    geo_lat: float | None = None
    geo_lon: float | None = None
    geo_required: bool = True
    admin_pin: str | None = None
    staff_count: int = 0
    positions: list = []
    duties: list = []
    staff_list: list[StaffItem] = []


class FacilityAuthRequest(BaseModel):
    code: str
    admin_pin: str


class EmployeeRegisterRequest(BaseModel):
    code: str
    user_id: int
    full_name: str
    position: str


class EmployeeClaimRequest(BaseModel):
    code: str
    employee_id: int
    user_id: int


class EmployeeTasksRequest(BaseModel):
    completed_task_ids: list[int] = []
    task_photos: dict = {}


class AddStaffRequest(BaseModel):
    full_name: str
    position: str


# Get facility info
@app.get("/api/facility/{code}")
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
        "staff": staff,
    }


# Verify facility auth
@app.post("/api/facility/auth")
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
@app.post("/api/facility/{code}")
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
        try:
            builder = InlineKeyboardBuilder()
            builder.row(
                LinkButton(
                    text="Панель управления заведением",
                    url=f"{WEBAPP_BASE}?role=owner&code={fac.code}&user_id={fac.owner_user_id}",
                )
            )
            await bot.send_message(
                user_id=fac.owner_user_id,
                text=(
                    "Регистрация заведения завершена.\n\n"
                    f"Наименование: {fac.name}\n"
                    f"Регистрационный номер: {fac.code}\n\n"
                    "Номер объекта предназначен для передачи сотрудникам.\n"
                    "Для перехода к управлению используйте кнопку ниже:"
                ),
                attachments=[builder.as_markup()],
            )
        except Exception as e:
            logging.error(f"Failed to notify owner: {e}")

    return {"status": "ok", "code": fac.code}


# Add staff member
@app.post("/api/facility/{code}/staff")
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
@app.post("/api/facility/{code}/staff/{employee_id}/unlink")
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


# Register employee
@app.post("/api/employee/register")
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
        try:
            builder = InlineKeyboardBuilder()
            builder.row(
                RequestGeoLocationButton(
                    text="Подтвердить присутствие на объекте",
                    quick=True,
                )
            )
            await bot.send_message(
                user_id=payload.user_id,
                text=(
                    "Регистрация сотрудника завершена.\n\n"
                    f"Сотрудник: {emp.full_name}\n"
                    f"Должность: {emp.position}\n"
                    f"Заведение: {fac.code}\n\n"
                    "Для открытия смены подтвердите фактическое присутствие на объекте:"
                ),
                attachments=[builder.as_markup()],
            )
        except Exception as e:
            logging.error(f"Failed to notify employee: {e}")

    return {"status": "ok", "employee_id": emp.id}


# Claim employee profile
@app.post("/api/employee/claim")
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
        try:
            builder = InlineKeyboardBuilder()
            builder.row(
                RequestGeoLocationButton(
                    text="Подтвердить присутствие на объекте",
                    quick=True,
                )
            )
            await bot.send_message(
                user_id=payload.user_id,
                text=(
                    "Регистрация сотрудника завершена.\n\n"
                    f"Сотрудник: {emp.full_name}\n"
                    f"Должность: {emp.position}\n"
                    f"Заведение: {fac.name}\n\n"
                    "Для открытия смены подтвердите фактическое присутствие на объекте:"
                ),
                attachments=[builder.as_markup()],
            )
        except Exception as e:
            logging.error(f"Failed to notify employee: {e}")

    return {
        "status": "ok",
        "employee_id": emp.id,
        "full_name": emp.full_name,
        "position": emp.position,
    }


# Get employee info
@app.get("/api/employee/{user_id}")
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
@app.post("/api/employee/{user_id}/shift/end")
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
@app.post("/api/employee/{user_id}/tasks")
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


# Upload task photo
@app.post("/api/upload")
async def upload_photo(file: UploadFile = File(...)):
    filename = f"{uuid.uuid4().hex}_{file.filename}"
    upload_path = Path(__file__).resolve().parent / "uploads" / filename
    content = await file.read()
    with open(upload_path, "wb") as f:
        f.write(content)
    return {"status": "ok", "url": f"/uploads/{filename}"}


UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="root")


# Handle start command
@dp.message_created(CommandStart())
async def handle_start(event: MessageCreated):
    sender = event.message.sender
    user_id = getattr(sender, "user_id", None) if sender else None

    db = SessionLocal()
    try:
        if user_id:
            fac = db.query(Facility).filter(Facility.owner_user_id == user_id).first()
            if fac:
                expire_old_shifts(db, fac.id)
                builder = InlineKeyboardBuilder()
                builder.row(
                    LinkButton(
                        text="Панель управления заведением",
                        url=f"{WEBAPP_BASE}?role=owner&code={fac.code}&user_id={user_id}",
                    )
                )
                await event.message.answer(
                    text=(
                        "МАХ-Инспектор. Панель управления заведением.\n\n"
                        f"Наименование: {fac.name}\n"
                        f"Регистрационный номер: {fac.code}\n"
                        f"Адрес: {fac.address or 'не указан'}\n\n"
                        "Для перехода к управлению используйте кнопку ниже:"
                    ),
                    attachments=[builder.as_markup()],
                )
                return

            emp = db.query(Employee).filter(Employee.user_id == user_id).first()
            if emp:
                fac = emp.facility
                if fac:
                    expire_old_shifts(db, fac.id)

                builder = InlineKeyboardBuilder()
                if emp.shift_active:
                    time_str = (
                        emp.shift_started_at.strftime("%H:%M")
                        if emp.shift_started_at
                        else ""
                    )
                    builder.row(
                        LinkButton(
                            text="Список задач на смену",
                            url=f"{WEBAPP_BASE}?role=employee&code={fac.code}&user_id={user_id}",
                        )
                    )
                    builder.row(
                        CallbackButton(
                            text="Завершить смену",
                            payload=f"end_shift_{emp.id}",
                        )
                    )
                    await event.message.answer(
                        text=(
                            "МАХ-Инспектор. Рабочее место сотрудника.\n\n"
                            f"Сотрудник: {emp.full_name}\n"
                            f"Должность: {emp.position}\n"
                            f"Заведение: {fac.code}\n"
                            f"Статус: Смена открыта в {time_str}.\n\n"
                            "Перейдите к выполнению обязательных требований:"
                        ),
                        attachments=[builder.as_markup()],
                    )
                else:
                    builder.row(
                        RequestGeoLocationButton(
                            text="Подтвердить присутствие на объекте",
                            quick=True,
                        )
                    )
                    await event.message.answer(
                        text=(
                            "МАХ-Инспектор. Рабочее место сотрудника.\n\n"
                            f"Сотрудник: {emp.full_name}\n"
                            f"Должность: {emp.position}\n"
                            f"Заведение: {fac.code}\n"
                            "Статус: Смена не открыта.\n\n"
                            "Для открытия смены подтвердите фактическое присутствие на объекте:"
                        ),
                        attachments=[builder.as_markup()],
                    )
                return

        builder = InlineKeyboardBuilder()
        builder.row(
            CallbackButton(
                text="Владелец или управляющий",
                payload="role_owner",
            )
        )
        builder.row(
            CallbackButton(
                text="Сотрудник заведения",
                payload="role_employee",
            )
        )
        await event.message.answer(
            text=(
                "МАХ-Инспектор. Система контроля санитарных требований и подготовки к проверкам органов надзора.\n\n"
                "Выберите ваш статус в системе:"
            ),
            attachments=[builder.as_markup()],
        )
    finally:
        db.close()


# Owner callback
@dp.message_callback(F.callback.payload == "role_owner")
async def callback_role_owner(callback: MessageCallback):
    sender = callback.message.recipient if callback.message else None
    user_id = getattr(callback, "user_id", None)
    if not user_id and sender:
        user_id = getattr(sender, "user_id", None)

    db = SessionLocal()
    try:
        fac = None
        if user_id:
            fac = db.query(Facility).filter(Facility.owner_user_id == user_id).first()

        if fac:
            builder = InlineKeyboardBuilder()
            builder.row(
                LinkButton(
                    text="Панель управления заведением",
                    url=f"{WEBAPP_BASE}?role=owner&code={fac.code}&user_id={user_id}",
                )
            )
            await callback.message.answer(
                text=(
                    f"Заведение: {fac.name}\n"
                    f"Регистрационный номер: {fac.code}\n\n"
                    "Для перехода в панель управления используйте кнопку ниже:"
                ),
                attachments=[builder.as_markup()],
            )
        else:
            builder = InlineKeyboardBuilder()
            builder.row(
                CallbackButton(
                    text="Зарегистрировать новое заведение",
                    payload="owner_create_new",
                )
            )
            builder.row(
                CallbackButton(
                    text="Войти в существующее заведение",
                    payload="owner_login_existing",
                )
            )
            await callback.message.answer(
                text=(
                    "Панель руководителя.\n\n"
                    "Выберите необходимое действие:"
                ),
                attachments=[builder.as_markup()],
            )
    finally:
        db.close()


# Owner create new
@dp.message_callback(F.callback.payload == "owner_create_new")
async def callback_owner_create_new(callback: MessageCallback):
    sender = callback.message.recipient if callback.message else None
    user_id = getattr(callback, "user_id", None)
    if not user_id and sender:
        user_id = getattr(sender, "user_id", None)

    db = SessionLocal()
    try:
        code = generate_unique_facility_code(db)
        fac = Facility(
            code=code,
            name="Объект общественного питания",
            owner_user_id=user_id,
            admin_pin="1234",
            geo_lat=55.783611,
            geo_lon=49.129444,
        )
        db.add(fac)
        db.commit()

        builder = InlineKeyboardBuilder()
        builder.row(
            LinkButton(
                text="Настроить заведение",
                url=f"{WEBAPP_BASE}?role=owner&mode=new&code={fac.code}&user_id={user_id or 0}",
            )
        )
        await callback.message.answer(
            text=(
                "Создан новый объект в реестре.\n\n"
                f"Регистрационный номер: {fac.code}\n\n"
                "Перейдите по ссылке для указания адреса, установки секретного ПИН-кода и формирования штата сотрудников:"
            ),
            attachments=[builder.as_markup()],
        )
    finally:
        db.close()


# Owner login existing
@dp.message_callback(F.callback.payload == "owner_login_existing")
async def callback_owner_login_existing(callback: MessageCallback):
    await callback.message.answer(
        text=(
            "Для входа в существующее заведение отправьте в чат регистрационный номер и ПИН-код через пробел.\n\n"
            "Пример сообщения: 4819-2051 7391"
        )
    )


# Employee callback
@dp.message_callback(F.callback.payload == "role_employee")
async def callback_role_employee(callback: MessageCallback):
    await callback.message.answer(
        text=(
            "Для привязки к заведению отправьте в чат регистрационный номер заведения.\n\n"
            "Пример сообщения: 4819-2051\n"
            "Номер выдается руководителем заведения."
        )
    )


# Claim employee callback
@dp.message_callback(F.callback.payload.startswith("claim_emp_"))
async def callback_claim_employee(callback: MessageCallback):
    payload = callback.callback.payload
    emp_id = int(payload.replace("claim_emp_", ""))
    sender = callback.message.recipient if callback.message else None
    user_id = getattr(callback, "user_id", None)
    if not user_id and sender:
        user_id = getattr(sender, "user_id", None)

    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.id == emp_id).first()
        if not emp:
            await callback.message.answer(text="Сотрудник не найден.")
            return

        emp.user_id = user_id
        db.commit()

        builder = InlineKeyboardBuilder()
        builder.row(
            RequestGeoLocationButton(
                text="Подтвердить присутствие на объекте",
                quick=True,
            )
        )
        await callback.message.answer(
            text=(
                "Профиль успешно привязан.\n\n"
                f"Сотрудник: {emp.full_name}\n"
                f"Должность: {emp.position}\n"
                f"Заведение: {emp.facility.name}\n\n"
                "Для открытия смены подтвердите фактическое присутствие на объекте:"
            ),
            attachments=[builder.as_markup()],
        )
    finally:
        db.close()


# End shift callback
@dp.message_callback(F.callback.payload.startswith("end_shift_"))
async def callback_end_shift(callback: MessageCallback):
    payload = callback.callback.payload
    emp_id = int(payload.replace("end_shift_", ""))

    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.id == emp_id).first()
        if emp:
            emp.shift_active = False
            emp.shift_ended_at = datetime.utcnow()
            db.commit()

            tasks = json.loads(emp.completed_tasks_json or "[]")
            time_str = emp.shift_ended_at.strftime("%H:%M")
            await callback.message.answer(
                text=(
                    "Смена успешно завершена.\n\n"
                    f"Время закрытия: {time_str}.\n"
                    f"Выполнено обязательных требований: {len(tasks)}.\n\n"
                    "Для открытия следующей смены отправьте команду /start."
                )
            )
    finally:
        db.close()


# Handle text and geo messages
@dp.message_created()
async def handle_incoming_message(event: MessageCreated):
    sender = event.message.sender
    user_id = getattr(sender, "user_id", None) if sender else None
    body = getattr(event.message, "body", None)
    attachments = getattr(body, "attachments", None) if body else None
    text = (getattr(body, "text", "") or "").strip()

    db = SessionLocal()
    try:
        # Check location attachment
        if attachments:
            for att in attachments:
                if (
                    isinstance(att, Location)
                    or getattr(att, "type", None) == "location"
                ):
                    lat = getattr(att, "latitude", None)
                    lon = getattr(att, "longitude", None)
                    if lat is None or lon is None:
                        continue

                    emp = (
                        db.query(Employee).filter(Employee.user_id == user_id).first()
                        if user_id
                        else None
                    )
                    if not emp:
                        await event.message.answer(
                            text="Сотрудник не найден в системе. Сначала отправьте номер заведения."
                        )
                        return

                    fac = emp.facility
                    expire_old_shifts(db, fac.id)
                    target_lat = fac.geo_lat or 55.783611
                    target_lon = fac.geo_lon or 49.129444

                    if fac.geo_required and fac.geo_lat and fac.geo_lon:
                        dist = calculate_distance(lat, lon, target_lat, target_lon)
                        if dist <= 100:
                            emp.shift_active = True
                            emp.shift_started_at = datetime.utcnow()
                            emp.shift_ended_at = None
                            emp.last_geo_distance = dist
                            db.commit()

                            time_str = emp.shift_started_at.strftime("%H:%M")
                            builder = InlineKeyboardBuilder()
                            builder.row(
                                LinkButton(
                                    text="Список задач на смену",
                                    url=f"{WEBAPP_BASE}?role=employee&code={fac.code}&user_id={user_id}",
                                )
                            )
                            builder.row(
                                CallbackButton(
                                    text="Завершить смену",
                                    payload=f"end_shift_{emp.id}",
                                )
                            )
                            await event.message.answer(
                                text=(
                                    "Присутствие на объекте подтверждено.\n"
                                    f"Дистанция: {dist} м.\n"
                                    f"Смена открыта в {time_str}.\n\n"
                                    "Перейдите к выполнению обязательных требований:"
                                ),
                                attachments=[builder.as_markup()],
                            )
                        else:
                            builder = InlineKeyboardBuilder()
                            builder.row(
                                RequestGeoLocationButton(
                                    text="Подтвердить присутствие на объекте",
                                    quick=True,
                                )
                            )
                            await event.message.answer(
                                text=(
                                    "Смена не может быть открыта.\n"
                                    f"Дистанция до заведения составляет {dist} м при допустимом радиусе 100 м.\n\n"
                                    "Подтвердите присутствие непосредственно на рабочем месте:"
                                ),
                                attachments=[builder.as_markup()],
                            )
                    else:
                        emp.shift_active = True
                        emp.shift_started_at = datetime.utcnow()
                        emp.shift_ended_at = None
                        db.commit()
                        time_str = emp.shift_started_at.strftime("%H:%M")
                        builder = InlineKeyboardBuilder()
                        builder.row(
                            LinkButton(
                                text="Список задач на смену",
                                url=f"{WEBAPP_BASE}?role=employee&code={fac.code}&user_id={user_id}",
                            )
                        )
                        await event.message.answer(
                            text=(
                                "Геолокация для данного заведения отключена руководителем.\n"
                                f"Смена открыта в {time_str}.\n\n"
                                "Перейдите к списку задач:"
                            ),
                            attachments=[builder.as_markup()],
                        )
                    return

        # Check text authorization
        if text:
            # Check single facility code
            code_match = re.match(r"^(\d{4}-\d{4})$", text)
            if code_match:
                fcode = code_match.group(1)
                fac = db.query(Facility).filter(Facility.code == fcode).first()
                if not fac:
                    await event.message.answer(
                        text=f"Заведение с номером {fcode} не найдено в реестре."
                    )
                    return

                expire_old_shifts(db, fac.id)

                emp_existing = (
                    db.query(Employee)
                    .filter(
                        Employee.facility_id == fac.id, Employee.user_id == user_id
                    )
                    .first()
                )
                if emp_existing:
                    builder = InlineKeyboardBuilder()
                    if emp_existing.shift_active:
                        builder.row(
                            LinkButton(
                                text="Список задач на смену",
                                url=f"{WEBAPP_BASE}?role=employee&code={fac.code}&user_id={user_id}",
                            )
                        )
                        builder.row(
                            CallbackButton(
                                text="Завершить смену",
                                payload=f"end_shift_{emp_existing.id}",
                            )
                        )
                    else:
                        builder.row(
                            RequestGeoLocationButton(
                                text="Подтвердить присутствие на объекте",
                                quick=True,
                            )
                        )
                    await event.message.answer(
                        text=(
                            f"Вы уже привязаны к заведению {fac.name}.\n\n"
                            f"Сотрудник: {emp_existing.full_name}\n"
                            f"Должность: {emp_existing.position}\n"
                            f"Статус смены: {'Открыта' if emp_existing.shift_active else 'Не открыта'}.\n\n"
                            "Выберите необходимое действие:"
                        ),
                        attachments=[builder.as_markup()],
                    )
                    return

                unlinked = [e for e in fac.employees if not e.user_id]
                if not unlinked:
                    await event.message.answer(
                        text=(
                            f"Заведение: {fac.name}.\n"
                            "Все сотрудники в штатном расписании уже привязаны либо список сотрудников пуст.\n"
                            "Обратитесь к руководителю заведения для добавления вас в штат."
                        )
                    )
                    return

                builder = InlineKeyboardBuilder()
                for e in unlinked:
                    builder.row(
                        CallbackButton(
                            text=f"{e.full_name} - {e.position}",
                            payload=f"claim_emp_{e.id}",
                        )
                    )
                await event.message.answer(
                    text=(
                        f"Заведение: {fac.name}\n"
                        f"Регистрационный номер: {fac.code}\n\n"
                        "Выберите вашу фамилию и должность из списка сотрудников:"
                    ),
                    attachments=[builder.as_markup()],
                )
                return

            # Check facility code and pin
            pair_match = re.match(r"^(\d{4}-\d{4})\s+(\d+)$", text)
            if pair_match:
                fcode, code_arg = pair_match.groups()
                fac = db.query(Facility).filter(Facility.code == fcode).first()
                if not fac:
                    await event.message.answer(
                        text=f"Заведение с номером {fcode} не найдено в реестре."
                    )
                    return

                # Check if it matches owner pin
                if fac.admin_pin == code_arg:
                    fac.owner_user_id = user_id
                    db.commit()
                    builder = InlineKeyboardBuilder()
                    builder.row(
                        LinkButton(
                            text="Панель управления заведением",
                            url=f"{WEBAPP_BASE}?role=owner&code={fac.code}&user_id={user_id}",
                        )
                    )
                    await event.message.answer(
                        text=(
                            "Авторизация владельца успешна.\n\n"
                            f"Заведение: {fac.name}\n"
                            f"Регистрационный номер: {fac.code}\n\n"
                            "Доступ к панели управления предоставлен:"
                        ),
                        attachments=[builder.as_markup()],
                    )
                    return

                # Check if it matches employee personal code
                emp = (
                    db.query(Employee)
                    .filter(
                        Employee.facility_id == fac.id,
                        Employee.personal_code == code_arg,
                    )
                    .first()
                )
                if emp:
                    emp.user_id = user_id
                    db.commit()

                    builder = InlineKeyboardBuilder()
                    builder.row(
                        RequestGeoLocationButton(
                            text="Подтвердить присутствие на объекте",
                            quick=True,
                        )
                    )
                    await event.message.answer(
                        text=(
                            "Авторизация успешно завершена.\n\n"
                            f"Сотрудник: {emp.full_name}\n"
                            f"Должность: {emp.position}\n"
                            f"Заведение: {fac.name}\n\n"
                            "Ваш аккаунт привязан. Для открытия смены подтвердите фактическое присутствие на объекте:"
                        ),
                        attachments=[builder.as_markup()],
                    )
                    return

                await event.message.answer(
                    text="Введенный код не подходит как ПИН-код владельца или код сотрудника данного заведения."
                )
                return

    finally:
        db.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
