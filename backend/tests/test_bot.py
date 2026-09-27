import asyncio

from conftest import OWNER, STAFF, headers

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
    _join_as(client, facility, STAFF, "Мария Петрова")

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
    _join_as(client, facility, STAFF, "Мария Петрова")
    run(handlers._handle_location(STAFF, *FAR_AWAY))
    assert "Место не проверено" in sent.to(STAFF)[-1]["text"]
    # The owner is asked to mark the place instead of the bot pretending geo is off
    assert "место заведения не отмечено" in sent.to(OWNER)[-1]["text"]


def test_join_via_deep_link_lists_free_profiles(client, facility, sent):
    token = facility["invite_url"].split("join_")[1]
    run(handlers._handle_join(STAFF, token))
    message = sent.to(STAFF)[-1]
    assert "Кто вы?" in message["text"]
    buttons = message["attachments"][0].payload.buttons
    labels = [row[0].text for row in buttons]
    assert "Мария Петрова — Повар" in labels
    assert not any("Алия" in label for label in labels)  # the owner's profile is taken


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
        "owner_position": "Повар",
    }


def _join_as(client, facility, user_id, name):
    token = facility["invite_url"].split("join_")[1]
    free = client.get(f"/api/join/{token}", headers=headers(user_id)).json()["free"]
    emp_id = next(e["id"] for e in free if e["full_name"] == name)
    assert client.post(f"/api/join/{token}", headers=headers(user_id), json={"employee_id": emp_id}).status_code == 200
