from conftest import OWNER, STAFF, headers, join

FRYER_ITEM = 26  # cook's shift duty


def _settings(client, **changes):
    res = client.patch("/api/owner/settings", headers=headers(OWNER), json=changes)
    assert res.status_code == 200, res.text
    return res.json()


def test_defaults_keep_the_behaviour_before_settings(client, facility):
    assert facility["qr_checkin"] is False
    assert facility["settings"] == {
        "compliant_photo_required": False,
        "task_photo_required": False,
        "reference_from_fixes": True,
    }


def test_only_the_sent_rules_change(client, facility):
    state = _settings(client, task_photo_required=True)
    assert state["settings"]["task_photo_required"] is True
    assert state["settings"]["reference_from_fixes"] is True
    state = _settings(client, compliant_photo_required=True)
    assert state["settings"]["task_photo_required"] is True
    # A stranger has no facility to configure
    assert client.patch("/api/owner/settings", headers=headers(999), json={"qr_checkin": True}).status_code == 404


def test_compliant_needs_a_photo_when_required(client, facility, upload):
    h = headers(OWNER)
    _settings(client, compliant_photo_required=True)
    assert client.put("/api/owner/audit/10", headers=h, json={"status": "compliant"}).status_code == 400
    photo = upload(OWNER)
    assert client.put("/api/owner/audit/10", headers=h, json={"status": "compliant", "photos": [photo]}).status_code == 200
    # Confirming again keeps the photo, so it is still accepted
    assert client.put("/api/owner/audit/10", headers=h, json={"status": "compliant"}).json()["answer"]["photos"] == [photo]
    # "Not applicable" never needs a photo
    assert client.put("/api/owner/audit/11", headers=h, json={"status": "na"}).status_code == 200


def test_shift_duty_needs_a_photo_when_required(client, facility, upload):
    h = headers(OWNER)
    client.post("/api/shift/start", headers=h)
    duty = client.get("/api/shift", headers=h).json()["duties"][0]["id"]
    assert client.post(f"/api/shift/tasks/{duty}", headers=h, json={"done": True}).status_code == 200

    _settings(client, task_photo_required=True)
    shift = client.get("/api/shift", headers=h).json()
    assert shift["facility"]["task_photo_required"] is True
    other = shift["duties"][1]["id"]
    assert client.post(f"/api/shift/tasks/{other}", headers=h, json={"done": True}).status_code == 400
    assert client.post(f"/api/shift/tasks/{other}", headers=h, json={"done": True, "photos": [upload(OWNER)]}).status_code == 200
    # Unchecking needs no photo
    assert client.post(f"/api/shift/tasks/{other}", headers=h, json={"done": False}).status_code == 200


def test_staff_fix_becomes_the_reference_only_when_allowed(client, facility, sent, upload):
    join(client, STAFF, "Мария Петрова")
    h_owner, h_staff = headers(OWNER), headers(STAFF)
    _settings(client, reference_from_fixes=False)

    def cycle():
        defect = client.put(
            f"/api/owner/audit/{FRYER_ITEM}", headers=h_owner, json={"status": "violation", "photos": [upload(OWNER)]}
        ).json()["defect"]
        after = upload(STAFF)
        client.post(f"/api/defects/{defect['id']}/fix", headers=h_staff, json={"photos": [after]})
        client.post(f"/api/owner/defects/{defect['id']}/accept", headers=h_owner)
        return after

    after = cycle()
    refs = client.get("/api/owner/state", headers=h_owner).json()["reference_photos"]
    assert refs.get(str(FRYER_ITEM)) != after

    _settings(client, reference_from_fixes=True)
    after = cycle()
    assert client.get("/api/owner/state", headers=h_owner).json()["reference_photos"][str(FRYER_ITEM)] == after


def test_owner_photo_is_the_reference_whatever_the_rule(client, facility, upload):
    h = headers(OWNER)
    _settings(client, reference_from_fixes=False)
    # Thermometers: the owner's own task, closed with the owner's photo
    defect = client.put("/api/owner/audit/14", headers=h, json={"status": "violation", "photos": [upload(OWNER)]}).json()["defect"]
    photo = upload(OWNER)
    client.post(f"/api/owner/defects/{defect['id']}/resolve", headers=h, json={"photos": [photo]})
    assert client.get("/api/owner/state", headers=h).json()["reference_photos"]["14"] == photo


def test_qr_checkin_switches_from_settings(client, facility):
    state = _settings(client, qr_checkin=True)
    assert state["qr_checkin"] is True
    assert client.get(state["files"]["checkin"]["url"]).status_code == 200  # printable QR is ready
    # With QR on, a shift starts only by scanning it
    assert client.post("/api/shift/start", headers=headers(OWNER)).status_code == 403
    state = _settings(client, qr_checkin=False)
    assert state["qr_checkin"] is False
    assert client.post("/api/shift/start", headers=headers(OWNER)).status_code == 200
