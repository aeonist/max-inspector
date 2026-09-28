import json
from pathlib import Path

import main


# openapi.json in the repo describes the API that actually runs
def test_openapi_json_is_up_to_date():
    committed = json.loads((Path(__file__).resolve().parents[2] / "openapi.json").read_text(encoding="utf-8"))
    assert committed == main.app.openapi(), "Обновите openapi.json: команда в README, раздел «Автотесты»"
