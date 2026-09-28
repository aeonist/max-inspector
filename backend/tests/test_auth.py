import os
import subprocess
import sys
import time
from pathlib import Path

from conftest import headers, make_init_data

from services.auth import make_link_token, validate_init_data


def test_valid_init_data_is_accepted():
    user = validate_init_data(make_init_data(42, "Алия", "setup"), "test-token")
    assert user.user_id == 42
    assert user.first_name == "Алия"
    assert user.start_param == "setup"


def test_tampered_init_data_is_rejected():
    raw = make_init_data(42).replace("%22id%22%3A%2042", "%22id%22%3A%2043")
    assert validate_init_data(raw, "test-token") is None
    assert validate_init_data(make_init_data(42), "other-token") is None


def test_stale_init_data_is_rejected():
    raw = make_init_data(42, auth_date=int(time.time()) - 5 * 24 * 3600)
    assert validate_init_data(raw, "test-token") is None


def test_api_requires_auth(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"X-Max-Init-Data": "user=1&hash=bad"}).status_code == 401


def test_signed_link_token_works(client):
    res = client.get("/api/me", headers={"X-Auth-Token": make_link_token(7), "X-Start-Param": "home"})
    assert res.status_code == 200
    assert res.json()["user"]["id"] == 7
    assert res.json()["start_param"] == "home"


def test_owner_endpoints_are_scoped_to_the_owner(client, facility):
    # A stranger has no facility and cannot read someone else's
    assert client.get("/api/owner/state", headers=headers(999)).status_code == 404


# A checker may run `docker compose up` without a bot token: the app must start and stay safe
def test_app_starts_without_bot_token(tmp_path):
    env = {**os.environ, "BOT_TOKEN": "", "BOT_POLLING": "1", "DATA_DIR": str(tmp_path), "UPLOADS_DIR": str(tmp_path / "u")}
    code = (
        "from fastapi.testclient import TestClient\n"
        "import main\n"
        "from services.auth import make_link_token\n"
        "with TestClient(main.app) as c:\n"
        "    assert c.get('/api/health').status_code == 200\n"
        "    assert c.get('/').status_code == 200\n"
        "    # without a token the signing key is public, so signed links are refused\n"
        "    assert c.get('/api/me', headers={'X-Auth-Token': make_link_token(1)}).status_code == 401\n"
    )
    backend = Path(__file__).resolve().parent.parent
    result = subprocess.run([sys.executable, "-c", code], cwd=backend, env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr[-2000:]
