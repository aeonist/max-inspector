import asyncio

from conftest import OWNER, STAFF, headers, invite_token, join

from database import SessionLocal
from max_bot import handlers
from models import Employee, Facility, Shift

KAZAN = (55.7887, 49.1221)
FAR_AWAY = (55.7558, 37.6173)  # Moscow


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


def test_owner_location_sets_facility_place(client, facility, sent):
    client.put("/api/owner/setup", headers=headers(OWNER), json={**_setup(), "geo_required": True})
    run(handlers._handle_location(OWNER, *KAZAN))
    fac = _facility()
    assert (fac.geo_lat, fac.geo_lon) == KAZAN
    assert "Место заведения сохранено" in sent.to(OWNER)[-2]["text"]


def test_staff_far_away_cannot_open_shift(client, facility, sent):
    client.put("/api/owner/setup", headers=headers(OWNER), json={**_setup(), "geo_required": True})
    run(handlers._handle_location(OWNER, *KAZAN))
    join(client, STAFF, "Мария Петрова")

    run(handlers._handle_location(STAFF, *FAR_AWAY))
    assert "Отправьте геопозицию, когда будете на месте" in sent.to(STAFF)[-1]["text"]

    run(handlers._handle_location(STAFF, KAZAN[0] + 0.0005, KAZAN[1]))  # ~55 m away
    assert "Смена открыта" in sent.to(STAFF)[-1]["text"]
    db = SessionLocal()
    emp = db.query(Employee).filter(Employee.user_id == STAFF).one()
    shift = db.query(Shift).filter(Shift.employee_id == emp.id).one()
    assert shift.geo_status == "verified"
    db.close()


def test_shift_without_facility_place_is_marked(client, facility, sent):
    client.put("/api/owner/setup", headers=headers(OWNER), json={**_setup(), "geo_required": True})
    join(client, STAFF, "Мария Петрова")
    run(handlers._handle_location(STAFF, *FAR_AWAY))
    assert "Место не проверено" in sent.to(STAFF)[-1]["text"]
    # The owner is asked to mark the place instead of the bot pretending geo is off
    assert "место заведения не отмечено" in sent.to(OWNER)[-1]["text"]


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
    assert "Начать смену" in labels  # geo is off in the fixture


def _setup() -> dict:
    return {
        "name": "Кофейня Зерно",
        "positions": ["Повар", "Официант"],
        "owner_works_shift": True,
    }
