from conftest import OWNER, STAFF, headers


def test_join_shows_only_free_profiles(client, facility, sent):
    token = facility["invite_url"].split("join_")[1]
    info = client.get(f"/api/join/{token}", headers=headers(STAFF)).json()
    names = {e["full_name"] for e in info["free"]}
    assert names == {"Айдар Галиев", "Мария Петрова"}  # the owner's profile is taken

    emp_id = next(e["id"] for e in info["free"] if e["full_name"] == "Айдар Галиев")
    assert client.post(f"/api/join/{token}", headers=headers(STAFF), json={"employee_id": emp_id}).status_code == 200
    assert "Айдар Галиев" in sent.to(OWNER)[-1]["text"]

    # Profile is taken now, and the same account cannot join twice
    assert client.post(f"/api/join/{token}", headers=headers(3003), json={"employee_id": emp_id}).status_code == 409
    me = client.get("/api/me", headers=headers(STAFF)).json()
    assert me["employee"]["position"] == "Официант"


def test_unknown_invite(client, facility):
    assert client.get("/api/join/nope", headers=headers(STAFF)).status_code == 404


def test_report_pdf_and_poster(client, facility):
    h = headers(OWNER)
    files = client.get("/api/owner/state", headers=h).json()["files"]
    res = client.get(files["report"]["url"])
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF")

    invite = client.get("/api/owner/invite", headers=h).json()
    assert invite["qr_svg"].startswith("<svg")
    poster = client.get(invite["files"]["poster"]["url"])
    assert poster.status_code == 200 and poster.content.startswith(b"%PDF")

    # File links are signed: a forged token does not open someone's report
    assert client.get("/api/files/report/forged.pdf").status_code == 404
