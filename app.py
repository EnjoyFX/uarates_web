import calendar
import csv
import datetime as dt
import io
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import requests
from flask import Flask, Response, redirect, render_template, request, url_for

app = Flask(__name__)

NBU_RATES_URL = "https://bank.gov.ua/NBU_Exchange/exchange_site"
NBU_DIRECTORY_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json"
HTTP_TIMEOUT = 15
RATES_CACHE_TTL = 10 * 60
DIRECTORY_CACHE_TTL = 12 * 60 * 60
MAX_CURRENCIES = 10
HRYVNIA_DAY = dt.date(1996, 9, 2)  # грошова реформа: раніше НБУ встановлював курси в карбованцях
FIRST_YEAR = HRYVNIA_DAY.year

MONTHS = [
    "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
    "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень",
]
QUARTERS = ["I", "II", "III", "IV"]
POPULAR = ["USD", "EUR", "PLN", "GBP", "CHF", "CZK", "CNY", "JPY"]

# Запасний довідник на випадок, якщо НБУ недоступний
FALLBACK_DIRECTORY = {
    "USD": "Долар США", "EUR": "Євро", "PLN": "Злотий", "GBP": "Фунт стерлінгів",
    "CHF": "Швейцарський франк", "CZK": "Чеська крона", "CNY": "Юань Женьміньбі",
    "JPY": "Єна", "CAD": "Канадський долар", "AUD": "Австралійський долар",
    "SEK": "Шведська крона", "NOK": "Норвезька крона", "DKK": "Данська крона",
    "HUF": "Форинт", "RON": "Румунський лей", "TRY": "Турецька ліра",
    "MDL": "Молдовський лей", "XAU": "Золото",
}


class InputError(ValueError):
    """Некоректні параметри запиту — показуємо користувачу як є."""


class NbuError(RuntimeError):
    """НБУ не відповів або відповів з помилкою."""


# ---------- Період ----------

@dataclass
class Period:
    kind: str
    start: dt.date
    end: dt.date
    label: str


def _parse_int(value, default, lo, hi, name):
    if value in (None, ""):
        return default
    try:
        number = int(value)
    except ValueError:
        raise InputError(f"Некоректне значення поля «{name}»")
    if not lo <= number <= hi:
        raise InputError(f"Поле «{name}» має бути в межах {lo}–{hi}")
    return number


def _parse_date(value, name):
    if not value:
        raise InputError(f"Заповніть поле «{name}»")
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise InputError(f"Некоректний формат поля «{name}»")


def fmt_date(d):
    return d.strftime("%d.%m.%Y")


def resolve_period(args):
    period = _requested_period(args)
    if period.end < HRYVNIA_DAY:
        raise InputError(f"Гривня введена {fmt_date(HRYVNIA_DAY)}; за раніший період курсів гривні немає")
    # Курси в карбованцях не змішуємо з гривневими — період починається з дня реформи
    if period.start < HRYVNIA_DAY:
        period.start = HRYVNIA_DAY
        if period.kind == "custom":
            period.label = f"{fmt_date(period.start)} – {fmt_date(period.end)}"
    return period


def _requested_period(args):
    today = dt.date.today()
    # Старі посилання передавали лише start_date/end_date
    kind = args.get("period") or ("custom" if args.get("start_date") else "month")

    if kind == "custom":
        start = _parse_date(args.get("start") or args.get("start_date"), "Дата початку")
        end = _parse_date(args.get("end") or args.get("end_date"), "Дата кінця")
        if start > end:
            raise InputError("Дата початку пізніша за дату кінця")
        return Period(kind, start, end, f"{fmt_date(start)} – {fmt_date(end)}")

    year = _parse_int(args.get("year"), today.year, FIRST_YEAR, today.year + 1, "Рік")

    if kind == "month":
        month = _parse_int(args.get("month"), today.month, 1, 12, "Місяць")
        last_day = calendar.monthrange(year, month)[1]
        return Period(kind, dt.date(year, month, 1), dt.date(year, month, last_day),
                      f"{MONTHS[month - 1]} {year}")

    if kind == "quarter":
        default_q = (today.month - 1) // 3 + 1
        quarter = _parse_int(args.get("quarter"), default_q, 1, 4, "Квартал")
        last_month = quarter * 3
        last_day = calendar.monthrange(year, last_month)[1]
        return Period(kind, dt.date(year, last_month - 2, 1), dt.date(year, last_month, last_day),
                      f"{QUARTERS[quarter - 1]} квартал {year}")

    if kind == "year":
        return Period(kind, dt.date(year, 1, 1), dt.date(year, 12, 31), f"{year} рік")

    raise InputError("Невідомий тип періоду")


