import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import unquote

from fastapi import Header, HTTPException

from config import BOT_TOKEN, INIT_DATA_MAX_AGE_S, LINK_TOKEN_TTL_S


@dataclass
class CurrentUser:
    user_id: int
    first_name: str = ""
    last_name: str = ""
    # Launch parameter of the mini-app (OpenAppButton payload or signed link payload)
    start_param: str = ""

    @property
    def full_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.last_name) if p).strip()


def _hmac(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()


# Validate MAX mini-app launch data (https://dev.max.ru/docs/webapps/validation)
def validate_init_data(raw: str, bot_token: str = BOT_TOKEN, now: float | None = None) -> CurrentUser | None:
    if not raw or not bot_token:
        return None
    # The client may pass the string still percent-encoded as a whole
    if "=" not in raw and "%3D" in raw.upper():
        raw = unquote(raw)

    params = {}
    for pair in raw.split("&"):
        if "=" not in pair:
            continue
        key, value = pair.split("=", 1)
        params[key] = unquote(value)

    received_hash = params.pop("hash", None)
    if not received_hash:
        return None

    check_string = "\n".join(f"{k}={params[k]}" for k in sorted(params))
    secret_key = _hmac(b"WebAppData", bot_token.encode())
    expected = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash.lower()):
        return None

    auth_date = params.get("auth_date")
    if auth_date and auth_date.isdigit():
        ts = int(auth_date)
        if ts > 10**12:  # milliseconds
            ts //= 1000
        if (now or time.time()) - ts > INIT_DATA_MAX_AGE_S:
            return None

    try:
        user = json.loads(params.get("user", "{}"))
        user_id = int(user["id"])
    except (ValueError, KeyError, TypeError):
        return None

    return CurrentUser(
        user_id=user_id,
        first_name=user.get("first_name") or "",
        last_name=user.get("last_name") or "",
        start_param=params.get("start_param", ""),
    )


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _signature(body: str) -> str:
    key = _hmac(b"MaxInspectorToken", BOT_TOKEN.encode())
    return _b64(hmac.new(key, body.encode(), hashlib.sha256).digest()[:18])


# Compact signed token: base64(json).signature, with expiry
def _sign(kind: str, subject: int, ttl: int) -> str:
    body = _b64(json.dumps({"k": kind, "s": subject, "e": int(time.time()) + ttl}).encode())
    return f"{body}.{_signature(body)}"


def _verify(token: str, kind: str) -> int | None:
    try:
        body, sig = token.split(".", 1)
        if not hmac.compare_digest(_signature(body), sig):
            return None
        data = json.loads(_unb64(body))
        if data["k"] != kind or data["e"] < time.time():
            return None
        return int(data["s"])
    except (ValueError, KeyError, TypeError):
        return None


# Token for mini-app links sent by the bot in a private chat
def make_link_token(user_id: int, ttl: int = LINK_TOKEN_TTL_S) -> str:
    return _sign("user", user_id, ttl)


def verify_link_token(token: str) -> int | None:
    return _verify(token, "user")


# Short-lived URL token for files the MAX client downloads without our headers
def make_file_token(kind: str, subject_id: int, ttl: int = 600) -> str:
    return _sign(kind, subject_id, ttl)


def verify_file_token(token: str, kind: str) -> int | None:
    return _verify(token, kind)


# FastAPI dependency: the MAX user making the request
def current_user(
    x_max_init_data: str | None = Header(default=None),
    x_auth_token: str | None = Header(default=None),
    x_start_param: str | None = Header(default=None),
) -> CurrentUser:
    if x_max_init_data:
        user = validate_init_data(x_max_init_data)
        if user:
            return user
    if x_auth_token:
        user_id = verify_link_token(x_auth_token)
        if user_id:
            return CurrentUser(user_id=user_id, start_param=x_start_param or "")
    raise HTTPException(status_code=401, detail="Откройте приложение из чата с ботом в MAX")
