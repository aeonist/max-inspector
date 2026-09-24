from maxapi.types.attachments.buttons import (
    CallbackButton,
    LinkButton,
    RequestGeoLocationButton,
)
from maxapi.utils.inline_keyboard import InlineKeyboardBuilder
from config import WEBAPP_BASE


# Owner dashboard link keyboard
def get_owner_dashboard_keyboard(code: str, user_id: int | None) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    uid = user_id or 0
    builder.row(
        LinkButton(
            text="Панель управления заведением",
            url=f"{WEBAPP_BASE}?role=owner&code={code}&user_id={uid}",
        )
    )
    return builder


# Owner setup link keyboard
def get_owner_setup_keyboard(code: str, user_id: int | None) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    uid = user_id or 0
    builder.row(
        LinkButton(
            text="Настроить заведение",
            url=f"{WEBAPP_BASE}?role=owner&mode=new&code={code}&user_id={uid}",
        )
    )
    return builder


# Main role selection keyboard
def get_role_choice_keyboard() -> InlineKeyboardBuilder:
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
    return builder


# Owner options: create new or login existing
def get_owner_actions_keyboard() -> InlineKeyboardBuilder:
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
    return builder


# Request geolocation button
def get_request_geo_keyboard() -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    builder.row(
        RequestGeoLocationButton(
            text="Подтвердить присутствие на объекте",
            quick=True,
        )
    )
    return builder


# Employee active shift keyboard
def get_employee_active_shift_keyboard(
    code: str, user_id: int, employee_id: int
) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    builder.row(
        LinkButton(
            text="Список задач на смену",
            url=f"{WEBAPP_BASE}?role=employee&code={code}&user_id={user_id}",
        )
    )
    builder.row(
        CallbackButton(
            text="Завершить смену",
            payload=f"end_shift_{employee_id}",
        )
    )
    return builder


# Employee shift tasks link without end button
def get_employee_tasks_link_keyboard(code: str, user_id: int) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    builder.row(
        LinkButton(
            text="Список задач на смену",
            url=f"{WEBAPP_BASE}?role=employee&code={code}&user_id={user_id}",
        )
    )
    return builder


# Employee claim selection keyboard
def get_employee_claim_keyboard(unlinked_employees: list) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    for e in unlinked_employees:
        builder.row(
            CallbackButton(
                text=f"{e.full_name} - {e.position}",
                payload=f"claim_emp_{e.id}",
            )
        )
    return builder
