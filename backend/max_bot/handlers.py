import logging
import re

from maxapi import F
from maxapi.enums.chat_type import ChatType
from maxapi.filters.command import CommandStart
from maxapi.types import BotStarted, MessageCallback, MessageCreated
from maxapi.types.attachments.location import Location
from sqlalchemy.orm import Session

from config import GEO_RADIUS_M
from database import SessionLocal
from max_bot import keyboards
from max_bot.instance import bot, dp
from models import Defect, Employee, Facility
from services import audit, notifier
from services.demo import start_demo
from services.facility import (
    active_staff,
    create_facility,
    employee_of,
    facility_by_invite,
    owner_facility,
)
from services.shifts import active_shift, close_shift, open_shift, shift_stats
from utils.geo import calculate_distance
from utils.timefmt import format_local_time

logger = logging.getLogger(__name__)


async def _reply(user_id: int, text: str, keyboard=None) -> None:
    attachments = [keyboard.as_markup()] if keyboard else []
    await bot.send_message(user_id=user_id, text=text, attachments=attachments)


def _is_dialog(message) -> bool:
    recipient = getattr(message, "recipient", None)
    return getattr(recipient, "chat_type", ChatType.DIALOG) == ChatType.DIALOG


def _urgent_count(db: Session, emp: Employee) -> int:
    return sum(1 for d in audit.defects_for_employee(db, emp) if d.status in ("open", "returned"))


# Main message for a user depending on their role
def _home(db: Session, user_id: int) -> tuple[str, object]:
    fac = owner_facility(db, user_id)
    emp = employee_of(db, user_id)

    if fac:
        if not fac.setup_done:
            text = f"Продолжим настройку «{fac.name}»: название, команда и обязанности — около 5 минут."
            return text, keyboards.owner_menu(user_id, False, None, fac.geo_required)
        summary = audit.summary(db, fac)
        lines = [f"«{fac.name}»", f"Готовность к проверке: {summary['index']}%"]
        if summary["review"]:
            lines.append(f"Ждут вашей проверки: {summary['review']}")
        shift_state = None
        if emp and emp.is_owner and emp.facility_id == fac.id:
            shift = active_shift(db, emp)
            shift_state = "on" if shift else "off"
            if shift:
                lines.append(f"Ваша смена открыта в {format_local_time(shift.started_at)}.")
        return "\n".join(lines), keyboards.owner_menu(user_id, True, shift_state, fac.geo_required)

    if emp:
        fac = emp.facility
        shift = active_shift(db, emp)
        if shift:
            stats = shift_stats(db, emp, shift)
            lines = [
                f"«{fac.name}» · {emp.full_name}, {emp.position}",
                f"Смена открыта в {format_local_time(shift.started_at)}. Выполнено {stats['done']} из {stats['total']}.",
            ]
            urgent = _urgent_count(db, emp)
            if urgent:
                lines.append(f"Срочно исправить: {urgent}")
            return "\n".join(lines), keyboards.active_shift(user_id)
        how = "отправьте геопозицию на месте" if fac.geo_required else "нажмите кнопку ниже"
        text = f"«{fac.name}» · {emp.full_name}, {emp.position}\nЧтобы начать смену, {how}."
        return text, keyboards.start_shift(fac.geo_required)

    text = (
        "МАХ-Инспектор помогает кафе держать порядок к проверке Роспотребнадзора: "
        "аудит по официальному проверочному листу и задачи смене с фото.\n\nКто вы?"
    )
    return text, keyboards.role_choice()


async def _send_home(user_id: int) -> None:
    db = SessionLocal()
    try:
        text, keyboard = _home(db, user_id)
    finally:
        db.close()
    await _reply(user_id, text, keyboard)


