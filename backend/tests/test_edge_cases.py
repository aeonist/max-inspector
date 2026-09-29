import asyncio
import threading
from types import SimpleNamespace

import pytest
from conftest import OWNER, STAFF, headers, invite_token, join
from maxapi.exceptions.max import InvalidToken
from PIL import Image

import main
from database import SessionLocal
from max_bot import handlers, instance
from models import Defect, Employee, Facility, Shift, ShiftTask
from services.shifts import open_shift, set_task_done

FRYER_ITEM = 26  # cook's duty in the fixture facility


def run(coro):
    return asyncio.run(coro)


def _callback(user_id: int, payload: str = ""):
    async def ack(**kwargs):
        return None

    return SimpleNamespace(callback=SimpleNamespace(user=SimpleNamespace(user_id=user_id), payload=payload), ack=ack)


# ---------- Bot start survives a MAX API outage ----------


def test_bot_start_is_retried_after_api_outage(monkeypatch):
    calls = {"username": 0, "polling": 0}

    async def flaky_username():
        calls["username"] += 1
        if calls["username"] == 1:
            raise ConnectionError("MAX API is down")
        return "test_bot"

    async def fake_polling(bot):
        calls["polling"] += 1

    monkeypatch.setattr(main, "resolve_username", flaky_username)
    monkeypatch.setattr(main.dp, "start_polling", fake_polling)
    monkeypatch.setattr(main, "BOT_RETRY_FIRST_DELAY", 0)
    run(main.run_bot())
    assert calls == {"username": 2, "polling": 1}


def test_bot_with_invalid_token_is_not_retried(monkeypatch):
    calls = []

    async def bad_polling(bot):
        calls.append(1)
        raise InvalidToken("bad token")

    monkeypatch.setattr(main, "resolve_username", lambda: asyncio.sleep(0, "test_bot"))
    monkeypatch.setattr(main.dp, "start_polling", bad_polling)
    run(main.run_bot())
    assert calls == [1]


def test_username_lookup_failure_is_not_cached(monkeypatch):
    monkeypatch.setattr(instance, "_username", "")

    async def down():
        raise ConnectionError("MAX API is down")

    monkeypatch.setattr(instance.bot, "get_me", down)
    with pytest.raises(ConnectionError):
        run(instance.resolve_username())

    async def up():
        return SimpleNamespace(username="inspector_bot")

    monkeypatch.setattr(instance.bot, "get_me", up)
    assert run(instance.resolve_username()) == "inspector_bot"
    assert instance.bot_username() == "inspector_bot"


# ---------- Owner reviewing their own fix ----------


def test_owner_is_not_thanked_for_own_fix(client, facility, sent, upload):
    h = headers(OWNER)
    defect = client.put(
        f"/api/owner/audit/{FRYER_ITEM}", headers=h, json={"status": "violation", "photos": [upload(OWNER)]}
    ).json()["defect"]
    client.post("/api/shift/start", headers=h)
    client.post(f"/api/defects/{defect['id']}/fix", headers=h, json={"photos": [upload(OWNER)]})
    run(handlers.callback_accept(_callback(OWNER, f"accept_{defect['id']}")))
    texts = [m["text"] for m in sent.to(OWNER)]
    assert any(t.startswith("✅ Принято") for t in texts)
    assert not any("Спасибо" in t for t in texts)


def test_staff_is_thanked_for_accepted_fix(client, facility, sent, upload):
    join(client, STAFF, "Мария Петрова")
    defect = client.put(
        f"/api/owner/audit/{FRYER_ITEM}", headers=headers(OWNER), json={"status": "violation", "photos": [upload(OWNER)]}
    ).json()["defect"]
    client.post(f"/api/defects/{defect['id']}/fix", headers=headers(STAFF), json={"photos": [upload(STAFF)]})
    client.post(f"/api/owner/defects/{defect['id']}/accept", headers=headers(OWNER))
    assert "Спасибо" in sent.to(STAFF)[-1]["text"]


# ---------- Roles and leaving a facility ----------


def test_staff_member_cannot_become_owner(client, facility, sent):
    join(client, STAFF, "Мария Петрова")
    res = client.post("/api/facility", headers=headers(STAFF))
    assert res.status_code == 409 and "как сотрудник" in res.json()["detail"]

    # An old "Я владелец" button in the chat: the shift menu stays
    run(handlers.callback_role_owner(_callback(STAFF)))
    assert "как сотрудник" in sent.to(STAFF)[-2]["text"]
    assert "Мария Петрова" in sent.to(STAFF)[-1]["text"]
    db = SessionLocal()
    assert db.query(Facility).filter(Facility.owner_user_id == STAFF).count() == 0
    db.close()


