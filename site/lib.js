// Логіка статичної версії без DOM: періоди, валюти, звіт, форматування, CSV.
// Дані — відкриті файли https://github.com/EnjoyFX/uarates_data (формат v1).

export const DATA_URL = "https://enjoyfx.github.io/uarates_data/v1/";
export const HRYVNIA_DAY = "1996-09-02"; // грошова реформа: раніше НБУ встановлював курси в карбованцях
export const FIRST_YEAR = 1996;
export const MAX_CURRENCIES = 10;
export const MONTHS = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень",
];
export const QUARTERS = ["I", "II", "III", "IV"];
export const POPULAR = ["USD", "EUR", "PLN", "GBP", "CHF", "CZK", "CNY", "JPY"];

/** Некоректні параметри запиту — показуємо користувачу як є. */
export class InputError extends Error {}

// ---------- Дати (рядки ISO "YYYY-MM-DD") ----------

const pad = (n) => String(n).padStart(2, "0");
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const fmtDate = (s) => s.split("-").reverse().join(".");
export const todayIso = (now = new Date()) => iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
const parts = (s) => s.split("-").map(Number);

function parseIntField(value, fallback, lo, hi, name) {
  if (value == null || value === "") return fallback;
  if (!/^-?\d+$/.test(value)) throw new InputError(`Некоректне значення поля «${name}»`);
  const n = Number(value);
  if (n < lo || n > hi) throw new InputError(`Поле «${name}» має бути в межах ${lo}–${hi}`);
  return n;
}

function parseDate(value, name) {
  if (!value) throw new InputError(`Заповніть поле «${name}»`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  // 2025-02-30 перетвориться на 2025-03-02 — такі дати відкидаємо
  if (!m || new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) !== value) {
    throw new InputError(`Некоректний формат поля «${name}»`);
  }
  return value;
}

// ---------- Період ----------

const periodKind = (params) => params.get("period") || (params.get("start_date") ? "custom" : "month");

function requestedPeriod(params, today) {
  const [ty, tm] = parts(today);
  const kind = periodKind(params);

  if (kind === "custom") {
    const start = parseDate(params.get("start") || params.get("start_date"), "Дата початку");
    const end = parseDate(params.get("end") || params.get("end_date"), "Дата кінця");
    if (start > end) throw new InputError("Дата початку пізніша за дату кінця");
    return { kind, start, end, label: `${fmtDate(start)} – ${fmtDate(end)}` };
  }

  const year = parseIntField(params.get("year"), ty, FIRST_YEAR, ty + 1, "Рік");
  if (kind === "month") {
    const month = parseIntField(params.get("month"), tm, 1, 12, "Місяць");
    return { kind, start: iso(year, month, 1), end: iso(year, month, lastDay(year, month)),
             label: `${MONTHS[month - 1]} ${year}` };
  }
  if (kind === "quarter") {
    const quarter = parseIntField(params.get("quarter"), Math.floor((tm - 1) / 3) + 1, 1, 4, "Квартал");
    const last = quarter * 3;
    return { kind, start: iso(year, last - 2, 1), end: iso(year, last, lastDay(year, last)),
             label: `${QUARTERS[quarter - 1]} квартал ${year}` };
  }
  if (kind === "year") {
    return { kind, start: iso(year, 1, 1), end: iso(year, 12, 31), label: `${year} рік` };
  }
  throw new InputError("Невідомий тип періоду");
}

export function resolvePeriod(params, today = todayIso()) {
  const period = requestedPeriod(params, today);
  if (period.end < HRYVNIA_DAY) {
    throw new InputError(`Гривня введена ${fmtDate(HRYVNIA_DAY)}; за раніший період курсів гривні немає`);
  }
  // Курси в карбованцях не змішуємо з гривневими — період починається з дня реформи
  if (period.start < HRYVNIA_DAY) {
    period.start = HRYVNIA_DAY;
    if (period.kind === "custom") period.label = `${fmtDate(period.start)} – ${fmtDate(period.end)}`;
  }
  return period;
}

export function parseCodes(raw) {
  const codes = [];
  for (const part of (raw || "").toUpperCase().split(/[\s,;]+/)) {
    if (!part) continue;
    if (!/^[A-Z]{3}$/.test(part)) {
      throw new InputError(`«${part}» — не схоже на код валюти (очікується 3 літери, напр. USD)`);
    }
    if (!codes.includes(part)) codes.push(part);
  }
  if (!codes.length) throw new InputError("Оберіть хоча б одну валюту");
  if (codes.length > MAX_CURRENCIES) throw new InputError(`Можна обрати не більше ${MAX_CURRENCIES} валют`);
  return codes;
}