# Staff invite from a QR poster or link: https://max.ru/<bot>?start=join_<token>
async def _handle_join(user_id: int, token: str) -> None:
    db = SessionLocal()
    try:
        fac = facility_by_invite(db, token)
        if not fac:
            await _reply(user_id, "Приглашение не найдено или устарело. Попросите у руководителя новую ссылку.")
            return
        if fac.owner_user_id == user_id:
            await _reply(user_id, "Это приглашение в ваше заведение — отправьте его сотрудникам.")
            await _send_home(user_id)
            return
        emp = employee_of(db, user_id)
        if emp and emp.facility_id == fac.id:
            await _reply(user_id, f"Вы уже в команде «{fac.name}».")
            await _send_home(user_id)
            return
        if emp:
            await _reply(
                user_id,
                f"Вы уже подключены к «{emp.facility.name}». Попросите руководителя отвязать аккаунт, "
                "чтобы перейти в другое заведение.",
            )
            return
        free = [e for e in active_staff(db, fac) if not e.user_id]
        if not free:
            await _reply(
                user_id,
                f"В штате «{fac.name}» нет свободных мест. Попросите руководителя добавить вас в команду "
                "и откройте приглашение ещё раз.",
            )
            return
        await _reply(user_id, f"Подключаемся к «{fac.name}». Кто вы?", keyboards.claim_profiles(free, token))
    finally:
        db.close()


# Handle first start, including deep links with a payload
@dp.bot_started()
async def handle_bot_started(event: BotStarted):
    user_id = event.user.user_id
    payload = event.payload or ""
    if payload.startswith("join_"):
        await _handle_join(user_id, payload.removeprefix("join_"))
    else:
        await _send_home(user_id)


# Handle /start command (optionally with a payload)
@dp.message_created(CommandStart())
async def handle_start(event: MessageCreated):
    if not _is_dialog(event.message) or not event.message.sender:
        return
    user_id = event.message.sender.user_id
    text = (event.message.body.text or "") if event.message.body else ""
    match = re.search(r"join_([\w-]+)", text)
    if match:
        await _handle_join(user_id, match.group(1))
    else:
        await _send_home(user_id)


