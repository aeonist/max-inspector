from conftest import OWNER, headers


def test_demo_cafe_has_the_whole_cycle_ready(client, sent):
    h = headers(OWNER, "Алия")
    assert client.post("/api/facility/demo", headers=h).status_code == 200
    state = client.get("/api/owner/state", headers=h).json()

    assert state["geo_required"] is False  # passable from the web version of MAX
    assert "тестовые данные" in state["address"]
    assert state["owner_works_shift"] is True
    statuses = sorted(d["status"] for d in state["defects"])
    assert statuses == ["fixed", "open", "open"]
    review = next(d for d in state["defects"] if d["status"] == "fixed")
    assert review["before_photo"].startswith("/uploads/") and review["after_photo"].startswith("/uploads/")

    # Accepting the waiting fix raises the index
    res = client.post(f"/api/owner/defects/{review['id']}/accept", headers=h).json()
    assert res["summary"]["index"] > state["summary"]["index"]
    # Nobody is messaged while the demo is created
    assert not [m for m in sent if "Нарушение" in (m["text"] or "")]


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
