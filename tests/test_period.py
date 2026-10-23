import datetime as dt

import pytest
from werkzeug.datastructures import MultiDict

import app
from app import InputError, Period, form_state, parse_codes, presets, resolve_period

TODAY = dt.date.today()


def args(**kwargs):
    return MultiDict(kwargs)


# ---------- resolve_period ----------

def test_month():
    p = resolve_period(args(period="month", year="2024", month="2"))
    assert (p.start, p.end) == (dt.date(2024, 2, 1), dt.date(2024, 2, 29))
    assert p.label == "Лютий 2024"


def test_month_defaults_to_current():
    p = resolve_period(args())
    assert p.kind == "month"
    assert p.start == TODAY.replace(day=1)


@pytest.mark.parametrize("quarter, start, end", [
    ("1", dt.date(2025, 1, 1), dt.date(2025, 3, 31)),
    ("2", dt.date(2025, 4, 1), dt.date(2025, 6, 30)),
    ("3", dt.date(2025, 7, 1), dt.date(2025, 9, 30)),
    ("4", dt.date(2025, 10, 1), dt.date(2025, 12, 31)),
])
def test_quarter(quarter, start, end):
    p = resolve_period(args(period="quarter", year="2025", quarter=quarter))
    assert (p.start, p.end) == (start, end)
    assert p.label.endswith("квартал 2025")


def test_quarter_defaults_to_current():
    p = resolve_period(args(period="quarter"))
    assert p.start <= TODAY <= p.end


def test_year():
    p = resolve_period(args(period="year", year="2023"))
    assert (p.start, p.end, p.label) == (dt.date(2023, 1, 1), dt.date(2023, 12, 31), "2023 рік")


def test_custom():
    p = resolve_period(args(period="custom", start="2025-01-10", end="2025-02-05"))
    assert (p.start, p.end) == (dt.date(2025, 1, 10), dt.date(2025, 2, 5))
    assert p.label == "10.01.2025 – 05.02.2025"


def test_legacy_start_end_date_params():
    p = resolve_period(args(start_date="2025-01-01", end_date="2025-01-05"))
    assert p.kind == "custom"
    assert p.end == dt.date(2025, 1, 5)


@pytest.mark.parametrize("params, message", [
    ({"period": "custom", "start": "2025-02-01", "end": "2025-01-01"}, "пізніша"),
    ({"period": "custom", "start": "1990-01-01", "end": "1990-02-01"}, "Гривня введена 02.09.1996"),
    ({"period": "month", "year": "1996", "month": "8"}, "Гривня введена"),
    ({"period": "custom", "end": "2025-01-01"}, "Заповніть поле «Дата початку»"),
    ({"period": "custom", "start": "2025-13-01", "end": "2025-01-01"}, "Некоректний формат поля «Дата початку»"),
    ({"period": "month", "month": "13"}, "1–12"),
    ({"period": "month", "year": "abc"}, "Некоректне значення"),
    ({"period": "year", "year": "1995"}, "1996"),
    ({"period": "week"}, "Невідомий тип"),
])
def test_invalid_period(params, message):
    with pytest.raises(InputError, match=message):
        resolve_period(MultiDict(params))


def test_year_1996_starts_on_hryvnia_day():
    p = resolve_period(args(period="year", year="1996"))
    assert (p.start, p.end, p.label) == (dt.date(1996, 9, 2), dt.date(1996, 12, 31), "1996 рік")


def test_custom_period_is_clamped_to_hryvnia_day():
    p = resolve_period(args(period="custom", start="1996-01-01", end="1996-09-30"))
    assert p.start == dt.date(1996, 9, 2)
    assert p.label == "02.09.1996 – 30.09.1996"


# ---------- parse_codes ----------

def test_parse_codes_normalizes_and_dedupes():
    assert parse_codes(" usd, EUR;pln  usd,,") == ["USD", "EUR", "PLN"]


@pytest.mark.parametrize("raw, message", [
    ("", "хоча б одну"),
    (None, "хоча б одну"),
    ("US1", "не схоже"),
    ("DOLLAR", "не схоже"),
    (",".join(f"A{chr(65 + i)}A" for i in range(app.MAX_CURRENCIES + 1)), "не більше"),
])
def test_parse_codes_errors(raw, message):
    with pytest.raises(InputError, match=message):
        parse_codes(raw)


# ---------- presets ----------

def test_presets_mid_year():
    items = {p["title"]: p for p in presets(dt.date(2025, 5, 15))}
    assert items["Цей місяць"] == {"title": "Цей місяць", "period": "month", "year": 2025, "month": 5}
    assert items["Минулий місяць"]["month"] == 4
    assert items["Цей квартал"]["quarter"] == 2
    assert (items["Минулий квартал"]["year"], items["Минулий квартал"]["quarter"]) == (2025, 1)
    assert items["Минулий рік"]["year"] == 2024


def test_presets_january_wraps_to_previous_year():
    items = {p["title"]: p for p in presets(dt.date(2025, 1, 10))}
    assert (items["Минулий місяць"]["year"], items["Минулий місяць"]["month"]) == (2024, 12)
    assert (items["Минулий квартал"]["year"], items["Минулий квартал"]["quarter"]) == (2024, 4)


def test_presets_default_to_today():
    assert presets()[0]["year"] == TODAY.year


# ---------- form_state ----------

def test_form_state_defaults():
    state = form_state(args())
    assert state["period"] == "month"
    assert state["currencies"] == "USD,EUR"
    assert state["start"] == TODAY.replace(day=1).isoformat()
    assert state["end"] == TODAY.isoformat()


def test_form_state_takes_dates_from_report_period():
    period = Period("quarter", dt.date(2024, 4, 1), dt.date(2024, 6, 30), "II квартал 2024")
    state = form_state(args(period="quarter", currencies="PLN"), period)
    assert (state["start"], state["end"]) == ("2024-04-01", "2024-06-30")
    assert (state["year"], state["month"], state["quarter"]) == (2024, 6, 2)
    assert state["currencies"] == "PLN"


def test_form_state_legacy_params():
    state = form_state(args(start_date="2025-01-01", end_date="2025-01-05"))
    assert (state["period"], state["start"], state["end"]) == ("custom", "2025-01-01", "2025-01-05")
