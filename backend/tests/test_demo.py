from conftest import OWNER, headers


def test_demo_cafe_has_the_whole_cycle_ready(client, sent):
    h = headers(OWNER, "Алия")
    assert client.post("/api/facility/demo", headers=h).status_code == 200
    state = client.get("/api/owner/state", headers=h).json()

    assert state["qr_checkin"] is False  # passable from the web version of MAX
    assert "тестовые данные" in state["address"]
    assert state["owner_works_shift"] is True
    statuses = sorted(d["status"] for d in state["defects"])
    assert statuses == ["fixed", "open", "open"]
    review = next(d for d in state["defects"] if d["status"] == "fixed")
    assert review["before_photos"][0].startswith("/uploads/") and review["after_photos"][0].startswith("/uploads/")

    # Accepting the waiting fix raises the index
    res = client.post(f"/api/owner/defects/{review['id']}/accept", headers=h).json()
    assert res["summary"]["index"] > state["summary"]["index"]
    # Nobody is messaged while the demo is created
    assert not [m for m in sent if "Нарушение" in (m["text"] or "")]


# The quick path of the README ends with "Готово к проверке"
def test_demo_reaches_readiness_after_closing_its_violations(client, sent, upload):
    h = headers(OWNER, "Алия")
    client.post("/api/facility/demo", headers=h)
    summary = client.get("/api/owner/state", headers=h).json()["summary"]
    assert 80 <= summary["index"] < 90 and not summary["ready"]
    assert summary["answered"] < summary["total"]  # something left for "Продолжить аудит"

    defects = client.get("/api/owner/state", headers=h).json()["defects"]
    review = next(d for d in defects if d["status"] == "fixed")
    client.post(f"/api/owner/defects/{review['id']}/accept", headers=h)

    # The owner on shift fixes the cook's violation, then accepts it
    shift = client.get("/api/shift", headers=h).json()
    urgent = next(d for d in shift["defects"] if d["status"] == "open")
    client.post("/api/shift/start", headers=h)
    assert client.post(f"/api/defects/{urgent['id']}/fix", headers=h, json={"photos": [upload(OWNER)]}).status_code == 200
    client.post(f"/api/owner/defects/{urgent['id']}/accept", headers=h)

    # The owner's own task (thermometers) is closed with a photo
    own = next(d for d in client.get("/api/owner/state", headers=h).json()["defects"] if d["status"] == "open")
    res = client.post(f"/api/owner/defects/{own['id']}/resolve", headers=h, json={"photos": [upload(OWNER)]}).json()
    assert res["summary"]["index"] >= 90 and res["summary"]["ready"]


def test_demo_is_refused_when_facility_exists(client, facility):
    assert client.post("/api/facility/demo", headers=headers(OWNER)).status_code == 409


def test_demo_replaces_facility_that_was_never_set_up(client):
    h = headers(OWNER)
    client.post("/api/facility", headers=h)  # "Я владелец" in the bot, wizard not finished
    assert client.post("/api/facility/demo", headers=h).status_code == 200
    assert client.get("/api/owner/state", headers=h).json()["name"] == "Демо-кафе «Зерно»"


def test_delete_facility_and_start_over(client, facility):
    h = headers(OWNER)
    assert client.delete("/api/owner/facility", headers=h).status_code == 200
    me = client.get("/api/me", headers=h).json()
    assert me["owner"] is None and me["employee"] is None
    # The scenario can be passed again from scratch
    assert client.post("/api/facility/demo", headers=h).status_code == 200
