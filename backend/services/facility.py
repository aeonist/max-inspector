import hmac
import re

from sqlalchemy.orm import Session

from max_bot.instance import bot_username
from models import Employee, Facility
from services import audit
from services.checklist import CUSTOM_DUTY_BASE_ID, OWNER_POSITION, default_assignments
from services.shifts import active_shift, shift_stats
from utils.generators import (
    generate_checkin_token,
    generate_invite_token,
    generate_unique_employee_code,
    generate_unique_facility_code,
)
from utils.timefmt import format_local_time, utcnow

MAX_NAME_LEN = 120


def owner_facility(db: Session, user_id: int) -> Facility | None:
    return db.query(Facility).filter(Facility.owner_user_id == user_id).order_by(Facility.id.desc()).first()


# Employee profile of a user (the owner's own profile included)
def employee_of(db: Session, user_id: int) -> Employee | None:
    return db.query(Employee).filter(Employee.user_id == user_id).order_by(Employee.id.desc()).first()


# Staff member a personal invite belongs to (not yet joined, not removed)
def employee_by_invite(db: Session, token: str) -> Employee | None:
    if not token:
        return None
    return (
        db.query(Employee)
        .filter(Employee.invite_token == token, Employee.archived.isnot(True), Employee.user_id.is_(None))
        .first()
    )


def ensure_employee_invite(db: Session, emp: Employee) -> str:
    if emp.user_id:
        raise ValueError(f"{emp.full_name} уже в MAX")
    if not emp.invite_token:
        emp.invite_token = generate_invite_token(db)
        db.commit()
    return emp.invite_token


def invite_link(token: str) -> str | None:
    username = bot_username()
    return f"https://max.ru/{username}?start=inv_{token}" if username else None


# "Начало смены" QR: a bot deep link, so both the MAX scanner and a phone camera work
def checkin_link(facility: Facility) -> str | None:
    username = bot_username()
    if not username or not facility.checkin_token:
        return None
    return f"https://max.ru/{username}?start=chk_{facility.checkin_token}"


def reissue_checkin_token(db: Session, facility: Facility) -> None:
    facility.checkin_token = generate_checkin_token()
    db.commit()


# Scanned text (link or bare token) matches the facility's current QR
def checkin_code_valid(facility: Facility, scanned: str | None) -> bool:
    match = re.search(r"chk_([\w-]+)", scanned or "")
    token = match.group(1) if match else (scanned or "").strip()
    return bool(facility.checkin_token) and hmac.compare_digest(token, facility.checkin_token)


# The person who opened the invite becomes this employee; the link stops working
def claim_invite(db: Session, emp: Employee, user_id: int) -> None:
    current = employee_of(db, user_id)
    if current and current.id != emp.id:
        raise ValueError(f"Ваш аккаунт уже привязан к «{current.facility.name}». Попросите прежнего руководителя отвязать его.")
    if emp.facility.owner_user_id == user_id:
        raise ValueError("Это приглашение для сотрудника — перешлите его ему")
    emp.user_id = user_id
    emp.invite_token = None
    db.commit()


def create_facility(db: Session, owner_user_id: int) -> Facility:
    existing = owner_facility(db, owner_user_id)
    if existing:
        return existing
    facility = Facility(
        code=generate_unique_facility_code(db),
        name="Моё заведение",
        owner_user_id=owner_user_id,
        qr_checkin=False,
        setup_done=False,
    )
    db.add(facility)
    db.commit()
    return facility




def _clean(text: str | None, limit: int = MAX_NAME_LEN) -> str:
    return " ".join((text or "").split())[:limit]


def add_employee(db: Session, facility: Facility, full_name: str, position: str) -> Employee:
    full_name, position = _clean(full_name), _clean(position)
    if not full_name or not position:
        raise ValueError("Укажите имя и должность")
    emp = Employee(
        facility_id=facility.id,
        personal_code=generate_unique_employee_code(db, facility.id),
        full_name=full_name,
        position=position,
    )
    db.add(emp)
    db.commit()
    return emp


# The owner working shifts gets an employee profile bound to their MAX account
# Name is applied when given; the profile is reused when the role is switched back on
def set_owner_works_shift(db: Session, facility: Facility, works: bool, name: str) -> None:
    owner_emp = audit.owner_employee(db, facility, include_archived=True)
    if works:
        elsewhere = employee_of(db, facility.owner_user_id)
        if elsewhere and elsewhere.facility_id != facility.id:
            raise ValueError(f"Вы уже сотрудник в «{elsewhere.facility.name}» — одна учётная запись работает в одном заведении")
        if not owner_emp:
            owner_emp = Employee(
                facility_id=facility.id,
                personal_code=generate_unique_employee_code(db, facility.id),
                full_name=_clean(name) or "Руководитель",
                position=OWNER_POSITION,
                is_owner=True,
                user_id=facility.owner_user_id,
            )
            db.add(owner_emp)
        owner_emp.position = OWNER_POSITION
        owner_emp.user_id = facility.owner_user_id
        owner_emp.archived = False
        if name:
            owner_emp.full_name = _clean(name)
    elif owner_emp and not owner_emp.archived:
        archive_employee(db, owner_emp)
    db.commit()


