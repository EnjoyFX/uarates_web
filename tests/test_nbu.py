import datetime as dt

import pytest

import app
from app import (NbuError, Period, Series, build_report, currency_directory, fetch_rates, fmt_rate, fmt_signed,
                 rate_for_units)

from conftest import FakeResponse

JAN = Period("month", dt.date(2025, 1, 1), dt.date(2025, 1, 31), "Січень 2025")


# ---------- fetch_rates ----------

def test_fetch_rates_sends_expected_params(nbu):
    data = fetch_rates("USD", dt.date(2025, 1, 1), dt.date(2025, 1, 3))
    assert len(data) == 3
    url, params = nbu.calls[0]
    assert url == app.NBU_RATES_URL
    assert params == {"start": "20250101", "end": "20250103", "valcode": "usd",
                      "sort": "exchangedate", "order": "asc", "json": ""}


def test_fetch_rates_uses_cache(nbu):
    fetch_rates("USD", JAN.start, JAN.end)
    fetch_rates("USD", JAN.start, JAN.end)
    assert len(nbu.rate_calls()) == 1


def test_fetch_rates_cache_expires(nbu, monkeypatch):
    fetch_rates("USD", JAN.start, JAN.end)
    monkeypatch.setattr(app, "RATES_CACHE_TTL", -1)
    fetch_rates("USD", JAN.start, JAN.end)
    assert len(nbu.rate_calls()) == 2


def test_fetch_rates_network_error(nbu):
    nbu.fail_rates = True
    with pytest.raises(NbuError, match="Не вдалося"):
        fetch_rates("USD", JAN.start, JAN.end)


@pytest.mark.parametrize("response", [FakeResponse([], status=500), FakeResponse(None, bad_json=True)])
def test_fetch_rates_bad_response(monkeypatch, response):
    monkeypatch.setattr(app.requests, "get", lambda *a, **kw: response)
    with pytest.raises(NbuError):
        fetch_rates("USD", JAN.start, JAN.end)


# ---------- currency_directory ----------

def test_directory_merges_nbu_and_puts_popular_first(nbu):
    items = currency_directory()
    codes = [c["code"] for c in items]
    assert codes[:len(app.POPULAR)] == app.POPULAR
    assert "DZD" in codes  # прийшла з НБУ, у запасному списку її немає
    assert "" not in codes
    rest = [c["name"] for c in items[len(app.POPULAR):]]
    assert rest == sorted(rest)


def test_directory_is_cached(nbu):
    currency_directory()
    currency_directory()
    assert len(nbu.calls) == 1


def test_directory_falls_back_and_retries_next_time(nbu):
    nbu.fail_directory = True
    items = currency_directory()
    assert {c["code"] for c in items} == set(app.FALLBACK_DIRECTORY)
    nbu.fail_directory = False
    assert "DZD" in {c["code"] for c in currency_directory()}  # невдалу відповідь не кешуємо


# ---------- build_report ----------

def test_build_report(nbu):
    report = build_report(["USD", "JPY", "XYZ"], JAN)
    assert report.missing == ["XYZ"]
    assert [s.code for s in report.series] == ["USD", "JPY"]
    assert len(report.dates) == 31 == len(report.rows)
    assert report.rows[0] == (dt.date(2025, 1, 1), [41.0, 2.7])

    usd, jpy = report.series
    assert usd.name == "Долар США" and usd.units == 1
    assert jpy.units == 10
    assert usd.first == 41.0 and usd.last == pytest.approx(41.3)
    assert usd.change == pytest.approx(0.3)
    assert usd.change_pct == pytest.approx(0.3 / 41 * 100)
    assert (usd.low, usd.low_date) == (41.0, dt.date(2025, 1, 1))
    assert (usd.high, usd.high_date) == (pytest.approx(41.3), dt.date(2025, 1, 31))
    assert usd.avg == pytest.approx(41.15)


def test_build_report_skips_incomplete_entries_and_aligns_dates(monkeypatch):
    payloads = {
        "usd": [
            {"exchangedate": "02.01.2025", "rate": 42.0, "txt": "Долар США"},
            {"exchangedate": "01.01.2025", "rate": 41.0},
            {"exchangedate": "03.01.2025", "rate": None},
            {"rate": 40.0},
        ],
        "eur": [{"exchangedate": "02.01.2025", "rate": 43.0}],
    }
    monkeypatch.setattr(app.requests, "get",
                        lambda url, params, timeout: FakeResponse(payloads[params["valcode"]]))
    report = build_report(["USD", "EUR"], JAN)
    assert report.rows == [(dt.date(2025, 1, 1), [41.0, None]), (dt.date(2025, 1, 2), [42.0, 43.0])]
    eur = report.series[1]
    assert (eur.name, eur.units) == ("EUR", 1)  # НБУ не дав назву — показуємо код


@pytest.mark.parametrize("entry, units, expected", [
    ({"rate": 41.5, "units": 1}, 1, 41.5),
    ({"rate": 2368.62, "units": 100, "rate_per_unit": 23.6862}, 1, 23.6862),
    ({"rate": 216.26, "units": 1000}, 10, 2.1626),  # без rate_per_unit — рахуємо самі
    ({"rate": 41.5}, 1, 41.5),  # units відсутнє — вважаємо 1
])
def test_rate_for_units(entry, units, expected):
    assert rate_for_units(entry, units) == expected


def test_build_report_normalizes_units_change(monkeypatch):
    # Реальний перехід НБУ: 28.12.2019 USD перейшов з котирування за 100 на за 1, JPY — з 1000 на 10
    payloads = {
        "usd": [
            {"exchangedate": "27.12.2019", "rate": 2368.62, "units": 100, "rate_per_unit": 23.6862},
            {"exchangedate": "28.12.2019", "rate": 23.6862, "units": 1, "rate_per_unit": 23.6862},
        ],
        "jpy": [
            {"exchangedate": "27.12.2019", "rate": 216.26, "units": 1000, "rate_per_unit": 0.21626},
            {"exchangedate": "28.12.2019", "rate": 2.1626, "units": 10, "rate_per_unit": 0.21626},
        ],
    }
    monkeypatch.setattr(app.requests, "get",
                        lambda url, params, timeout: FakeResponse(payloads[params["valcode"]]))
    period = Period("custom", dt.date(2019, 12, 27), dt.date(2019, 12, 28), "")
    usd, jpy = build_report(["USD", "JPY"], period).series
    assert (usd.units, usd.values, usd.change) == (1, [23.6862, 23.6862], 0)
    assert (jpy.units, jpy.values) == (10, [2.1626, 2.1626])


def test_series_with_zero_first_rate():
    s = Series(code="XAU", name="Золото", units=1, dates=[JAN.start, JAN.end], values=[0.0, 1.0])
    assert s.change_pct == 0.0


# ---------- форматування ----------

@pytest.mark.parametrize("value, expected", [
    (None, "—"),
    (41.5, "41,5000"),
    (0.33459, "0,33459"),
    (1234.5, "1 234,5000"),
])
def test_fmt_rate(value, expected):
    assert fmt_rate(value) == expected


@pytest.mark.parametrize("args, expected", [
    ((0.55,), "+0,5500"),
    ((-1.25, 2, " %"), "−1,25 %"),
    ((0,), "±0,0000"),
])
def test_fmt_signed(args, expected):
    assert fmt_signed(*args) == expected