def parse_codes(raw):
    codes = []
    for part in re.split(r"[\s,;]+", (raw or "").upper()):
        if not part:
            continue
        if not re.fullmatch(r"[A-Z]{3}", part):
            raise InputError(f"«{part}» — не схоже на код валюти (очікується 3 літери, напр. USD)")
        if part not in codes:
            codes.append(part)
    if not codes:
        raise InputError("Оберіть хоча б одну валюту")
    if len(codes) > MAX_CURRENCIES:
        raise InputError(f"Можна обрати не більше {MAX_CURRENCIES} валют")
    return codes


def presets(today=None):
    """Швидкі періоди для кнопок над формою."""
    today = today or dt.date.today()
    prev_month = (today.replace(day=1) - dt.timedelta(days=1))
    q = (today.month - 1) // 3 + 1
    prev_q, prev_q_year = (q - 1, today.year) if q > 1 else (4, today.year - 1)
    return [
        {"title": "Цей місяць", "period": "month", "year": today.year, "month": today.month},
        {"title": "Минулий місяць", "period": "month", "year": prev_month.year, "month": prev_month.month},
        {"title": "Цей квартал", "period": "quarter", "year": today.year, "quarter": q},
        {"title": "Минулий квартал", "period": "quarter", "year": prev_q_year, "quarter": prev_q},
        {"title": "Цей рік", "period": "year", "year": today.year},
        {"title": "Минулий рік", "period": "year", "year": today.year - 1},
    ]


def form_state(args, period=None):
    """Значення полів форми: з запиту, а для незаповнених — розумні дефолти.
    Дати довільного періоду беремо з поточного звіту, щоб перемикання режиму їх не губило."""
    today = dt.date.today()
    start = period.start if period else today.replace(day=1)
    end = min(period.end, today) if period else today
    return {
        "period": args.get("period") or ("custom" if args.get("start_date") else "month"),
        "year": args.get("year", type=int) or end.year,
        "month": args.get("month", type=int) or end.month,
        "quarter": args.get("quarter", type=int) or (end.month - 1) // 3 + 1,
        "start": args.get("start") or args.get("start_date") or start.isoformat(),
        "end": args.get("end") or args.get("end_date") or end.isoformat(),
        "currencies": args.get("currencies", "USD,EUR"),
    }


# ---------- НБУ ----------

_rates_cache = {}
_directory_cache = {"at": 0.0, "items": None}
_cache_lock = threading.Lock()


def fetch_rates(code, start, end):
    key = (code, start, end)
    with _cache_lock:
        hit = _rates_cache.get(key)
    if hit and time.monotonic() - hit[0] < RATES_CACHE_TTL:
        return hit[1]

    params = {
        "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "valcode": code.lower(),
        "sort": "exchangedate",
        "order": "asc",
        "json": "",
    }
    try:
        response = requests.get(NBU_RATES_URL, params=params, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError):
        raise NbuError("Не вдалося отримати дані від НБУ. Спробуйте ще раз за хвилину.")

    with _cache_lock:
        _rates_cache[key] = (time.monotonic(), data)
    return data


