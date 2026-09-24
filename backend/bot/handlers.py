import json
import logging
import re
from datetime import datetime

from maxapi import F
from maxapi.filters.command import CommandStart
from maxapi.types import MessageCallback, MessageCreated
from maxapi.types.attachments.location import Location

from bot.instance import dp
from bot.keyboards import (
    get_employee_active_shift_keyboard,
    get_employee_claim_keyboard,
    get_employee_tasks_link_keyboard,
    get_owner_actions_keyboard,
    get_owner_dashboard_keyboard,
    get_owner_setup_keyboard,
    get_request_geo_keyboard,
    get_role_choice_keyboard,
)
from database import SessionLocal
from models import Employee, Facility
from utils.generators import (
    generate_unique_facility_code,
)
from utils.geo import calculate_distance
from utils.shifts import expire_old_shifts

logger = logging.getLogger(__name__)


# Handle /start command
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
                builder = get_owner_dashboard_keyboard(fac.code, user_id)
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

                if emp.shift_active:
                    time_str = (
                        emp.shift_started_at.strftime("%H:%M")
                        if emp.shift_started_at
                        else ""
                    )
                    builder = get_employee_active_shift_keyboard(
                        fac.code, user_id, emp.id
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
                    builder = get_request_geo_keyboard()
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

        builder = get_role_choice_keyboard()
        await event.message.answer(
            text=(
                "МАХ-Инспектор. Система контроля санитарных требований и подготовки к проверкам органов надзора.\n\n"
                "Выберите ваш статус в системе:"
            ),
            attachments=[builder.as_markup()],
        )
    finally:
        db.close()


# Owner role chosen
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
            builder = get_owner_dashboard_keyboard(fac.code, user_id)
            await callback.message.answer(
                text=(
                    f"Заведение: {fac.name}\n"
                    f"Регистрационный номер: {fac.code}\n\n"
                    "Для перехода в панель управления используйте кнопку ниже:"
                ),
                attachments=[builder.as_markup()],
            )
        else:
            builder = get_owner_actions_keyboard()
            await callback.message.answer(
                text=(
                    "Панель руководителя.\n\n"
                    "Выберите необходимое действие:"
                ),
                attachments=[builder.as_markup()],
            )
    finally:
        db.close()


# Create new facility
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

        builder = get_owner_setup_keyboard(fac.code, user_id)
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


# Prompt login to existing facility
@dp.message_callback(F.callback.payload == "owner_login_existing")
async def callback_owner_login_existing(callback: MessageCallback):
    await callback.message.answer(
        text=(
            "Для входа в существующее заведение отправьте в чат регистрационный номер и ПИН-код через пробел.\n\n"
            "Пример сообщения: 4819-2051 7391"
        )
    )


# Prompt employee facility code
@dp.message_callback(F.callback.payload == "role_employee")
async def callback_role_employee(callback: MessageCallback):
    await callback.message.answer(
        text=(
            "Для привязки к заведению отправьте в чат регистрационный номер заведения.\n\n"
            "Пример сообщения: 4819-2051\n"
            "Номер выдается руководителем заведения."
        )
    )


# Claim specific employee profile
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

        builder = get_request_geo_keyboard()
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
                            builder = get_employee_active_shift_keyboard(
                                fac.code, user_id, emp.id
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
                            builder = get_request_geo_keyboard()
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
                        builder = get_employee_tasks_link_keyboard(fac.code, user_id)
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
                    if emp_existing.shift_active:
                        builder = get_employee_active_shift_keyboard(
                            fac.code, user_id, emp_existing.id
                        )
                    else:
                        builder = get_request_geo_keyboard()
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

                builder = get_employee_claim_keyboard(unlinked)
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
                    builder = get_owner_dashboard_keyboard(fac.code, user_id)
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

                    builder = get_request_geo_keyboard()
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
