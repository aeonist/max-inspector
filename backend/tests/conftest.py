import hashlib
import hmac
import io
import json
import os
import shutil
import tempfile
import time
from urllib.parse import quote

import pytest

# Isolated data and a fake bot token before the app reads its config
_DATA = tempfile.mkdtemp(prefix="max-inspector-test-")
os.environ.update(
    {
        "DATA_DIR": _DATA,
        "UPLOADS_DIR": os.path.join(_DATA, "uploads"),
        "BOT_TOKEN": "test-token",
        "BOT_USERNAME": "test_bot",
        "BOT_POLLING": "0",
        "GEO_RADIUS_M": "150",
    }
)

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import main  # noqa: E402
from database import Base, engine  # noqa: E402
from max_bot.instance import bot  # noqa: E402

TOKEN = "test-token"


# initData signed the way MAX signs it (https://dev.max.ru/docs/webapps/validation)
def make_init_data(user_id: int, first_name: str = "Тест", start_param: str = "", auth_date: int | None = None) -> str:
    params = {
        "auth_date": str(auth_date or int(time.time())),
        "query_id": "q1",
        "user": json.dumps({"id": user_id, "first_name": first_name, "last_name": ""}, ensure_ascii=False),
    }
    if start_param:
        params["start_param"] = start_param
    check = "\n".join(f"{k}={params[k]}" for k in sorted(params))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    params["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return "&".join(f"{k}={quote(v)}" for k, v in params.items())


def headers(user_id: int, name: str = "Тест", start_param: str = "") -> dict:
    return {"X-Max-Init-Data": make_init_data(user_id, name, start_param)}


class SentMessages(list):
    def to(self, user_id):
        return [m for m in self if m["user_id"] == user_id]


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    main.init_db()
    yield


@pytest.fixture
def sent(monkeypatch):
    messages = SentMessages()

    async def fake_send_message(user_id=None, chat_id=None, text=None, attachments=None, **kwargs):
        messages.append({"user_id": user_id, "text": text, "attachments": attachments or []})

    monkeypatch.setattr(bot, "send_message", fake_send_message)
    return messages


@pytest.fixture
def client():
    return TestClient(main.app)


def jpeg_bytes(color=(200, 50, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def upload(client):
    def _upload(user_id: int) -> str:
        res = client.post(
            "/api/upload",
            files={"file": ("photo.jpg", jpeg_bytes(), "image/jpeg")},
            headers=headers(user_id),
        )
        assert res.status_code == 200, res.text
        return res.json()["url"]

    return _upload


OWNER = 1001
STAFF = 2002


# Owner who also works as a cook, plus a waiter and a cook in the roster
@pytest.fixture
def facility(client, sent):
    h = headers(OWNER, "Алия")
    assert client.post("/api/facility", headers=h).status_code == 200
    res = client.put(
        "/api/owner/setup",
        headers=h,
        json={
            "name": "Кофейня Зерно",
            "address": "Казань, ул. Баумана, 1",
            "geo_required": False,
            "positions": ["Повар", "Официант"],
            "features": ["Используется фритюр"],
            "new_staff": [
                {"full_name": "Айдар Галиев", "position": "Официант"},
                {"full_name": "Мария Петрова", "position": "Повар"},
            ],
            "owner_works_shift": True,
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_DATA, ignore_errors=True)
