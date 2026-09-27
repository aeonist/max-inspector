from conftest import OWNER, STAFF, headers, join

FRYER_ITEM = 26  # "Контролируется ли ежедневно фритюрный жир…", cook's duty with a reference photo


def test_full_cycle_on_one_account(client, facility, sent, upload):
    """Owner on shift: nobody else in MAX, so the violation is the owner's -> fix -> accept -> index grows."""
    h = headers(OWNER)
    res = client.put(
        f"/api/owner/audit/{FRYER_ITEM}", headers=h, json={"status": "violation", "photos": [upload(OWNER), upload(OWNER)]}
    )
    body = res.json()
    defect = body["defect"]
    assert defect["assigned_position"] == "Повар" and defect["to_owner"] is True
    assert len(defect["before_photos"]) == 2
    assert body["delivered"] == ["Алия"]
    card = sent.to(OWNER)[-1]
    # Photos 1–2 — violation, photo 3 — reference, then the keyboard
    assert len(card["attachments"]) == 4
    assert "Фото 1–2 — как сейчас, фото 3 — как должно быть" in card["text"]
    assert "₽" not in card["text"]  # fines are not shown on the card

    # The owner sees it as urgent in their own shift
    client.post("/api/shift/start", headers=h)
    shift = client.get("/api/shift", headers=h).json()
    assert [d["id"] for d in shift["defects"]] == [defect["id"]]

    res = client.post(f"/api/defects/{defect['id']}/fix", headers=h, json={"photos": [upload(OWNER)]})
    assert res.json()["defect"]["status"] == "fixed"
    review = sent.to(OWNER)[-1]
    assert "Фото 1–2 — было, фото 3 — стало" in review["text"]

    index_before = client.get("/api/owner/state", headers=h).json()["summary"]["index"]
    res = client.post(f"/api/owner/defects/{defect['id']}/accept", headers=h)
    assert res.json()["defect"]["status"] == "accepted"
    assert res.json()["summary"]["index"] > index_before
    assert res.json()["summary"]["unresolved"] == 0


def test_staff_fix_is_returned_with_reason(client, facility, sent, upload):
    join(client, STAFF, "Мария Петрова")
    h_owner, h_staff = headers(OWNER), headers(STAFF)
    defect = client.put(
        f"/api/owner/audit/{FRYER_ITEM}", headers=h_owner, json={"status": "violation", "photos": [upload(OWNER)]}
    ).json()["defect"]
    # The linked cook gets the card; the owner sees it in their shift anyway
    assert {m["user_id"] for m in sent if "Нарушение" in (m["text"] or "")} == {STAFF}
    assert [d["id"] for d in client.get("/api/shift", headers=h_owner).json()["defects"]] == [defect["id"]]

    # The employee cannot close the violation; only send a fix for review
    fix = client.post(f"/api/defects/{defect['id']}/fix", headers=h_staff, json={"photos": [upload(STAFF)]})
    assert fix.status_code == 200
    assert client.post(f"/api/owner/defects/{defect['id']}/accept", headers=h_staff).status_code == 404

    res = client.post(f"/api/owner/defects/{defect['id']}/return", headers=h_owner, json={"reason": "Не видно на фото"})
    assert res.json()["defect"]["status"] == "returned"
    assert "Не видно на фото" in sent.to(STAFF)[-1]["text"]

    shift = client.get("/api/shift", headers=h_staff).json()
    assert shift["defects"][0]["return_reason"] == "Не видно на фото"


def test_violation_goes_to_owner_when_position_is_empty(client, facility, upload):
    # Waiters have no linked account yet: the task goes to the owner personally
    defect = client.put(
        "/api/owner/audit/33", headers=headers(OWNER), json={"status": "violation", "photos": [upload(OWNER)]}
    ).json()["defect"]
    assert defect["assigned_position"] == "Официант"
    assert defect["to_owner"] is True


def test_other_staff_cannot_fix_foreign_task(client, facility, upload):
    join(client, STAFF, "Айдар Галиев")  # a waiter
    defect = client.put(
        f"/api/owner/audit/{FRYER_ITEM}", headers=headers(OWNER), json={"status": "violation", "photos": [upload(OWNER)]}
    ).json()["defect"]
    res = client.post(f"/api/defects/{defect['id']}/fix", headers=headers(STAFF), json={"photos": [upload(STAFF)]})
    assert res.status_code == 404


def test_shift_tasks(client, facility):
    h = headers(OWNER)
    assert client.post("/api/shift/tasks/26", headers=h, json={"done": True}).status_code == 409  # no shift yet
    client.post("/api/shift/start", headers=h)
    shift = client.get("/api/shift", headers=h).json()
    duty = shift["duties"][0]
    res = client.post(f"/api/shift/tasks/{duty['id']}", headers=h, json={"done": True})
    assert res.json()["stats"]["done"] == 1
    # The owner may take any duty, a waiter's too
    waiter_item = next(k for k, v in facility["assignments"].items() if v == "Официант")
    assert client.post(f"/api/shift/tasks/{waiter_item}", headers=h, json={"done": True}).status_code == 200
    # A waiter cannot mark a cook's duty
    join(client, STAFF, "Айдар Галиев")
    client.post("/api/shift/start", headers=headers(STAFF))
    cook_item = next(k for k, v in facility["assignments"].items() if v == "Повар")
    assert client.post(f"/api/shift/tasks/{cook_item}", headers=headers(STAFF), json={"done": True}).status_code == 404

    res = client.post("/api/shift/end", headers=h, json={"force": False})
    assert res.json()["closed"] is False and res.json()["left"] > 0
    assert client.post("/api/shift/end", headers=h, json={"force": True}).json()["closed"] is True
