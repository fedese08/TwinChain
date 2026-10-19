import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))  # `import api` / `import features` desde la raíz del servicio

import api  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ML_API_KEY", raising=False)
    return TestClient(api.app)


@pytest.fixture(scope="session")
def golden():
    return json.loads((Path(__file__).parent / "fixtures" / "golden_sellers.json").read_text())["sellers"]