# "Delete and start over": the owner leaves the facility, data stays for history
def detach_facility(db: Session, facility: Facility) -> None:
    owner_emp = audit.owner_employee(db, facility)
    if owner_emp:
        archive_employee(db, owner_emp)
    facility.owner_user_id = None
    db.commit()


# Remove from staff but keep shift and fix history
def archive_employee(db: Session, emp: Employee) -> None:
    shift = active_shift(db, emp)
    if shift:
        shift.ended_at = utcnow()
    emp.archived = True
    emp.user_id = None


def active_staff(db: Session, facility: Facility) -> list[Employee]:
    return (
        db.query(Employee)
        .filter(Employee.facility_id == facility.id, Employee.archived.isnot(True))
        .order_by(Employee.is_owner.desc(), Employee.id)
        .all()
    )


# Save the setup wizard; positions, duties and staff arrive together
def save_setup(db: Session, facility: Facility, data: dict, owner_name: str) -> None:
    facility.name = _clean(data.get("name")) or facility.name
    facility.address = _clean(data.get("address"), 300) or None
    facility.qr_checkin = bool(data.get("qr_checkin"))
    if facility.qr_checkin and not facility.checkin_token:
        facility.checkin_token = generate_checkin_token()

    positions = []
    for p in data.get("positions") or []:
        p = _clean(p, 60)
        if p and p not in positions:
            positions.append(p)
    if not positions:
        raise ValueError("Добавьте хотя бы одну должность")
    facility.positions = positions

    facility.features = [f for f in data.get("features") or [] if isinstance(f, str)]

    # Shift duties: keep valid assignments, default the rest
    defaults = default_assignments(positions)
    incoming = data.get("assignments") or {}
    assignments = {}
    for item_id, position in defaults.items():
        chosen = incoming.get(item_id)
        assignments[item_id] = chosen if chosen in positions else position
    facility.assignments = assignments

    custom = []
    for i, duty in enumerate(data.get("custom_duties") or []):
        question = _clean(duty.get("question"), 200)
        position = duty.get("position")
        if question and position in positions:
            custom.append({"id": CUSTOM_DUTY_BASE_ID + i + 1, "question": question, "position": position})
    facility.custom_duties = custom

    # New staff from the wizard; existing people are edited from settings
    for person in data.get("new_staff") or []:
        name, position = _clean(person.get("full_name")), person.get("position")
        if name and position in positions:
            add_employee(db, facility, name, position)

    set_owner_works_shift(
        db,
        facility,
        bool(data.get("owner_works_shift")),
        data.get("owner_name") or owner_name,
    )

    facility.setup_done = True
    db.commit()
    audit.sync_features(db, facility)


def staff_to_dict(db: Session, emp: Employee) -> dict:
    shift = active_shift(db, emp) if emp.user_id else None
    stats = shift_stats(db, emp, shift) if shift else None
    return {
        "id": emp.id,
        "full_name": emp.full_name,
        "position": emp.position,
        "linked": emp.user_id is not None,
        "is_owner": bool(emp.is_owner),
        "invited": bool(emp.invite_token),
        "on_shift": shift is not None,
        "shift_started": format_local_time(shift.started_at) if shift else None,
        "checkin": shift.checkin if shift else None,
        "tasks_done": stats["done"] if stats else 0,
        "tasks_total": stats["total"] if stats else 0,
    }


# Everything the owner's cabinet shows, in one response
def facility_state(db: Session, facility: Facility) -> dict:
    staff = active_staff(db, facility)
    owner_emp = next((e for e in staff if e.is_owner), None)
    defects = [audit.defect_to_dict(d, facility) for d in audit.unresolved_defects(db, facility)]
    return {
        "code": facility.code,
        "name": facility.name,
        "address": facility.address or "",
        "setup_done": bool(facility.setup_done),
        "qr_checkin": bool(facility.qr_checkin),
        "positions": facility.positions,
        "features": facility.features,
        "assignments": facility.assignments,
        "custom_duties": facility.custom_duties,
        "reference_photos": facility.reference_photos,
        "owner_works_shift": owner_emp is not None,
        "owner_name": owner_emp.full_name if owner_emp else None,
        "staff": [staff_to_dict(db, e) for e in staff],
        "summary": audit.summary(db, facility),
        "defects": defects,
    }
