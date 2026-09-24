import logging
from bot.instance import bot
from bot.keyboards import (
    get_owner_dashboard_keyboard,
    get_request_geo_keyboard,
)

logger = logging.getLogger(__name__)


# Notify owner that facility was created or updated
async def notify_owner_facility_saved(user_id: int, facility_code: str, facility_name: str):
    try:
        builder = get_owner_dashboard_keyboard(facility_code, user_id)
        await bot.send_message(
            user_id=user_id,
            text=(
                "Регистрация заведения завершена.\n\n"
                f"Наименование: {facility_name}\n"
                f"Регистрационный номер: {facility_code}\n\n"
                "Номер объекта предназначен для передачи сотрудникам.\n"
                "Для перехода к управлению используйте кнопку ниже:"
            ),
            attachments=[builder.as_markup()],
        )
    except Exception as e:
        logger.error(f"Failed to notify owner {user_id}: {e}")


# Notify employee upon register or claim
async def notify_employee_registered(
    user_id: int, full_name: str, position: str, facility_identifier: str
):
    try:
        builder = get_request_geo_keyboard()
        await bot.send_message(
            user_id=user_id,
            text=(
                "Регистрация сотрудника завершена.\n\n"
                f"Сотрудник: {full_name}\n"
                f"Должность: {position}\n"
                f"Заведение: {facility_identifier}\n\n"
                "Для открытия смены подтвердите фактическое присутствие на объекте:"
            ),
            attachments=[builder.as_markup()],
        )
    except Exception as e:
        logger.error(f"Failed to notify employee {user_id}: {e}")