@dp.message_callback(F.callback.payload == "role_owner")
async def callback_role_owner(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    db = SessionLocal()
    try:
        fac = create_facility(db, user_id)
        setup_done = fac.setup_done
    finally:
        db.close()
    await callback.ack()
    if setup_done:
        await _send_home(user_id)
        return
    await _reply(
        user_id,
        "Создали ваше заведение. Настройка займёт около 5 минут: название, команда и обязанности.",
        keyboards.single_app_button("Настроить заведение", user_id, "setup"),
    )


# Pre-filled demo cafe with test data: the whole cycle in a couple of taps
@dp.message_callback(F.callback.payload == "demo")
async def callback_demo(callback: MessageCallback):
    user = callback.callback.user
    name = " ".join(p for p in (user.first_name, user.last_name) if p)
    await callback.ack()
    db = SessionLocal()
    try:
        start_demo(db, user.user_id, name)
    except ValueError as e:
        await _reply(user.user_id, str(e))
        return
    finally:
        db.close()
    await _reply(
        user.user_id,
        "Демо-кафе «Зерно» готово (тестовые данные). В кабинете одно исправление уже ждёт вашей проверки, "
        "а в «Моей смене» — нарушение для вас как повара.",
        keyboards.single_app_button("Открыть кабинет", user.user_id, "home"),
    )


@dp.message_callback(F.callback.payload == "role_employee")
async def callback_role_employee(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    await callback.ack()
    await _reply(
        user_id,
        "Отсканируйте QR-код на плакате в заведении или откройте ссылку-приглашение от руководителя.",
        keyboards.single_app_button("Сканировать QR", user_id, "scan"),
    )


@dp.message_callback(F.callback.payload.startswith("claim_"))
async def callback_claim(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    match = re.fullmatch(r"claim_(\d+)_([\w-]+)", callback.callback.payload or "")
    await callback.ack()
    if not match:
        return
    emp_id, token = int(match.group(1)), match.group(2)
    db = SessionLocal()
    try:
        fac = facility_by_invite(db, token)
        emp = db.get(Employee, emp_id)
        if not fac or not emp or emp.facility_id != fac.id or emp.archived:
            await _reply(user_id, "Приглашение устарело. Попросите у руководителя новую ссылку.")
            return
        if employee_of(db, user_id):
            await _reply(user_id, "Ваш аккаунт уже привязан к сотруднику.")
            await _send_home(user_id)
            return
        if emp.user_id:
            await _reply(user_id, "Этот профиль уже занят. Выберите себя из свободных или обратитесь к руководителю.")
            return
        emp.user_id = user_id
        db.commit()
        await notifier.send_staff_joined(fac, emp)
        await _reply(
            user_id,
            f"Готово! Вы в команде «{fac.name}»: {emp.full_name}, {emp.position}.",
            keyboards.start_shift(fac.geo_required),
        )
    finally:
        db.close()


@dp.message_callback(F.callback.payload == "geo_later")
async def callback_geo_later(callback: MessageCallback):
    await callback.ack()
    await _reply(
        callback.callback.user.user_id,
        "Хорошо. Пока место не отмечено, смены открываются с пометкой «место не проверено». "
        "Отправить геопозицию можно в любой момент: кабинет → Настройки.",
    )


# Open a shift and tell the employee what is next
async def _start_shift(db: Session, user_id: int, emp: Employee, geo_status: str, distance: float | None) -> None:
    fac = emp.facility
    shift, created = open_shift(db, emp, geo_status, distance)
    stats = shift_stats(db, emp, shift)
    lines = [f"Смена открыта в {format_local_time(shift.started_at)} ✅"]
    if geo_status == "verified":
        lines[0] += f" · {round(distance)} м от заведения"
    elif geo_status == "no_coords":
        lines.append("Место не проверено: руководитель ещё не отметил заведение на карте.")
    lines.append(f"Задач на смену: {stats['total']}.")
    urgent = _urgent_count(db, emp)
    if urgent:
        lines.append(f"Срочно исправить: {urgent}.")
    await _reply(user_id, "\n".join(lines), keyboards.active_shift(user_id))
    if created and geo_status == "no_coords" and fac.owner_user_id and fac.owner_user_id != user_id:
        await _reply(
            fac.owner_user_id,
            f"{emp.full_name} открыл(а) смену, но место заведения не отмечено — проверить присутствие нельзя. "
            "Отправьте геопозицию, когда будете в заведении.",
            keyboards.facility_geo_request(),
        )


@dp.message_callback(F.callback.payload == "start_shift")
async def callback_start_shift(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    await callback.ack()
    db = SessionLocal()
    try:
        emp = employee_of(db, user_id)
        if not emp:
            await _send_home(user_id)
            return
        if emp.facility.geo_required:
            await _reply(user_id, "Для начала смены отправьте геопозицию на месте.", keyboards.start_shift(True))
            return
        await _start_shift(db, user_id, emp, "not_required", None)
    finally:
        db.close()


@dp.message_callback(F.callback.payload.in_({"end_shift", "end_shift_force"}))
async def callback_end_shift(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    force = callback.callback.payload == "end_shift_force"
    await callback.ack()
    db = SessionLocal()
    try:
        emp = employee_of(db, user_id)
        shift = active_shift(db, emp) if emp else None
        if not shift:
            await _reply(user_id, "Смена уже закрыта.")
            await _send_home(user_id)
            return
        stats = shift_stats(db, emp, shift)
        left = stats["total"] - stats["done"]
        if left > 0 and not force:
            await _reply(user_id, f"Осталось задач: {left}. Всё равно завершить смену?", keyboards.end_shift_confirm(left))
            return
        stats = close_shift(db, emp, shift)
        text = f"Смена завершена в {format_local_time(shift.ended_at)}.\nВыполнено {stats['done']} из {stats['total']}"
        if stats["fixed"]:
            text += f", исправлено нарушений: {stats['fixed']}"
        await _reply(user_id, text + ". Спасибо!", keyboards.start_shift(emp.facility.geo_required))
    finally:
        db.close()


def _owned_defect(db: Session, user_id: int, defect_id: int) -> tuple[Defect | None, Facility | None]:
    defect = db.get(Defect, defect_id)
    if not defect:
        return None, None
    fac = db.get(Facility, defect.facility_id)
    if not fac or fac.owner_user_id != user_id:
        return None, None
    return defect, fac


@dp.message_callback(F.callback.payload.startswith("accept_"))
async def callback_accept(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    defect_id = int(callback.callback.payload.removeprefix("accept_"))
    db = SessionLocal()
    try:
        defect, fac = _owned_defect(db, user_id, defect_id)
        if not defect:
            await callback.ack(notification="Нарушение не найдено")
            return
        if defect.status == "accepted":
            await callback.ack(notification="Уже принято")
            return
        if defect.status != "fixed":
            await callback.ack(notification="Исправление ещё не прислали")
            return
        audit.accept_defect(db, defect)
        await callback.ack(notification="Принято ✓")
        summary = audit.summary(db, fac)
        await notifier.send_fix_accepted(defect.fixed_by, defect)
        await _reply(user_id, f"✅ Принято: {defect.title}\nГотовность к проверке: {summary['index']}%")
    finally:
        db.close()


@dp.message_callback(F.callback.payload.startswith("return_"))
async def callback_return(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    defect_id = int(callback.callback.payload.removeprefix("return_"))
    db = SessionLocal()
    try:
        defect, _ = _owned_defect(db, user_id, defect_id)
        if not defect or defect.status != "fixed":
            await callback.ack(notification="Это исправление уже обработано")
            return
        await callback.ack()
        await _reply(user_id, "Почему возвращаете?", keyboards.return_reasons(defect_id))
    finally:
        db.close()


@dp.message_callback(F.callback.payload.startswith("ret_"))
async def callback_return_reason(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    match = re.fullmatch(r"ret_(\d+)_(\w+)", callback.callback.payload or "")
    if not match or match.group(2) not in keyboards.RETURN_REASONS:
        await callback.ack()
        return
    defect_id, reason = int(match.group(1)), keyboards.RETURN_REASONS[match.group(2)]
    db = SessionLocal()
    try:
        defect, _ = _owned_defect(db, user_id, defect_id)
        if not defect or defect.status != "fixed":
            await callback.ack(notification="Это исправление уже обработано")
            return
        audit.return_defect(db, defect, reason)
        await callback.ack(notification="Вернули")
        await notifier.send_fix_returned(defect.fixed_by, defect)
        await _reply(user_id, f"↩️ Вернули на доработку: {defect.title}\nПричина: {reason}.")
    finally:
        db.close()


# Location: the facility's place (owner) or a shift check-in (staff)
async def _handle_location(user_id: int, lat: float, lon: float) -> None:
    db = SessionLocal()
    try:
        fac = owner_facility(db, user_id)
        if fac and fac.geo_required and (not fac.has_coords or fac.geo_pending):
            fac.geo_lat, fac.geo_lon, fac.geo_pending = lat, lon, False
            db.commit()
            await _reply(
                user_id,
                f"📍 Место заведения сохранено. Сотрудники смогут начать смену в радиусе {GEO_RADIUS_M} м.",
            )
            await _send_home(user_id)
            return

        emp = employee_of(db, user_id)
        if not emp:
            if fac:
                await _reply(user_id, "Место заведения уже сохранено. Изменить его можно в кабинете → Настройки.")
            else:
                await _reply(user_id, "Сначала подключитесь к заведению: отсканируйте QR или откройте ссылку руководителя.")
            return

        work = emp.facility
        if not work.geo_required:
            await _start_shift(db, user_id, emp, "not_required", None)
        elif not work.has_coords:
            await _start_shift(db, user_id, emp, "no_coords", None)
        else:
            distance = calculate_distance(lat, lon, work.geo_lat, work.geo_lon)
            if distance > GEO_RADIUS_M:
                await _reply(
                    user_id,
                    f"Вы в {round(distance)} м от «{work.name}». Отправьте геопозицию, когда будете на месте.",
                    keyboards.start_shift(True),
                )
                return
            await _start_shift(db, user_id, emp, "verified", distance)
    finally:
        db.close()


# Any other message: location, or a friendly fallback instead of silence
@dp.message_created()
async def handle_incoming_message(event: MessageCreated):
    if not _is_dialog(event.message) or not event.message.sender:
        return
    user_id = event.message.sender.user_id
    body = event.message.body
    for att in (body.attachments or []) if body else []:
        if isinstance(att, Location) and att.latitude is not None and att.longitude is not None:
            await _handle_location(user_id, att.latitude, att.longitude)
            return
    await _reply(user_id, "Не понял 🙂 Вот что можно сделать сейчас:")
    await _send_home(user_id)
