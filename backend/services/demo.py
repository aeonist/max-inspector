import shutil
import uuid

from sqlalchemy.orm import Session

from config import FRONTEND_DIR, UPLOADS_DIR
from models import Employee, Facility
from services import audit
from services.checklist import load_checklist
from services.facility import (
    create_facility,
    detach_facility,
    employee_of,
    owner_facility,
    save_setup,
)
from utils.timefmt import utcnow

# Test data, clearly labelled as such in the UI and README
DEMO_SETUP = {
    "name": "Демо-кафе «Зерно»",
    "address": "Казань, ул. Баумана, 1 (тестовые данные)",
    "qr_checkin": False,
    "positions": ["Повар", "Бариста", "Официант", "Уборщик"],
    "features": [
        "Используется фритюр",
        "Есть кофемашина, автомат напитков или вендинг",
        "Готовятся холодные блюда, салаты, десерты или проводится порционирование",
        "Продажа на вынос или доставка",
    ],
    "new_staff": [
        {"full_name": "Мария Петрова", "position": "Повар"},
        {"full_name": "Айдар Галиев", "position": "Бариста"},
        {"full_name": "Ольга Смирнова", "position": "Официант"},
        {"full_name": "Ильдар Хабибуллин", "position": "Уборщик"},
    ],
    "owner_works_shift": True,
}
# Violations: fryer oil is the cook's, thermometers are the owner's task
DEMO_VIOLATIONS = [26, 14]
# A fix sent by the cook that waits for the owner's review
DEMO_FIX = 18
# The end of the route is left unchecked, so "Продолжить аудит" has something to show
DEMO_UNCHECKED = [66, 67, 68, 69, 70, 71]
# With the rest compliant the demo starts just under the readiness threshold (58 of 67, 87%):
# closing the three violations brings it to 61 of 67 (91%) and "Готово к проверке"


# Copy a library photo into uploads so it behaves like a photo taken in the app
def _library_photo(item_id: int, kind: str) -> str:
    name = f"{uuid.uuid4().hex}.jpg"
    shutil.copy(FRONTEND_DIR / "img" / "reference" / f"{item_id}_{kind}.jpg", UPLOADS_DIR / name)
    return f"/uploads/{name}"


# Demo replaces a facility that was created but never set up
def start_demo(db: Session, user_id: int, owner_name: str) -> Facility:
    existing = owner_facility(db, user_id)
    if existing and existing.setup_done:
        raise ValueError("У вас уже есть заведение. Удалить его можно в настройках")
    if employee_of(db, user_id):
        raise ValueError("Вы подключены к заведению как сотрудник")
    if existing:
        detach_facility(db, existing)
    return create_demo_facility(db, user_id, owner_name)


def create_demo_facility(db: Session, owner_user_id: int, owner_name: str) -> Facility:
    facility = create_facility(db, owner_user_id)
    save_setup(db, facility, {**DEMO_SETUP, "owner_name": owner_name or "Руководитель"}, owner_name)

    # The rest of the audit is compliant; items the photo library covers get a photo
    answered = audit.answers_by_item(db, audit.current_session(db, facility))
    skip = {*DEMO_VIOLATIONS, DEMO_FIX, *DEMO_UNCHECKED, *answered}
    for item in load_checklist():
        if item["id"] in skip:
            continue
        has_photo = (FRONTEND_DIR / "img" / "reference" / f"{item['id']}_good.jpg").exists()
        photos = [_library_photo(item["id"], "good")] if has_photo else []
        audit.set_answer(db, facility, item["id"], "compliant", photos)

    for item_id in DEMO_VIOLATIONS:
        _, defect, _ = audit.set_answer(db, facility, item_id, "violation", [_library_photo(item_id, "bad")])
        # Demo staff are not in MAX; keep the shift violation with the cook to show "Нарушения у команды"
        if defect.assigned_position:
            defect.to_owner = False
    db.commit()

    # The cook Maria has already sent her fix: before/after waits in "Ждут вашей проверки"
    _, defect, _ = audit.set_answer(db, facility, DEMO_FIX, "violation", [_library_photo(DEMO_FIX, "bad")], "Повар")
    cook = db.query(Employee).filter(Employee.facility_id == facility.id, Employee.full_name == "Мария Петрова").one()
    # Like the other demo violations it stays the cook's: "Вернуть" sends it back to her position
    defect.to_owner = False
    defect.status = "fixed"
    defect.after_photos = [_library_photo(DEMO_FIX, "good")]
    defect.fixed_by_employee_id = cook.id
    defect.fixed_at = utcnow()
    db.commit()
    return facility
