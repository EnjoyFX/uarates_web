import datetime as dt
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402

# Базові курси фейкового НБУ; JPY котирується за 10 одиниць, як і справжній
BASE_RATES = {"USD": 41.0, "EUR": 43.0, "PLN": 10.5, "JPY": 2.7, "DZD": 0.33459}
NAMES = {"USD": "Долар США", "EUR": "Євро", "PLN": "Злотий", "JPY": "Єна", "DZD": "Алжирський динар"}


class FakeResponse:
    def __init__(self, payload, status=200, bad_json=False):
        self.payload = payload
        self.status_code = status
        self.bad_json = bad_json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        if self.bad_json:
            raise ValueError("not json")
        return self.payload


def rates_payload(code, start, end):
    """Курс на кожен календарний день: базовий + 0.01 за кожен день від початку."""
    if code not in BASE_RATES:
        return []
    days = (end - start).days + 1
    return [
        {
            "exchangedate": (start + dt.timedelta(days=i)).strftime("%d.%m.%Y"),
            "cc": code,
            "txt": NAMES[code],
            "rate": round(BASE_RATES[code] + i * 0.01, 5),
            "units": 10 if code == "JPY" else 1,
        }
        for i in range(days)
    ]


class FakeNbu:
    """Підміна requests.get: рахує виклики й дає зламати окремі ендпоінти."""

    def __init__(self):
        self.calls = []
        self.fail_rates = False
        self.fail_directory = False

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        assert timeout, "кожен запит до НБУ має мати таймаут"
        if url == app_module.NBU_DIRECTORY_URL:
            if self.fail_directory:
                raise requests.ConnectionError("down")
            return FakeResponse([
                {"cc": "USD", "txt": "Долар США"},
                {"cc": "DZD", "txt": "Алжирський динар"},
                {"cc": "", "txt": "без коду"},
            ])
        if self.fail_rates:
            raise requests.Timeout("slow")
        start = dt.datetime.strptime(params["start"], "%Y%m%d").date()
        end = dt.datetime.strptime(params["end"], "%Y%m%d").date()
        return FakeResponse(rates_payload(params["valcode"].upper(), start, end))

    def rate_calls(self):
        return [c for c in self.calls if c[0] == app_module.NBU_RATES_URL]


@pytest.fixture(autouse=True)
def reset_caches():
    app_module._rates_cache.clear()
    app_module._directory_cache.update(at=0.0, items=None)
    yield


@pytest.fixture
def nbu(monkeypatch):
    fake = FakeNbu()
    monkeypatch.setattr(app_module.requests, "get", fake.get)
    return fake


@pytest.fixture
def client(nbu):
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()
