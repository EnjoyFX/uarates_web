import json
import re

Q1 = "/?period=quarter&year=2025&quarter=1&currencies=USD,EUR"


def chart_data(html):
    match = re.search(r'<script type="application/json" id="chart-data">(.*?)</script>', html, re.S)
    return json.loads(match.group(1))


# ---------- головна сторінка ----------

def test_landing_page(client):
    r = client.get("/")
    html = r.get_data(as_text=True)
    assert r.status_code == 200
    assert "Оберіть період і валюти" in html
    assert 'id="chart-data"' not in html
    assert 'value="USD,EUR"' in html


def test_report_page(client):
    r = client.get(Q1)
    html = r.get_data(as_text=True)
    assert r.status_code == 200
    assert "<h1 id=\"results-title\">I квартал 2025</h1>" in html
    assert "01.01.2025 – 31.03.2025" in html
    assert html.count('class="card tile"') == 2
    assert "Завантажити CSV" in html
    data = chart_data(html)
    assert [s["code"] for s in data] == ["USD", "EUR"]
    assert len(data[0]["values"]) == 90
    assert data[0]["dates"][0] == "01.01.2025"
    assert data[0]["labels"][0] == "41,0000"


def test_report_links_keep_query(client):
    html = client.get(Q1).get_data(as_text=True)
    assert "/download?period=quarter&amp;year=2025&amp;quarter=1&amp;currencies=USD,EUR" in html
    assert "format=excel" in html


def test_units_are_shown(client):
    html = client.get("/?period=month&year=2025&month=1&currencies=JPY").get_data(as_text=True)
    assert "за 10 од." in html


def test_missing_currency_warning(client):
    r = client.get("/?period=month&year=2025&month=1&currencies=USD,XYZ")
    html = r.get_data(as_text=True)
    assert r.status_code == 200
    assert "Немає даних за цей період для: <strong>XYZ</strong>" in html
    assert html.count('class="card tile"') == 1


def test_no_data_at_all(client):
    html = client.get("/?period=month&year=2025&month=1&currencies=XYZ").get_data(as_text=True)
    assert "alert-warn" in html
    assert 'class="card tile"' not in html
    assert "Завантажити CSV" not in html


def test_input_error_is_shown_in_form(client):
    r = client.get("/?period=custom&start=2025-03-01&end=2025-01-01&currencies=USD")
    html = r.get_data(as_text=True)
    assert r.status_code == 400
    assert "alert-error" in html
    assert "Дата початку пізніша за дату кінця" in html
    assert 'value="2025-03-01"' in html  # введене користувачем не губиться


def test_nbu_error_is_shown(client, nbu):
    nbu.fail_rates = True
    r = client.get(Q1)
    assert r.status_code == 502
    assert "Не вдалося отримати дані від НБУ" in r.get_data(as_text=True)


def test_static_assets(client):
    assert client.get("/static/app.css").status_code == 200
    assert client.get("/static/app.js").status_code == 200


# ---------- сумісність ----------

def test_generate_post_redirects(client):
    r = client.post("/generate", data={"start_date": "2025-01-01", "end_date": "2025-01-05", "currencies": "usd"})
    assert r.status_code == 303
    assert r.headers["Location"] == "/?start_date=2025-01-01&end_date=2025-01-05&currencies=usd"


def test_generate_get_redirects(client):
    r = client.get("/generate?period=year&year=2024&currencies=EUR")
    assert r.status_code == 303
    assert r.headers["Location"] == "/?period=year&year=2024&currencies=EUR"


def test_legacy_link_renders_report(client):
    r = client.get("/?start_date=2025-01-01&end_date=2025-01-05&currencies=usd")
    html = r.get_data(as_text=True)
    assert r.status_code == 200
    assert "01.01.2025 – 05.01.2025" in html


# ---------- CSV ----------

def test_download_csv(client):
    r = client.get("/download?period=month&year=2025&month=1&currencies=USD,JPY")
    assert r.status_code == 200
    assert r.mimetype == "text/csv"
    assert r.headers["Content-Disposition"] == "attachment; filename=nbu_rates_20250101-20250131.csv"
    lines = r.get_data(as_text=True).splitlines()
    assert lines[0] == "Date,USD,JPY"
    assert lines[1] == "01.01.2025,41.0,2.7"
    assert len(lines) == 32


def test_download_excel_csv(client):
    r = client.get("/download?period=month&year=2025&month=1&currencies=USD,DZD&format=excel")
    text = r.get_data(as_text=True)
    assert text.startswith("﻿")
    assert r.headers["Content-Disposition"].endswith("_excel.csv")
    lines = text.lstrip("﻿").splitlines()
    assert lines[0] == "Date;USD;DZD"
    assert lines[1] == "01.01.2025;41,0;0,33459"


def test_download_excel_with_gaps(client, monkeypatch):
    import app
    from conftest import FakeResponse
    payloads = {
        "usd": [{"exchangedate": "01.01.2025", "rate": 41.0}, {"exchangedate": "02.01.2025", "rate": 42.0}],
        "eur": [{"exchangedate": "02.01.2025", "rate": 43.5}],
    }
    monkeypatch.setattr(app.requests, "get",
                        lambda url, params, timeout: FakeResponse(payloads[params["valcode"]]))
    text = client.get("/download?period=month&year=2025&month=1&currencies=USD,EUR&format=excel").get_data(as_text=True)
    assert text.lstrip("﻿").splitlines()[1:] == ["01.01.2025;41,0;", "02.01.2025;42,0;43,5"]


def test_download_input_error(client):
    r = client.get("/download?period=month&year=2025&month=1")
    assert r.status_code == 400
    assert "хоча б одну валюту" in r.get_data(as_text=True)


def test_download_nbu_error(client, nbu):
    nbu.fail_rates = True
    assert client.get("/download?period=month&year=2025&month=1&currencies=USD").status_code == 502
