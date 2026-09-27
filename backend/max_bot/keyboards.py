from urllib.parse import quote

from maxapi.enums.intent import Intent
from maxapi.types.attachments.buttons import (
    CallbackButton,
    LinkButton,
    OpenAppButton,
    RequestGeoLocationButton,
)
from maxapi.utils.inline_keyboard import InlineKeyboardBuilder

from config import MINIAPP_MODE, WEBAPP_BASE
from max_bot.instance import bot_username
from services.auth import make_link_token

RETURN_REASONS = {
    "photo": "Не видно на фото",
    "notfixed": "Не устранено",
    "other": "Нужно переделать",
}


# Button that opens the mini-app; payload arrives as start_param
def app_button(text: str, user_id: int, payload: str = ""):
    if MINIAPP_MODE == "openapp" and bot_username():
        return OpenAppButton(text=text, web_app=bot_username(), payload=payload or None)
    url = f"{WEBAPP_BASE}/?t={make_link_token(user_id)}"
    if payload:
        url += f"&p={quote(payload)}"
    return LinkButton(text=text, url=url)


def single_app_button(text: str, user_id: int, payload: str = "") -> InlineKeyboardBuilder:
    return InlineKeyboardBuilder().row(app_button(text, user_id, payload))


def role_choice() -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    builder.row(CallbackButton(text="Я владелец или управляющий", payload="role_owner"))
    builder.row(CallbackButton(text="Я сотрудник", payload="role_employee"))
    builder.row(CallbackButton(text="Посмотреть демо-кафе", payload="demo"))
    return builder


# With geo control the shift starts from a location sent via the native MAX button
def start_shift_button(geo_required: bool):
    if geo_required:
        return RequestGeoLocationButton(text="Начать смену — я на месте", quick=True)
    return CallbackButton(text="Начать смену", payload="start_shift")


def owner_menu(user_id: int, setup_done: bool, shift_state: str | None, geo_required: bool) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    if not setup_done:
        builder.row(app_button("Продолжить настройку", user_id, "setup"))
        return builder
    builder.row(app_button("Открыть кабинет", user_id, "home"))
    # Owner who also works shifts
    if shift_state == "off":
        builder.row(start_shift_button(geo_required))
    elif shift_state == "on":
        builder.row(app_button("Моя смена", user_id, "shift"))
        builder.row(CallbackButton(text="Завершить смену", payload="end_shift"))
    return builder


def facility_geo_request() -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    builder.row(RequestGeoLocationButton(text="Отправить геопозицию заведения", quick=True))
    builder.row(CallbackButton(text="Позже", payload="geo_later"))
    return builder


def start_shift(geo_required: bool) -> InlineKeyboardBuilder:
    return InlineKeyboardBuilder().row(start_shift_button(geo_required))


def active_shift(user_id: int) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    builder.row(app_button("Моя смена", user_id, "shift"))
    builder.row(CallbackButton(text="Завершить смену", payload="end_shift"))
    return builder


def end_shift_confirm(left: int) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    builder.row(CallbackButton(text=f"Да, завершить (осталось {left})", payload="end_shift_force", intent=Intent.NEGATIVE))
    return builder


def accept_invite(token: str) -> InlineKeyboardBuilder:
    return InlineKeyboardBuilder().row(CallbackButton(text="Да, это я", payload=f"inv_{token}", intent=Intent.POSITIVE))


def defect_card(user_id: int, defect_id: int) -> InlineKeyboardBuilder:
    return single_app_button("Открыть задачу", user_id, f"defect_{defect_id}")


def review(defect_id: int) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    builder.row(
        CallbackButton(text="Принять", payload=f"accept_{defect_id}", intent=Intent.POSITIVE),
        CallbackButton(text="Вернуть", payload=f"return_{defect_id}", intent=Intent.NEGATIVE),
    )
    return builder


def return_reasons(defect_id: int) -> InlineKeyboardBuilder:
    builder = InlineKeyboardBuilder()
    for key, text in RETURN_REASONS.items():
        builder.row(CallbackButton(text=text, payload=f"ret_{defect_id}_{key}"))
    return builder