/** Швидкі періоди для кнопок над формою. */
export function presets(today = todayIso()) {
  const [y, m] = parts(today);
  const [pmy, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const q = Math.floor((m - 1) / 3) + 1;
  const [pqy, pq] = q === 1 ? [y - 1, 4] : [y, q - 1];
  return [
    { title: "Цей місяць", period: "month", year: y, month: m },
    { title: "Минулий місяць", period: "month", year: pmy, month: pm },
    { title: "Цей квартал", period: "quarter", year: y, quarter: q },
    { title: "Минулий квартал", period: "quarter", year: pqy, quarter: pq },
    { title: "Цей рік", period: "year", year: y },
    { title: "Минулий рік", period: "year", year: y - 1 },
  ];
}

/** Значення полів форми: з адреси, а для незаповнених — дефолти; дати довільного періоду — з поточного звіту. */
export function formState(params, period = null, today = todayIso()) {
  const start = period ? period.start : today.slice(0, 8) + "01";
  const end = period && period.end < today ? period.end : today;
  const [ey, em] = parts(end);
  const int = (key) => (/^\d+$/.test(params.get(key) || "") ? Number(params.get(key)) : null);
  return {
    period: periodKind(params),
    year: int("year") || ey,
    month: int("month") || em,
    quarter: int("quarter") || Math.floor((em - 1) / 3) + 1,
    start: params.get("start") || params.get("start_date") || start,
    end: params.get("end") || params.get("end_date") || end,
    currencies: params.get("currencies") ?? "USD,EUR",
  };
}

// ---------- Звіт ----------

/** Курс за `units` одиниць, навіть якщо цього дня НБУ котирував за іншу кількість. */
export function rateForUnits(row, units) {
  if (row.units === units) return row.rate;
  return Math.round(row.rate_per_unit * units * 1e6) / 1e6;
}

function makeSeries(code, doc, rows) {
  // НБУ змінював кількість одиниць котирування (напр. USD за 100 → за 1 з 28.12.2019),
  // тому весь ряд приводимо до одиниць, чинних на кінець періоду
  const units = rows[rows.length - 1].units;
  const dates = rows.map((r) => r.date);
  const values = rows.map((r) => rateForUnits(r, units));
  const first = values[0];
  const last = values[values.length - 1];
  let lowI = 0;
  let highI = 0;
  values.forEach((v, i) => {
    if (v < values[lowI]) lowI = i;
    if (v > values[highI]) highI = i;
  });
  return {
    code, name: doc.name || code, units, dates, values, first, last,
    change: last - first,
    changePct: first ? ((last - first) / first) * 100 : 0,
    low: values[lowI], lowDate: dates[lowI],
    high: values[highI], highDate: dates[highI],
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

/** docs: Map(code → документ валюти або null, якщо такої валюти немає). */
export function buildReport(codes, period, docs) {
  const series = [];
  const missing = [];
  const byDate = new Map();
  for (const code of codes) {
    const doc = docs.get(code);
    const rows = doc ? doc.rates.filter((r) => r.date >= period.start && r.date <= period.end) : [];
    if (!rows.length) {
      missing.push(code);
      continue;
    }
    const s = makeSeries(code, doc, rows);
    series.push(s);
    s.dates.forEach((d, i) => {
      if (!byDate.has(d)) byDate.set(d, {});
      byDate.get(d)[code] = s.values[i];
    });
  }
  const dates = [...byDate.keys()].sort();
  const rows = dates.map((d) => [d, series.map((s) => byDate.get(d)[s.code] ?? null)]);
  return { period, series, dates, rows, missing };
}

/** Завантажує документи валют паралельно; fetchJson(url) повертає null, якщо файлу немає. */
export async function loadDocs(codes, fetchJson, base = DATA_URL) {
  const docs = await Promise.all(codes.map((c) => fetchJson(`${base}${c}.json`)));
  return new Map(codes.map((c, i) => [c, docs[i]]));
}

// ---------- Форматування ----------

function group(value, decimals) {
  const [int, frac] = Math.abs(value).toFixed(decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac ? `${grouped},${frac}` : grouped;
}

export function fmtRate(value) {
  if (value == null) return "—";
  return (value < 0 ? "−" : "") + group(value, Math.abs(value) >= 1 ? 4 : 5);
}

export function fmtSigned(value, decimals = 4, suffix = "") {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${group(value, decimals)}${suffix}`;
}

// ---------- CSV ----------

export function toCsv(report, excel = false) {
  const sep = excel ? ";" : ",";
  const cell = (v) => (v == null ? "" : excel ? String(v).replace(".", ",") : String(v));
  const lines = [["Date", ...report.series.map((s) => s.code)].join(sep)];
  for (const [date, rates] of report.rows) lines.push([fmtDate(date), ...rates.map(cell)].join(sep));
  // BOM, щоб Excel коректно визначив UTF-8
  return (excel ? "﻿" : "") + lines.join("\r\n") + "\r\n";
}

export function csvFilename(period, excel = false) {
  const compact = (s) => s.replaceAll("-", "");
  return `nbu_rates_${compact(period.start)}-${compact(period.end)}${excel ? "_excel" : ""}.csv`;
}

// ---------- Довідник ----------

/** Валюти з index.json: популярні першими, решта за назвою. */
export function sortDirectory(index) {
  const rank = (code) => (POPULAR.includes(code) ? POPULAR.indexOf(code) : POPULAR.length);
  return index.currencies
    .map((c) => ({ code: c.code, name: c.name || c.code }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name, "uk"));
}