def test_deleting_facility_releases_the_team(client, facility, sent):
    join(client, STAFF, "Мария Петрова")
    unused = invite_token(client, "Айдар Галиев")
    assert client.delete("/api/owner/facility", headers=headers(OWNER)).status_code == 200

    # The joined cook is free again, and invites of the deleted facility stop working
    assert client.get("/api/me", headers=headers(STAFF)).json()["employee"] is None
    assert client.post(f"/api/invite/{unused}", headers=headers(3003)).status_code == 404

    # The owner starts over and invites the same person again
    h = headers(OWNER)
    client.post("/api/facility", headers=h)
    client.put(
        "/api/owner/setup",
        headers=h,
        json={"name": "Новое кафе", "positions": ["Повар"], "new_staff": [{"full_name": "Мария Петрова", "position": "Повар"}]},
    )
    join(client, STAFF, "Мария Петрова")
    assert client.get("/api/me", headers=headers(STAFF)).json()["employee"]["facility_name"] == "Новое кафе"


def test_removed_last_cook_hands_violations_to_owner(client, facility, sent, upload):
    join(client, STAFF, "Мария Петрова")
    h = headers(OWNER)
    defect = client.put(
        f"/api/owner/audit/{FRYER_ITEM}", headers=h, json={"status": "violation", "photos": [upload(OWNER)]}
    ).json()["defect"]
    assert defect["to_owner"] is False

    staff = client.get("/api/owner/state", headers=h).json()["staff"]
    cook = next(s for s in staff if s["full_name"] == "Мария Петрова")
    assert client.delete(f"/api/owner/staff/{cook['id']}", headers=h).status_code == 200
    state = client.get("/api/owner/state", headers=h).json()
    assert next(d for d in state["defects"] if d["id"] == defect["id"])["to_owner"] is True
    # The owner can now close it with a photo, and readiness is not blocked
    res = client.post(f"/api/owner/defects/{defect['id']}/resolve", headers=h, json={"photos": [upload(OWNER)]})
    assert res.status_code == 200 and res.json()["summary"]["unresolved"] == 0


# ---------- Bad input gets an answer, not a server error ----------


def test_non_ascii_signature_is_rejected(client):
    res = client.get("/api/me", headers={"X-Max-Init-Data": "user=%7B%7D&hash=%C3%A9"})
    assert res.status_code == 401


def test_foreign_qr_with_cyrillic_is_rejected(client, facility, sent):
    client.patch("/api/owner/settings", headers=headers(OWNER), json={"qr_checkin": True})
    join(client, STAFF, "Мария Петрова")
    res = client.post("/api/shift/start", headers=headers(STAFF), json={"code": "https://кафе.рф/меню"})
    assert res.status_code == 403
    run(handlers._handle_payload(STAFF, "chk_тест"))
    assert "не QR «Начало смены»" in sent.to(STAFF)[-1]["text"]


def test_photo_with_huge_resolution_is_rejected(client, monkeypatch):
    from conftest import jpeg_bytes

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)  # 64x48 is then a "decompression bomb"
    res = client.post(
        "/api/upload", files={"file": ("big.jpg", jpeg_bytes(), "image/jpeg")}, headers=headers(OWNER)
    )
    assert res.status_code == 413


# ---------- Double taps ----------


def _in_threads(count: int, fn) -> list:
    errors = []
    barrier = threading.Barrier(count)

    def worker():
        db = SessionLocal()
        try:
            barrier.wait()
            fn(db)
        except Exception as e:  # collected for the assertion
            errors.append(e)
        finally:
            db.close()

    threads = [threading.Thread(target=worker) for _ in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def test_double_tap_opens_one_shift_and_one_task(client, facility):
    db = SessionLocal()
    owner_emp_id = db.query(Employee).filter(Employee.user_id == OWNER).one().id
    db.close()

    def start(db):
        open_shift(db, db.get(Employee, owner_emp_id), "button")

    assert _in_threads(8, start) == []
    db = SessionLocal()
    shifts = db.query(Shift).filter(Shift.employee_id == owner_emp_id, Shift.ended_at.is_(None)).all()
    assert len(shifts) == 1
    shift_id = shifts[0].id
    db.close()

    def tick(db):
        set_task_done(db, db.get(Shift, shift_id), FRYER_ITEM, True, [])

    assert _in_threads(6, tick) == []
    db = SessionLocal()
    assert db.query(ShiftTask).filter(ShiftTask.shift_id == shift_id).count() == 1
    db.close()


# ---------- Demo ----------


def test_demo_return_sends_the_fix_back_to_the_cook(client, sent):
    h = headers(OWNER, "Алия")
    client.post("/api/facility/demo", headers=h)
    review = next(d for d in client.get("/api/owner/state", headers=h).json()["defects"] if d["status"] == "fixed")
    res = client.post(f"/api/owner/defects/{review['id']}/return", headers=h, json={"reason": "Не устранено"})
    assert res.json()["defect"]["status"] == "returned"
    db = SessionLocal()
    defect = db.get(Defect, review["id"])
    assert defect.to_owner is False and defect.assigned_position == "Повар"
    db.close()
