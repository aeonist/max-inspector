import logging

from maxapi.types.input_media import InputMedia
from sqlalchemy.orm import Session

from max_bot import keyboards
from max_bot.instance import bot
from models import Defect, Employee, Facility
from services import audit
from services.checklist import get_item

logger = logging.getLogger(__name__)


# Photos per group in one chat message; the rest are in the mini-app
CHAT_PHOTOS_PER_GROUP = 4


def _media(urls) -> list[InputMedia]:
    paths = [audit.local_photo_path(u) for u in urls]
    return [InputMedia(str(p)) for p in paths if p]


# Two groups of photos in one message and a caption telling them apart
def _photo_groups(first: list[str], first_label: str, second: list[str], second_label: str) -> tuple[list, str]:
    a = _media(first[:CHAT_PHOTOS_PER_GROUP])
    b = _media(second[:CHAT_PHOTOS_PER_GROUP])

    def span(start: int, count: int) -> str:
        if count == 1:
            return f"фото {start}"
        return f"фото {start}–{start + count - 1}"

    parts = []
    if a:
        parts.append(f"{span(1, len(a))} — {first_label}")
    if b:
        parts.append(f"{span(len(a) + 1, len(b))} — {second_label}")
    caption = ", ".join(parts)
    return [*a, *b], (caption[0].upper() + caption[1:] + ".") if caption else ""


async def _send(user_id: int, text: str, attachments: list) -> bool:
    try:
        await bot.send_message(user_id=user_id, text=text, attachments=attachments)
        return True
    except Exception as e:
        logger.error(f"Failed to send message to {user_id}: {e}")
        return False


# Violation card: photos as it is now, then the "as it should be" reference
async def send_defect_card(db: Session, facility: Facility, defect: Defect) -> list[str]:
    recipients = audit.defect_recipients(db, facility, defect)
    if not recipients:
        return []
    item = get_item(defect.item_id) or {}
    reference = audit.reference_photo_url(facility, defect.item_id)
    media, caption = _photo_groups(
        defect.before_photos, "как сейчас", [reference] if reference else [], "как должно быть"
    )

    lines = [f"⚠️ Нарушение: {defect.title}"]
    if caption:
        lines.append(caption)
    if not reference and item.get("photo_hint"):
        lines.append(f"Как должно быть: {item['photo_hint']}.")
    if item.get("remediation"):
        lines.append(f"Что сделать: {item['remediation']}")
    if item.get("basis"):
        lines.append(f"Основание: {item['basis']}")
    lines.append("Исправьте и сфотографируйте результат в задаче.")
    text = "\n".join(lines)

    delivered = []
    for emp in recipients:
        keyboard = keyboards.defect_card(emp.user_id, defect.id)
        if await _send(emp.user_id, text, [*media, keyboard.as_markup()]):
            delivered.append(emp.full_name)
    return delivered


# Before/after for the owner with Accept / Return buttons
async def send_review_card(facility: Facility, defect: Defect, employee: Employee) -> bool:
    if not facility.owner_user_id:
        return False
    media, caption = _photo_groups(defect.before_photos, "было", defect.after_photos, "стало")
    text = (
        f"🔍 Исправление на проверку: {defect.title}\n"
        f"Исправил(а): {employee.full_name}, {employee.position}.\n"
        f"{caption} Принять?"
    )
    return await _send(facility.owner_user_id, text, [*media, keyboards.review(defect.id).as_markup()])


async def send_fix_accepted(employee: Employee, defect: Defect) -> bool:
    if not employee or not employee.user_id:
        return False
    return await _send(employee.user_id, f"✅ Исправление принято: {defect.title}\nСпасибо!", [])


async def send_fix_returned(employee: Employee, defect: Defect) -> bool:
    if not employee or not employee.user_id:
        return False
    text = (
        f"↩️ Исправление вернули: {defect.title}\n"
        f"Причина: {defect.return_reason}.\n"
        "Исправьте и сфотографируйте ещё раз."
    )
    keyboard = keyboards.defect_card(employee.user_id, defect.id)
    return await _send(employee.user_id, text, [keyboard.as_markup()])


async def send_staff_joined(facility: Facility, employee: Employee) -> bool:
    if not facility.owner_user_id or facility.owner_user_id == employee.user_id:
        return False
    text = f"👋 В команде «{facility.name}» пополнение: {employee.full_name}, {employee.position}."
    keyboard = keyboards.single_app_button("Открыть кабинет", facility.owner_user_id, "home")
    return await _send(facility.owner_user_id, text, [keyboard.as_markup()])


# Problem reported by staff during a shift
async def send_problem(facility: Facility, defect: Defect, employee: Employee) -> bool:
    if not facility.owner_user_id:
        return False
    text = f"📣 {employee.full_name} ({employee.position}) сообщает о проблеме:\n{defect.comment or defect.title}"
    keyboard = keyboards.single_app_button("Открыть кабинет", facility.owner_user_id, "home")
    return await _send(facility.owner_user_id, text, [*_media(defect.before_photos[:CHAT_PHOTOS_PER_GROUP]), keyboard.as_markup()])


# After the wizard: ask the owner for the facility location right in the chat
async def send_facility_geo_request(facility: Facility) -> bool:
    if not facility.owner_user_id:
        return False
    text = (
        f"Заведение «{facility.name}» готово 🎉\n"
        "Вы сейчас в заведении? Отправьте геопозицию — по ней сотрудники будут отмечать начало смены."
    )
    return await _send(facility.owner_user_id, text, [keyboards.facility_geo_request().as_markup()])
