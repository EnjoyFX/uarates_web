import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  InputError, MAX_CURRENCIES, buildReport, csvFilename, fmtDate, fmtRate, fmtSigned, formState, iso,
  lastDay, loadDocs, parseCodes, presets, rateForUnits, resolvePeriod, sortDirectory, toCsv, todayIso,
} from "../../site/lib.js";

const TODAY = "2026-10-23";
const q = (obj = {}) => new URLSearchParams(obj);
const period = (obj) => resolvePeriod(q(obj), TODAY);

// ---------- Дати ----------

test("date helpers", () => {
  assert.equal(iso(2025, 3, 7), "2025-03-07");
  assert.equal(lastDay(2024, 2), 29);
  assert.equal(lastDay(2025, 2), 28);
  assert.equal(fmtDate("2025-03-07"), "07.03.2025");
  assert.equal(todayIso(new Date(2026, 0, 5)), "2026-01-05");
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- Період ----------

describe("resolvePeriod", () => {
  test("month", () => {
    assert.deepEqual(period({ period: "month", year: "2024", month: "2" }),
      { kind: "month", start: "2024-02-01", end: "2024-02-29", label: "Лютий 2024" });
  });

  test("month defaults to current", () => {
    const p = period({});
    assert.equal(p.kind, "month");
    assert.equal(p.start, "2026-10-01");
  });

  for (const [quarter, start, end] of [["1", "2025-01-01", "2025-03-31"], ["2", "2025-04-01", "2025-06-30"],
    ["3", "2025-07-01", "2025-09-30"], ["4", "2025-10-01", "2025-12-31"]]) {
    test(`quarter ${quarter}`, () => {
      const p = period({ period: "quarter", year: "2025", quarter });
      assert.deepEqual([p.start, p.end], [start, end]);
      assert.equal(p.label, `${["I", "II", "III", "IV"][quarter - 1]} квартал 2025`);
    });
  }

  test("quarter defaults to current", () => {
    assert.equal(period({ period: "quarter" }).label, "IV квартал 2026");
  });

  test("year", () => {
    assert.deepEqual(period({ period: "year", year: "2023" }),
      { kind: "year", start: "2023-01-01", end: "2023-12-31", label: "2023 рік" });
  });

  test("custom and legacy params", () => {
    assert.equal(period({ period: "custom", start: "2025-01-10", end: "2025-02-05" }).label, "10.01.2025 – 05.02.2025");
    const legacy = period({ start_date: "2025-01-01", end_date: "2025-01-05" });
    assert.deepEqual([legacy.kind, legacy.end], ["custom", "2025-01-05"]);
  });

  test("clamped to hryvnia day", () => {
    const y = period({ period: "year", year: "1996" });
    assert.deepEqual([y.start, y.label], ["1996-09-02", "1996 рік"]);
    const c = period({ period: "custom", start: "1996-01-01", end: "1996-09-30" });
    assert.deepEqual([c.start, c.label], ["1996-09-02", "02.09.1996 – 30.09.1996"]);
  });

  for (const [params, message] of [
    [{ period: "custom", start: "2025-02-01", end: "2025-01-01" }, /пізніша/],
    [{ period: "custom", start: "1990-01-01", end: "1990-02-01" }, /Гривня введена 02\.09\.1996/],
    [{ period: "month", year: "1996", month: "8" }, /Гривня введена/],
    [{ period: "custom", end: "2025-01-01" }, /Заповніть поле «Дата початку»/],
    [{ period: "custom", start: "2025-02-30", end: "2025-03-01" }, /Некоректний формат поля «Дата початку»/],
    [{ period: "custom", start: "01.02.2025", end: "2025-03-01" }, /Некоректний формат/],
    [{ period: "month", month: "13" }, /1–12/],
    [{ period: "month", year: "abc" }, /Некоректне значення/],
    [{ period: "year", year: "1995" }, /1996–2027/],
    [{ period: "week" }, /Невідомий тип/],
  ]) {
    test(`invalid ${JSON.stringify(params)}`, () => {
      assert.throws(() => period(params), (e) => e instanceof InputError && message.test(e.message));
    });
  }
});

// ---------- Валюти ----------

describe("parseCodes", () => {
  test("normalizes and dedupes", () => {
    assert.deepEqual(parseCodes(" usd, EUR;pln  usd,,"), ["USD", "EUR", "PLN"]);
  });

  const tooMany = Array.from({ length: MAX_CURRENCIES + 1 }, (_, i) => `A${String.fromCharCode(65 + i)}A`).join(",");
  for (const [raw, message] of [["", /хоча б одну/], [null, /хоча б одну/], ["US1", /не схоже/],
    ["DOLLAR", /не схоже/], [tooMany, /не більше/]]) {
    test(`rejects ${JSON.stringify(raw).slice(0, 20)}`, () => {
      assert.throws(() => parseCodes(raw), (e) => e instanceof InputError && message.test(e.message));
    });
  }
});

// ---------- Пресети й форма ----------

describe("presets", () => {
  const byTitle = (today) => Object.fromEntries(presets(today).map((p) => [p.title, p]));

  test("mid year", () => {
    const p = byTitle("2025-05-15");
    assert.deepEqual(p["Цей місяць"], { title: "Цей місяць", period: "month", year: 2025, month: 5 });
    assert.equal(p["Минулий місяць"].month, 4);
    assert.equal(p["Цей квартал"].quarter, 2);
    assert.deepEqual([p["Минулий квартал"].year, p["Минулий квартал"].quarter], [2025, 1]);
    assert.equal(p["Минулий рік"].year, 2024);
  });

  test("january wraps to previous year", () => {
    const p = byTitle("2025-01-10");
    assert.deepEqual([p["Минулий місяць"].year, p["Минулий місяць"].month], [2024, 12]);
    assert.deepEqual([p["Минулий квартал"].year, p["Минулий квартал"].quarter], [2024, 4]);
  });

  test("defaults to today", () => {
    assert.equal(presets()[0].year, new Date().getFullYear());
  });
});

describe("formState", () => {
  test("defaults", () => {
    assert.deepEqual(formState(q(), null, TODAY), {
      period: "month", year: 2026, month: 10, quarter: 4,
      start: "2026-10-01", end: "2026-10-23", currencies: "USD,EUR",
    });
  });

  test("dates from report period", () => {
    const p = { kind: "quarter", start: "2024-04-01", end: "2024-06-30", label: "" };
    const s = formState(q({ period: "quarter", currencies: "PLN" }), p, TODAY);
    assert.deepEqual([s.start, s.end, s.year, s.month, s.quarter, s.currencies],
      ["2024-04-01", "2024-06-30", 2024, 6, 2, "PLN"]);
  });

  test("current period ends today, explicit and legacy params win", () => {
    const p = { kind: "month", start: "2026-10-01", end: "2026-10-31", label: "" };
    assert.equal(formState(q(), p, TODAY).end, "2026-10-23");
    const s = formState(q({ year: "2020", month: "x", start_date: "2025-01-01", end_date: "2025-01-05", currencies: "" }), null, TODAY);
    assert.deepEqual([s.period, s.year, s.month, s.start, s.end, s.currencies],
      ["custom", 2020, 10, "2025-01-01", "2025-01-05", ""]);
  });

  test("defaults for no params helper", () => {
    assert.equal(formState(q()).period, "month");
  });
});

// ---------- Звіт ----------

const row = (date, rate, units = 1) => ({ date, rate, units, rate_per_unit: Math.round((rate / units) * 1e8) / 1e8 });
const doc = (name, rates) => ({ schema: 1, name, rates });

describe("rateForUnits", () => {
  test("same units keeps official rate", () => assert.equal(rateForUnits(row("2025-01-01", 41.5), 1), 41.5));
  test("converts via rate_per_unit", () => {
    assert.equal(rateForUnits(row("2019-12-27", 2368.62, 100), 1), 23.6862);
    assert.equal(rateForUnits(row("2019-12-27", 216.26, 1000), 10), 2.1626);
  });
});

describe("buildReport", () => {
  const Q4 = { kind: "custom", start: "2019-12-27", end: "2019-12-29", label: "" };
  const docs = new Map([
    ["USD", doc("Долар США", [row("2019-12-26", 2370, 100), row("2019-12-27", 2368.62, 100), row("2019-12-28", 23.6862),
      row("2019-12-29", 23.7)])],
    ["JPY", doc("Єна", [row("2019-12-27", 216.26, 1000), row("2019-12-28", 2.1626, 10)])],
    ["XAU", doc(null, [row("2019-12-27", 0)])],
    ["XYZ", null],
  ]);

  test("normalizes units, filters period, aligns dates", () => {
    const r = buildReport(["USD", "JPY", "XYZ"], Q4, docs);
    assert.deepEqual(r.missing, ["XYZ"]);
    assert.deepEqual(r.dates, ["2019-12-27", "2019-12-28", "2019-12-29"]);
    assert.deepEqual(r.rows, [["2019-12-27", [23.6862, 2.1626]], ["2019-12-28", [23.6862, 2.1626]],
      ["2019-12-29", [23.7, null]]]);
    const [usd, jpy] = r.series;
    assert.deepEqual([usd.units, usd.name, jpy.units], [1, "Долар США", 10]);
    assert.deepEqual([usd.low, usd.lowDate, usd.high, usd.highDate], [23.6862, "2019-12-27", 23.7, "2019-12-29"]);
    assert.ok(Math.abs(usd.change - 0.0138) < 1e-9);
    assert.ok(Math.abs(usd.changePct - (0.0138 / 23.6862) * 100) < 1e-9);
    assert.ok(Math.abs(usd.avg - (23.6862 * 2 + 23.7) / 3) < 1e-9);
  });

  test("currency without data in period is missing", () => {
    const r = buildReport(["USD"], { kind: "year", start: "2001-01-01", end: "2001-12-31", label: "" }, docs);
    assert.deepEqual([r.series.length, r.missing, r.rows], [0, ["USD"], []]);
  });

  test("zero first rate and missing name", () => {
    const [xau] = buildReport(["XAU"], Q4, docs).series;
    assert.deepEqual([xau.name, xau.changePct], ["XAU", 0]);
  });
});

test("loadDocs fetches every currency in parallel", async () => {
  const urls = [];
  const docs = await loadDocs(["USD", "XYZ"], async (url) => {
    urls.push(url);
    return url.endsWith("USD.json") ? { rates: [] } : null;
  }, "https://data/v1/");
  assert.deepEqual(urls, ["https://data/v1/USD.json", "https://data/v1/XYZ.json"]);
  assert.deepEqual([...docs], [["USD", { rates: [] }], ["XYZ", null]]);
});

// ---------- Форматування й CSV ----------

test("fmtRate", () => {
  assert.equal(fmtRate(null), "—");
  assert.equal(fmtRate(41.5), "41,5000");
  assert.equal(fmtRate(0.33459), "0,33459");
  assert.equal(fmtRate(1234.5), "1 234,5000");
  assert.equal(fmtRate(-2), "−2,0000");
});

test("fmtSigned", () => {
  assert.equal(fmtSigned(0.55), "+0,5500");
  assert.equal(fmtSigned(-1.25, 2, " %"), "−1,25 %");
  assert.equal(fmtSigned(0), "±0,0000");
  assert.equal(fmtSigned(3, 0), "+3");
});

describe("CSV", () => {
  const report = {
    period: { start: "2025-01-01", end: "2025-01-31" },
    series: [{ code: "USD" }, { code: "EUR" }],
    rows: [["2025-01-01", [41.0295, null]], ["2025-01-02", [41.9725, 43.5]]],
  };

  test("plain", () => {
    assert.equal(toCsv(report), "Date,USD,EUR\r\n01.01.2025,41.0295,\r\n02.01.2025,41.9725,43.5\r\n");
    assert.equal(csvFilename(report.period), "nbu_rates_20250101-20250131.csv");
  });

  test("excel", () => {
    assert.equal(toCsv(report, true), "﻿Date;USD;EUR\r\n01.01.2025;41,0295;\r\n02.01.2025;41,9725;43,5\r\n");
    assert.equal(csvFilename(report.period, true), "nbu_rates_20250101-20250131_excel.csv");
  });
});

test("sortDirectory puts popular first, rest by name", () => {
  const index = { currencies: [
    { code: "ZAR", name: "Ренд" }, { code: "EUR", name: "Євро" }, { code: "AUD", name: "Австралійський долар" },
    { code: "USD", name: "Долар США" }, { code: "XDR", name: null },
  ] };
  assert.deepEqual(sortDirectory(index).map((c) => c.code), ["USD", "EUR", "AUD", "ZAR", "XDR"]);
});
