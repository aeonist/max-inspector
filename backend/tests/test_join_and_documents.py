from conftest import OWNER, STAFF, headers, invite_token, join


def test_personal_invite_is_single_use(client, facility, sent):
    token = invite_token(client, "Айдар Галиев")
    info = client.get(f"/api/invite/{token}", headers=headers(STAFF)).json()
    assert (info["full_name"], info["position"]) == ("Айдар Галиев", "Официант")

    assert client.post(f"/api/invite/{token}", headers=headers(STAFF)).status_code == 200
    assert "Айдар Галиев" in sent.to(OWNER)[-1]["text"]
    assert client.get("/api/me", headers=headers(STAFF)).json()["employee"]["position"] == "Официант"

    # The link burns after use: nobody else can become Aidar with it
    assert client.post(f"/api/invite/{token}", headers=headers(3003)).status_code == 404
    # A joined employee gets no new invite
    staff = client.get("/api/owner/state", headers=headers(OWNER)).json()["staff"]
    aidar = next(s for s in staff if s["full_name"] == "Айдар Галиев")
    assert client.post(f"/api/owner/staff/{aidar['id']}/invite", headers=headers(OWNER)).status_code == 400


def test_invite_cannot_be_taken_by_owner_or_other_member(client, facility):
    token = invite_token(client, "Мария Петрова")
    assert client.post(f"/api/invite/{token}", headers=headers(OWNER)).status_code == 409
    join(client, STAFF, "Айдар Галиев")
    assert client.post(f"/api/invite/{token}", headers=headers(STAFF)).status_code == 409


def test_send_all_invites_to_owner_chat(client, facility, sent):
    res = client.post("/api/owner/invites/send", headers=headers(OWNER)).json()
    assert res == {"sent": 2, "total": 2}
    texts = [m["text"] for m in sent.to(OWNER)]
    assert "Перешлите каждое сообщение" in texts[-3]
    assert any("Мария Петрова" in t and "?start=inv_" in t for t in texts[-2:])


def test_unknown_invite(client, facility):
    assert client.get("/api/invite/nope", headers=headers(STAFF)).status_code == 404


def test_report_pdf(client, facility):
    h = headers(OWNER)
    files = client.get("/api/owner/state", headers=h).json()["files"]
    res = client.get(files["report"]["url"])
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF")


    # File links are signed: a forged token does not open someone's report
    assert client.get("/api/files/report/forged.pdf").status_code == 404
