import asyncio

from conftest import OWNER, STAFF, headers, invite_token, join

from database import SessionLocal
from max_bot import handlers
from models import Employee, Facility, Shift


def run(coro):
    return asyncio.run(coro)


def _facility() -> Facility:
    db = SessionLocal()
    fac = db.query(Facility).first()
    db.expunge(fac)
    db.close()
    return fac


def test_home_for_new_user_offers_roles(sent):
    run(handlers._send_home(555))
    assert "Кто вы?" in sent.to(555)[-1]["text"]


def _qr_on(client) -> str:
    state = client.put("/api/owner/setup", headers=headers(OWNER), json={**_setup(), "qr_checkin": True}).json()
    assert state["qr_checkin"] is True
    db = SessionLocal()
    token = db.query(Facility).first().checkin_token
    db.close()
    return token


def test_shift_starts_only_with_the_workplace_qr(client, facility, sent):
    token = _qr_on(client)
    join(client, STAFF, "Мария Петрова")
    h = headers(STAFF)
    # Without a code or with a wrong one the shift does not start
    assert client.post("/api/shift/start", headers=h).status_code == 403
    assert client.post("/api/shift/start", headers=h, json={"code": "chk_wrong"}).status_code == 403
    # The MAX scanner returns the QR text: the bot link with the token
    res = client.post("/api/shift/start", headers=h, json={"code": f"https://max.ru/test_bot?start=chk_{token}"})
    assert res.status_code == 200 and res.json()["shift"]["checkin"] == "qr"


def test_phone_camera_scan_opens_shift_via_bot(client, facility, sent):
    token = _qr_on(client)
    join(client, STAFF, "Мария Петрова")
    run(handlers._handle_payload(STAFF, "chk_wrong"))
    assert "не QR «Начало смены»" in sent.to(STAFF)[-1]["text"]
    run(handlers._handle_payload(STAFF, f"chk_{token}"))
    assert "Смена открыта" in sent.to(STAFF)[-1]["text"]
    db = SessionLocal()
    emp = db.query(Employee).filter(Employee.user_id == STAFF).one()
    assert db.query(Shift).filter(Shift.employee_id == emp.id).one().checkin == "qr"
    db.close()


def test_reissued_qr_invalidates_the_old_one(client, facility):
    old = _qr_on(client)
    client.post("/api/owner/checkin/reissue", headers=headers(OWNER))
    join(client, STAFF, "Мария Петрова")
    assert client.post("/api/shift/start", headers=headers(STAFF), json={"code": f"chk_{old}"}).status_code == 403
    files = client.get("/api/owner/state", headers=headers(OWNER)).json()["files"]
    assert client.get(files["checkin"]["url"]).content.startswith(b"%PDF")


def test_personal_invite_via_deep_link(client, facility, sent):
    token = invite_token(client, "Мария Петрова")
    run(handlers._handle_payload(STAFF, f"inv_{token}"))
    message = sent.to(STAFF)[-1]
    assert "Вы — Мария Петрова, Повар?" in message["text"]
    assert message["attachments"][0].payload.buttons[0][0].payload == f"inv_{token}"

    # Old team-wide links explain what to do instead of failing silently
    run(handlers._handle_payload(STAFF, "join_oldtoken"))
    assert "личное приглашение" in sent.to(STAFF)[-1]["text"]


def test_owner_home_shows_readiness_and_shift_button(client, facility, sent):
    run(handlers._send_home(OWNER))
    message = sent.to(OWNER)[-1]
    assert "Готовность к проверке" in message["text"]
    labels = [row[0].text for row in message["attachments"][0].payload.buttons]
    assert "Открыть кабинет" in labels
    assert "Начать смену" in labels  # QR check-in is off in the fixture


def _setup() -> dict:
    return {
        "name": "Кофейня Зерно",
        "positions": ["Повар", "Официант"],
        "owner_works_shift": True,
    }
