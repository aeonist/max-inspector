import logging
import re

from maxapi import F
from maxapi.enums.chat_type import ChatType
from maxapi.filters.command import CommandStart
from maxapi.types import BotStarted, MessageCallback, MessageCreated
from sqlalchemy.orm import Session

from database import SessionLocal
from max_bot import keyboards
from max_bot.instance import bot, dp
from models import Defect, Employee, Facility
from services import audit, notifier
from services.demo import start_demo
from services.facility import (
    checkin_code_valid,
    claim_invite,
    create_facility,
    employee_by_invite,
    employee_of,
    owner_facility,
)
from services.shifts import active_shift, close_shift, open_shift, shift_stats
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
            return text, keyboards.owner_menu(user_id, False, None, fac.qr_checkin)
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
        return "\n".join(lines), keyboards.owner_menu(user_id, True, shift_state, fac.qr_checkin)

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
        how = "отсканируйте QR «Начало смены» на рабочем месте" if fac.qr_checkin else "нажмите кнопку ниже"
        text = f"«{fac.name}» · {emp.full_name}, {emp.position}\nЧтобы начать смену, {how}."
        return text, keyboards.start_shift(user_id, fac.qr_checkin)

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


# Personal invite: https://max.ru/<bot>?start=inv_<token>, meant for exactly one staff member
async def _handle_invite(user_id: int, token: str) -> None:
    db = SessionLocal()
    try:
        emp = employee_by_invite(db, token)
        if not emp:
            await _reply(user_id, "Приглашение уже использовано или устарело. Попросите руководителя прислать новое.")
            return
        if emp.facility.owner_user_id == user_id:
            await _reply(user_id, f"Это личное приглашение для сотрудника {emp.full_name} — перешлите его ему.")
            return
        await _reply(
            user_id,
            f"Приглашение в команду «{emp.facility.name}».\nВы — {emp.full_name}, {emp.position}?",
            keyboards.accept_invite(token),
        )
    finally:
        db.close()


# Links of the first version (one link for the whole team) no longer work
async def _legacy_join(user_id: int) -> None:
    await _reply(
        user_id,
        "Эта ссылка больше не работает: теперь у каждого сотрудника личное приглашение. Попросите руководителя прислать его.",
    )


async def _handle_payload(user_id: int, payload: str) -> None:
    match = re.search(r"(inv|join|chk)_([\w-]+)", payload)
    if match and match.group(1) == "inv":
        await _handle_invite(user_id, match.group(2))
    elif match and match.group(1) == "chk":
        await _handle_checkin(user_id, payload)
    elif match:
        await _legacy_join(user_id)
    else:
        await _send_home(user_id)


# Handle first start, including deep links with a payload
@dp.bot_started()
async def handle_bot_started(event: BotStarted):
    user_id = event.user.user_id
    await _handle_payload(user_id, event.payload or "")


# Handle /start command (optionally with a payload)
@dp.message_created(CommandStart())
async def handle_start(event: MessageCreated):
    if not _is_dialog(event.message) or not event.message.sender:
        return
    user_id = event.message.sender.user_id
    text = (event.message.body.text or "") if event.message.body else ""
    await _handle_payload(user_id, text)


@dp.message_callback(F.callback.payload == "role_owner")
async def callback_role_owner(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    db = SessionLocal()
    try:
        fac = create_facility(db, user_id)
        setup_done = fac.setup_done
    except ValueError as e:
        await callback.ack()
        await _reply(user_id, str(e))
        await _send_home(user_id)
        return
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
        "Демо-кафе «Зерно» готово (тестовые данные), готовность 87%. В кабинете одно исправление ждёт "
        "вашей проверки, в «Моей смене» — нарушение, которое вы исправите сами. Закройте три нарушения — "
        "и заведение готово к проверке.",
        keyboards.single_app_button("Открыть кабинет", user.user_id, "home"),
    )


@dp.message_callback(F.callback.payload == "role_employee")
async def callback_role_employee(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    await callback.ack()
    await _reply(
        user_id,
        "Попросите руководителя прислать вам личное приглашение в MAX — или отсканируйте QR с экрана его телефона.",
        keyboards.single_app_button("Сканировать QR", user_id, "scan"),
    )


@dp.message_callback(F.callback.payload.startswith("inv_"))
async def callback_accept_invite(callback: MessageCallback):
    user_id = callback.callback.user.user_id
    token = (callback.callback.payload or "").removeprefix("inv_")
    await callback.ack()
    db = SessionLocal()
    try:
        emp = employee_by_invite(db, token)
        if not emp:
            await _reply(user_id, "Приглашение уже использовано или устарело. Попросите руководителя прислать новое.")
            return
        try:
            claim_invite(db, emp, user_id)
        except ValueError as e:
            await _reply(user_id, str(e))
            return
        fac = emp.facility
        await notifier.send_staff_joined(fac, emp)
        await _reply(
            user_id,
            f"Готово! Вы в команде «{fac.name}»: {emp.full_name}, {emp.position}.",
            keyboards.start_shift(user_id, fac.qr_checkin),
        )
    finally:
        db.close()


# Open a shift and tell the employee what is next
async def _start_shift(db: Session, user_id: int, emp: Employee, checkin: str) -> None:
    shift, _ = open_shift(db, emp, checkin)
    stats = shift_stats(db, emp, shift)
    lines = [f"Смена открыта в {format_local_time(shift.started_at)} ✅" + (" · по QR на месте" if checkin == "qr" else "")]
    lines.append(f"Задач на смену: {stats['total']}.")
    urgent = _urgent_count(db, emp)
    if urgent:
        lines.append(f"Срочно исправить: {urgent}.")
    await _reply(user_id, "\n".join(lines), keyboards.active_shift(user_id))


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
        if emp.facility.qr_checkin:
            await _reply(user_id, "Смена начинается по QR на рабочем месте.", keyboards.start_shift(user_id, True))
            return
        await _start_shift(db, user_id, emp, "button")
    finally:
        db.close()


# "Начало смены" QR scanned by a phone camera: https://max.ru/<bot>?start=chk_<token>
async def _handle_checkin(user_id: int, scanned: str) -> None:
    db = SessionLocal()
    try:
        emp = employee_of(db, user_id)
        if not emp:
            await _reply(user_id, "Сначала подключитесь к заведению по личному приглашению руководителя.")
            return
        if not checkin_code_valid(emp.facility, scanned):
            await _reply(user_id, "Это не QR «Начало смены» вашего заведения или он устарел. Спросите у руководителя новый.")
            return
        await _start_shift(db, user_id, emp, "qr")
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
        await _reply(user_id, text + ". Спасибо!", keyboards.start_shift(user_id, emp.facility.qr_checkin))
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


# Any other message: a friendly fallback instead of silence
@dp.message_created()
async def handle_incoming_message(event: MessageCreated):
    if not _is_dialog(event.message) or not event.message.sender:
        return
    user_id = event.message.sender.user_id
    await _reply(user_id, "Не понял 🙂 Вот что можно сделать сейчас:")
    await _send_home(user_id)