def currency_directory():
    """Список валют [{code, name}]: популярні першими, решта за назвою."""
    if _directory_cache["items"] and time.monotonic() - _directory_cache["at"] < DIRECTORY_CACHE_TTL:
        return _directory_cache["items"]

    names = dict(FALLBACK_DIRECTORY)
    fetched = False
    try:
        response = requests.get(NBU_DIRECTORY_URL, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        for entry in response.json():
            if entry.get("cc") and entry.get("txt"):
                names[entry["cc"]] = entry["txt"]
        fetched = True
    except (requests.RequestException, ValueError):
        pass

    items = sorted(
        ({"code": code, "name": name} for code, name in names.items()),
        key=lambda c: (c["code"] not in POPULAR,
                       POPULAR.index(c["code"]) if c["code"] in POPULAR else 0,
                       c["name"]),
    )
    if fetched:
        _directory_cache.update(at=time.monotonic(), items=items)
    return items


# ---------- Звіт ----------

@dataclass
class Series:
    code: str
    name: str
    units: int
    dates: list
    values: list
    first: float = 0.0
    last: float = 0.0
    change: float = 0.0
    change_pct: float = 0.0
    low: float = 0.0
    low_date: dt.date = None
    high: float = 0.0
    high_date: dt.date = None
    avg: float = 0.0

    def __post_init__(self):
        self.first, self.last = self.values[0], self.values[-1]
        self.change = self.last - self.first
        self.change_pct = self.change / self.first * 100 if self.first else 0.0
        low_i = min(range(len(self.values)), key=self.values.__getitem__)
        high_i = max(range(len(self.values)), key=self.values.__getitem__)
        self.low, self.low_date = self.values[low_i], self.dates[low_i]
        self.high, self.high_date = self.values[high_i], self.dates[high_i]
        self.avg = sum(self.values) / len(self.values)


@dataclass
class Report:
    period: Period
    series: list
    dates: list
    rows: list  # [(date, [rate | None, ...])]
    missing: list = field(default_factory=list)


def rate_for_units(entry, units):
    """Курс за `units` одиниць валюти, навіть якщо цього дня НБУ котирував за іншу кількість."""
    entry_units = entry.get("units") or 1
    if entry_units == units:
        return entry["rate"]
    per_unit = entry.get("rate_per_unit") or entry["rate"] / entry_units
    return round(per_unit * units, 6)


def build_report(codes, period):
    with ThreadPoolExecutor(max_workers=min(MAX_CURRENCIES, len(codes))) as pool:
        results = list(pool.map(lambda c: fetch_rates(c, period.start, period.end), codes))

    series, missing, by_date = [], [], {}
    for code, entries in zip(codes, results):
        dated = sorted(
            ((dt.datetime.strptime(e["exchangedate"], "%d.%m.%Y").date(), e)
             for e in entries
             if e.get("exchangedate") and e.get("rate") is not None),
            key=lambda pair: pair[0],
        )
        if not dated:
            missing.append(code)
            continue
        # НБУ змінював кількість одиниць котирування (напр. USD за 100 → за 1 з 28.12.2019),
        # тому весь ряд приводимо до одиниць, чинних на кінець періоду
        units = dated[-1][1].get("units") or 1
        points = [(d, rate_for_units(e, units)) for d, e in dated]
        series.append(Series(
            code=code,
            name=entries[0].get("txt") or code,
            units=units,
            dates=[d for d, _ in points],
            values=[r for _, r in points],
        ))
        for d, rate in points:
            by_date.setdefault(d, {})[code] = rate

    dates = sorted(by_date)
    rows = [(d, [by_date[d].get(s.code) for s in series]) for d in dates]
    return Report(period, series, dates, rows, missing)


# ---------- Форматування ----------

def fmt_rate(value):
    if value is None:
        return "—"
    decimals = 4 if abs(value) >= 1 else 5
    return f"{value:,.{decimals}f}".replace(",", " ").replace(".", ",")


def fmt_signed(value, decimals=4, suffix=""):
    sign = "+" if value > 0 else "−" if value < 0 else "±"
    return f"{sign}{abs(value):,.{decimals}f}".replace(",", " ").replace(".", ",") + suffix


app.jinja_env.filters.update(rate=fmt_rate, signed=fmt_signed, date=fmt_date)


def report_query(args, **extra):
    """Параметри поточного звіту для посилань (CSV, пресети)."""
    keys = ("period", "year", "month", "quarter", "start", "end", "start_date", "end_date", "currencies")
    query = {k: args[k] for k in keys if args.get(k)}
    query.update(extra)
    return query


# ---------- Маршрути ----------

@app.get("/")
def index():
    report = error = None
    status = 200
    if "currencies" in request.args:
        try:
            report = build_report(parse_codes(request.args["currencies"]), resolve_period(request.args))
        except InputError as e:
            error, status = str(e), 400
        except NbuError as e:
            error, status = str(e), 502

    chart_data = [
        {"code": s.code, "dates": [fmt_date(d) for d in s.dates],
         "values": s.values, "labels": [fmt_rate(v) for v in s.values]}
        for s in report.series
    ] if report else []

    return render_template(
        "index.html",
        form=form_state(request.args, report.period if report else None),
        directory=currency_directory(),
        popular=POPULAR,
        presets=presets(),
        months=MONTHS,
        quarters=QUARTERS,
        years=range(dt.date.today().year, FIRST_YEAR - 1, -1),
        hryvnia_day=HRYVNIA_DAY.isoformat(),
        report=report,
        chart_data=chart_data,
        error=error,
        csv_url=url_for("download", **report_query(request.args)) if report else None,
        excel_url=url_for("download", **report_query(request.args, format="excel")) if report else None,
    ), status


@app.route("/generate", methods=["GET", "POST"])
def generate():
    # Сумісність зі старою формою: переводимо на GET-сторінку з результатами
    return redirect(url_for("index", **(request.form.to_dict() or request.args.to_dict())), code=303)


@app.get("/download")
def download():
    try:
        period = resolve_period(request.args)
        report = build_report(parse_codes(request.args.get("currencies")), period)
    except InputError as e:
        return str(e), 400
    except NbuError as e:
        return str(e), 502

    excel = request.args.get("format") == "excel"
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";" if excel else ",")
    writer.writerow(["Date"] + [s.code for s in report.series])
    for d, rates in report.rows:
        cells = ["" if r is None else (str(r).replace(".", ",") if excel else r) for r in rates]
        writer.writerow([fmt_date(d)] + cells)

    # BOM, щоб Excel коректно визначив UTF-8
    content = ("﻿" if excel else "") + output.getvalue()
    filename = f"nbu_rates_{period.start:%Y%m%d}-{period.end:%Y%m%d}{'_excel' if excel else ''}.csv"
    return Response(content, mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={filename}"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5555)
