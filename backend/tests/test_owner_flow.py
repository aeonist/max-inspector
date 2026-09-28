from conftest import OWNER, headers

from services.checklist import load_checklist


def test_setup_creates_staff_owner_profile_and_assignments(client, facility):
    assert facility["setup_done"] is True
    assert facility["owner_works_shift"] is True
    assert next(s for s in facility["staff"] if s["is_owner"])["position"] == "Руководитель"
    names = [s["full_name"] for s in facility["staff"]]
    assert names[0] == "Алия"  # the owner goes first
    assert {"Айдар Галиев", "Мария Петрова"} <= set(names)

    shift_items = [i for i in load_checklist() if i["task_type"] == "shift"]
    assert len(facility["assignments"]) == len(shift_items)
    # Cleaner duties go to the first position when there is no cleaner
    assert set(facility["assignments"].values()) <= {"Повар", "Официант"}


def test_conditional_items_become_not_applicable(client, facility):
    conditional = [i for i in load_checklist() if i.get("applies_to")]
    # Fryer is present, all other conditions are not
    expected_na = [i for i in conditional if i["applies_to"] != "Используется фритюр"]
    assert facility["summary"]["na"] == len(expected_na)

    audit = client.get("/api/owner/audit", headers=headers(OWNER)).json()
    fryer = next(i for i in conditional if i["applies_to"] == "Используется фритюр")
    assert str(fryer["id"]) not in audit["answers"]


def test_index_and_progress_are_different(client, facility, upload):
    h = headers(OWNER)
    # One violation on an owner item (documents): progress grows, index does not
    res = client.put("/api/owner/audit/1", headers=h, json={"status": "violation", "photos": [upload(OWNER)]})
    assert res.status_code == 200, res.text
    summary = res.json()["summary"]
    assert summary["answered"] == facility["summary"]["answered"] + 1
    assert summary["index"] == 0
    assert summary["ready"] is False
    assert res.json()["defect"]["to_owner"] is True


def test_violation_requires_photo(client, facility):
    res = client.put("/api/owner/audit/10", headers=headers(OWNER), json={"status": "violation"})
    assert res.status_code == 400


def test_foreign_photo_url_is_rejected(client, facility):
    res = client.put(
        "/api/owner/audit/10",
        headers=headers(OWNER),
        json={"status": "violation", "photos": ["/uploads/../../inspector.db"]},
    )
    assert res.status_code == 400


def test_answer_change_cancels_defect(client, facility, upload):
    h = headers(OWNER)
    client.put("/api/owner/audit/10", headers=h, json={"status": "violation", "photos": [upload(OWNER)]})
    res = client.put("/api/owner/audit/10", headers=h, json={"status": "compliant", "photos": [upload(OWNER)]})
    assert res.json()["defect"] is None
    assert res.json()["summary"]["unresolved"] == 0


def test_upload_rejects_non_images(client, facility):
    res = client.post(
        "/api/upload",
        files={"file": ("x.jpg", b"not an image", "image/jpeg")},
        headers=headers(OWNER),
    )
    assert res.status_code == 415


def test_staff_management(client, facility):
    h = headers(OWNER)
    res = client.post("/api/owner/staff", headers=h, json={"full_name": "Ильдар", "position": "Официант"})
    assert res.status_code == 200
    emp_id = res.json()["id"]
    assert client.post("/api/owner/staff", headers=h, json={"full_name": "X", "position": "Пилот"}).status_code == 400
    assert client.delete(f"/api/owner/staff/{emp_id}", headers=h).status_code == 200
    names = [s["full_name"] for s in client.get("/api/owner/state", headers=h).json()["staff"]]
    assert "Ильдар" not in names


def test_compliant_photo_is_optional_and_keeps_several(client, facility, upload):
    h = headers(OWNER)
    # One tap: "compliant" without a photo is saved and sets no reference
    res = client.put("/api/owner/audit/10", headers=h, json={"status": "compliant"})
    assert res.status_code == 200
    assert res.json()["answer"]["photos"] == []
    assert "10" not in client.get("/api/owner/state", headers=h).json()["reference_photos"]
    # A violation still needs a photo
    assert client.put("/api/owner/audit/12", headers=h, json={"status": "violation"}).status_code == 400

    photos = [upload(OWNER), upload(OWNER), upload(OWNER)]
    res = client.put("/api/owner/audit/26", headers=h, json={"status": "compliant", "photos": photos})
    assert res.json()["answer"]["photos"] == photos
    # The first photo becomes the facility's "as it should be" reference
    assert client.get("/api/owner/state", headers=h).json()["reference_photos"]["26"] == photos[0]
    assert client.get("/api/owner/audit", headers=h).json()["answers"]["26"]["photos"] == photos
    # Confirming "compliant" again without photos keeps the ones attached
    res = client.put("/api/owner/audit/26", headers=h, json={"status": "compliant"})
    assert res.json()["answer"]["photos"] == photos

    # "Not applicable" never keeps photos
    res = client.put("/api/owner/audit/11", headers=h, json={"status": "na", "photos": [upload(OWNER)]})
    assert res.json()["answer"]["photos"] == []


def test_too_many_photos_are_rejected(client, facility, upload):
    photo = upload(OWNER)
    res = client.put("/api/owner/audit/26", headers=headers(OWNER), json={"status": "compliant", "photos": [photo] * 11})
    assert res.status_code == 422


def test_owner_switches_employee_role(client, facility):
    h = headers(OWNER)
    owner_emp_id = next(s["id"] for s in facility["staff"] if s["is_owner"])

    state = client.put("/api/owner/shift-role", headers=h, json={"works": False}).json()
    assert state["owner_works_shift"] is False
    assert client.get("/api/me", headers=h).json()["employee"] is None
    assert client.get("/api/shift", headers=h).status_code == 404

    # Back on: the same profile, name from the wizard kept, every duty of the shift visible
    state = client.put("/api/owner/shift-role", headers=h, json={"works": True}).json()
    me = next(s for s in state["staff"] if s["is_owner"])
    assert me["id"] == owner_emp_id and me["full_name"] == "Алия"
    positions = {d["position"] for d in client.get("/api/shift", headers=h).json()["duties"]}
    assert positions == {"Повар", "Официант"}

    # The name can be set from the role switch
    state = client.put("/api/owner/shift-role", headers=h, json={"works": True, "name": "Алия Х."}).json()
    assert next(s for s in state["staff"] if s["is_owner"])["full_name"] == "Алия Х."


def test_owner_audit_task_needs_result_photo(client, facility, upload):
    h = headers(OWNER)
    defect = client.put("/api/owner/audit/1", headers=h, json={"status": "violation", "photos": [upload(OWNER)]}).json()["defect"]
    assert client.post(f"/api/owner/defects/{defect['id']}/resolve", headers=h, json={}).status_code == 400
    res = client.post(f"/api/owner/defects/{defect['id']}/resolve", headers=h, json={"photos": [upload(OWNER)]})
    assert res.json()["defect"]["status"] == "accepted"
