import {
  DATA_URL, FIRST_YEAR, HRYVNIA_DAY, InputError, MONTHS, POPULAR, QUARTERS,
  buildReport, csvFilename, fmtDate, fmtRate, fmtSigned, formState, loadDocs, parseCodes,
  presets, resolvePeriod, sortDirectory, toCsv, todayIso,
} from "./lib.js";

const form = document.getElementById("query-form");
const output = document.getElementById("output");
const params = new URLSearchParams(location.search);
const today = todayIso();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = {
  error: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-.75 4.5h1.5v5h-1.5v-5Zm0 6.5h1.5v1.5h-1.5V13Z"/></svg>',
  warn: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 1 18h18L10 2Zm-.75 5.5h1.5v5h-1.5v-5Zm0 6.5h1.5v1.5h-1.5V14Z"/></svg>',
  download: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9.25 3h1.5v8.19l2.72-2.72 1.06 1.06L10 14.06 5.47 9.53l1.06-1.06 2.72 2.72V3ZM4 15.5h12V17H4v-1.5Z"/></svg>',
};

async function fetchJson(url) {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ---------- Форма ----------

function fillForm(state) {
  const option = (value, text, selected) => `<option value="${value}"${selected ? " selected" : ""}>${esc(text)}</option>`;
  const currentYear = Number(today.slice(0, 4));
  const years = [];
  for (let y = currentYear; y >= FIRST_YEAR; y--) years.push(option(y, y, y === state.year));
  form.elements.year.innerHTML = years.join("");
  form.elements.month.innerHTML = MONTHS.map((m, i) => option(i + 1, m, i + 1 === state.month)).join("");
  form.elements.quarter.innerHTML = QUARTERS.map((q, i) => {
    const span = `${MONTHS[i * 3].slice(0, 3).toLowerCase()}–${MONTHS[i * 3 + 2].slice(0, 3).toLowerCase()}`;
    return option(i + 1, `${q} квартал (${span})`, i + 1 === state.quarter);
  }).join("");
  const radio = form.querySelector(`#period-${state.period}`);
  if (radio) radio.checked = true;
  form.elements.start.value = state.start;
  form.elements.end.value = state.end;
  form.elements.start.min = form.elements.end.min = HRYVNIA_DAY;
  form.elements.currencies.value = state.currencies;
}

function setupPresets() {
  const box = form.querySelector(".presets");
  for (const p of presets(today)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-btn";
    btn.textContent = p.title;
    btn.addEventListener("click", () => {
      form.querySelector(`#period-${p.period}`).checked = true;
      for (const key of ["year", "month", "quarter"]) {
        if (p[key] != null) form.elements[key].value = p[key];
      }
      form.requestSubmit();
    });
    box.append(btn);
  }
}

// ---------- Вибір валют ----------
// Текстове поле стає прихованим, а замість нього — пошук з підказками.

function setupPicker(directoryPromise) {
  const rawInput = form.querySelector("[data-currency-input]");
  let directory = [];
  const names = new Map();
  let selected = [...new Set(rawInput.value.toUpperCase().split(/[\s,;]+/).filter(Boolean))];

  const picker = document.createElement("div");
  picker.className = "picker";
  const search = document.createElement("input");
  search.className = "picker-search";
  search.id = rawInput.id;
  search.placeholder = "Код або назва валюти";
  search.autocomplete = "off";
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-expanded", "false");
  search.setAttribute("aria-controls", "currency-options");
  const list = document.createElement("ul");
  list.className = "picker-list";
  list.id = "currency-options";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  rawInput.removeAttribute("id");
  rawInput.type = "hidden";
  rawInput.after(picker);
  picker.append(search, list);

  const popular = form.querySelector("[data-popular]");
  for (const code of POPULAR) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-btn";
    b.dataset.toggleCode = code;
    b.textContent = code;
    popular.append(b);
  }
  popular.hidden = false;

  let options = [];
  let active = 0;

  function sync() {
    rawInput.value = selected.join(",");
    picker.querySelectorAll(".picker-chip").forEach((c) => c.remove());
    for (const code of selected) {
      const chip = document.createElement("span");
      chip.className = "picker-chip";
      chip.title = names.get(code) || code;
      chip.textContent = code;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Прибрати ${code}`);
      remove.textContent = "×";
      remove.addEventListener("click", (e) => { e.stopPropagation(); toggle(code, false); search.focus(); });
      chip.append(remove);
      picker.insertBefore(chip, search);
    }
    popular.querySelectorAll("[data-toggle-code]").forEach((b) => {
      b.setAttribute("aria-pressed", String(selected.includes(b.dataset.toggleCode)));
    });
  }

  function toggle(code, on = !selected.includes(code)) {
    selected = on ? [...new Set([...selected, code])] : selected.filter((c) => c !== code);
    sync();
  }

  function renderList() {
    const q = search.value.trim().toLowerCase();
    options = directory.filter((c) => !selected.includes(c.code) &&
      (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)));
    active = Math.min(active, Math.max(options.length - 1, 0));
    list.replaceChildren();
    if (!options.length) {
      const empty = document.createElement("li");
      empty.className = "picker-empty";
      empty.textContent = directory.length ? "Нічого не знайдено" : "Завантаження списку валют…";
      list.append(empty);
    }
    options.forEach((c, i) => {
      const li = document.createElement("li");
      li.className = "picker-option";
      li.id = `currency-opt-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === active));
      const b = document.createElement("b");
      b.textContent = c.code;
      const s = document.createElement("span");
      s.textContent = c.name;
      li.append(b, s);
      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
      li.addEventListener("mousemove", () => setActive(i));
      list.append(li);
    });
    search.setAttribute("aria-activedescendant", options.length ? `currency-opt-${active}` : "");
  }

  function setActive(i) {
    active = i;
    list.querySelectorAll(".picker-option").forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    list.children[i]?.scrollIntoView({ block: "nearest" });
    search.setAttribute("aria-activedescendant", `currency-opt-${i}`);
  }

  function open() {
    list.hidden = false;
    search.setAttribute("aria-expanded", "true");
    renderList();
  }

  function close() {
    list.hidden = true;
    search.setAttribute("aria-expanded", "false");
  }

  function choose(i) {
    const c = options[i];
    if (!c) return;
    toggle(c.code, true);
    search.value = "";
    active = 0;
    renderList();
  }

  picker.addEventListener("mousedown", (e) => {
    if (e.target === picker) { e.preventDefault(); search.focus(); }
  });
  search.addEventListener("focus", open);
  search.addEventListener("blur", close);
  search.addEventListener("input", () => { active = 0; open(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) open(); else setActive(Math.min(active + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === "Enter" && !list.hidden && options.length && search.value) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { close(); }
    else if (e.key === "Backspace" && !search.value && selected.length) { toggle(selected[selected.length - 1], false); }
  });
  popular.addEventListener("click", (e) => {
    const b = e.target.closest("[data-toggle-code]");
    if (b) toggle(b.dataset.toggleCode);
  });

  directoryPromise.then((items) => {
    directory = items;
    for (const c of items) names.set(c.code, c.name);
    sync();
    if (!list.hidden) renderList();
  });
  sync();

  return { picker, search, isEmpty: () => !selected.length };
}

function setupSubmit(picker) {
  const submit = form.querySelector("[data-submit]");
  const label = form.querySelector("[data-submit-label]");
  form.addEventListener("submit", (e) => {
    if (picker.isEmpty()) {
      e.preventDefault();
      picker.search.focus();
      picker.picker.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 200 });
      return;
    }
    // Відправляємо лише поля обраного типу періоду — адреса виходить короткою й читабельною
    const used = { month: ["year", "month"], quarter: ["year", "quarter"], year: ["year"], custom: ["start", "end"] }[form.elements.period.value];
    for (const name of ["year", "month", "quarter", "start", "end"]) form.elements[name].disabled = !used.includes(name);
    submit.classList.add("is-loading");
    submit.disabled = true;
    label.textContent = "Завантаження…";
  });
  // Повернення назад з bfcache — розблоковуємо форму
  window.addEventListener("pageshow", () => {
    submit.classList.remove("is-loading");
    submit.disabled = false;
    label.textContent = "Показати курси";
    form.querySelectorAll("select, input[type=date]").forEach((el) => { el.disabled = false; });
  });
}

// ---------- Результати ----------

const alert = (kind, html) => `<div class="alert alert-${kind}" role="${kind === "error" ? "alert" : "status"}">${icon[kind]}<span>${html}</span></div>`;

function renderEmpty() {
  output.innerHTML = `
    <div class="empty card">
      <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 38h36v3H6zM10 30l9-9 7 6 12-14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p><strong>Оберіть період і валюти</strong></p>
      <p class="muted">Покажемо динаміку, мінімум, максимум і таблицю курсів, яку можна завантажити в CSV.</p>
    </div>`;
}

function renderLoading() {
  output.innerHTML = '<div class="empty card"><p class="muted">Завантаження курсів…</p></div>';
}

function renderTile(s, i) {
  const arrow = s.change > 0 ? "▲" : s.change < 0 ? "▼" : "●";
  const units = s.units !== 1 ? ` · за ${s.units} од.` : "";
  return `
    <article class="card tile">
      <header class="tile-head">
        <span class="tile-code">${esc(s.code)}</span>
        <span class="tile-name">${esc(s.name)}${units}</span>
      </header>
      <div class="tile-value">${fmtRate(s.last)} <span class="tile-unit">грн</span></div>
      <div class="tile-delta">
        <span class="delta-arrow" aria-hidden="true">${arrow}</span>
        ${fmtSigned(s.change)} · ${fmtSigned(s.changePct, 2, " %")}
        <span class="muted">з ${fmtDate(s.dates[0])}</span>
      </div>
      <div class="chart" data-chart="${i}" role="img"
           aria-label="Динаміка курсу ${esc(s.code)}: від ${fmtRate(s.first)} до ${fmtRate(s.last)} грн"></div>
      <div class="chart-axis" aria-hidden="true">
        <span>${fmtDate(s.dates[0])}</span><span>${fmtDate(s.dates[s.dates.length - 1])}</span>
      </div>
      <dl class="tile-stats">
        <div><dt>Мінімум</dt><dd>${fmtRate(s.low)}</dd><dd class="muted">${fmtDate(s.lowDate)}</dd></div>
        <div><dt>Середній</dt><dd>${fmtRate(s.avg)}</dd><dd class="muted">за період</dd></div>
        <div><dt>Максимум</dt><dd>${fmtRate(s.high)}</dd><dd class="muted">${fmtDate(s.highDate)}</dd></div>
      </dl>
    </article>`;
}

function renderReport(report) {
  const { period, series, rows, missing } = report;
  document.title = `${period.label} · Курси валют НБУ`;
  const head = `
    <header class="results-head">
      <div>
        <h1 id="results-title">${esc(period.label)}</h1>
        <p class="muted">${fmtDate(period.start)} – ${fmtDate(period.end)}${rows.length ? ` · ${rows.length} дат з курсом` : ""} · офіційний курс НБУ, грн</p>
      </div>
      ${series.length ? `
      <div class="results-actions">
        <button type="button" class="btn btn-secondary" data-download="excel" title="Розділювач «;», десяткова кома — відкривається в Excel з українськими налаштуваннями">CSV для Excel</button>
        <button type="button" class="btn btn-primary" data-download="csv">${icon.download} Завантажити CSV</button>
      </div>` : ""}
    </header>`;
  const warn = missing.length
    ? alert("warn", `Немає даних за цей період для: <strong>${missing.map(esc).join(", ")}</strong>. Перевірте код валюти або оберіть інший період.`)
    : "";
  const body = series.length ? `
    <div class="tiles">${series.map(renderTile).join("")}</div>
    <div class="card table-card">
      <div class="table-head"><h2>Курси за датами</h2><span class="muted">${rows.length} рядків</span></div>
      <div class="table-scroll">
        <table class="rates">
          <thead><tr><th scope="col">Дата</th>${series.map((s) => `<th scope="col" class="num">${esc(s.code)}${s.units !== 1 ? ` <span class="muted">/${s.units}</span>` : ""}</th>`).join("")}</tr></thead>
          <tbody>${rows.map(([d, rates]) => `<tr><th scope="row">${fmtDate(d)}</th>${rates.map((r) => `<td class="num">${fmtRate(r)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  output.innerHTML = `<section class="results" aria-labelledby="results-title">${head}${warn}${body}</section>`;
  output.querySelectorAll("[data-download]").forEach((btn) => {
    btn.addEventListener("click", () => download(report, btn.dataset.download === "excel"));
  });
  output.querySelectorAll("[data-chart]").forEach((el) => renderChart(el, series[Number(el.dataset.chart)]));
}

function download(report, excel) {
  const blob = new Blob([toCsv(report, excel)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = csvFilename(report.period, excel);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Графік ----------

const SVG = "http://www.w3.org/2000/svg";
const W = 300;
const H = 96;
const PAD = 6;

function renderChart(el, s) {
  const v = s.values;
  const n = v.length;
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (hi === lo) { lo -= Math.abs(lo) * 0.01 || 1; hi += Math.abs(hi) * 0.01 || 1; }
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (val) => PAD + (1 - (val - lo) / (hi - lo)) * (H - 2 * PAD);

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const pts = v.map((val, i) => `${x(i).toFixed(2)},${y(val).toFixed(2)}`);
  const path = (cls, d) => {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("class", cls);
    p.setAttribute("d", d);
    return p;
  };
  const base = document.createElementNS(SVG, "line");
  base.setAttribute("class", "grid");
  base.setAttribute("x1", 0); base.setAttribute("x2", W);
  base.setAttribute("y1", H - 0.5); base.setAttribute("y2", H - 0.5);
  svg.append(base, path("area", `M${pts[0]} L${pts.join(" L")} L${x(n - 1)},${H} L${x(0)},${H} Z`), path("line", `M${pts.join(" L")}`));

  // Маркер, вертикаль і підказка — HTML, щоб не розтягувались разом з viewBox
  const cross = document.createElement("div");
  cross.className = "chart-cross";
  const dot = document.createElement("div");
  dot.className = "chart-dot";
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.setAttribute("role", "status");
  for (const node of [cross, dot, tip]) node.hidden = true;
  el.append(svg, cross, dot, tip);

  if (n === 1) {
    dot.hidden = false;
    dot.style.left = "50%";
    dot.style.top = `${(y(v[0]) / H) * 100}%`;
  }

  const show = (clientX) => {
    const rect = el.getBoundingClientRect();
    const fx = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const i = Math.round(fx * (n - 1));
    const left = (x(i) / W) * 100;
    cross.style.left = `${left}%`;
    dot.style.left = `${left}%`;
    dot.style.top = `${(y(v[i]) / H) * 100}%`;
    const b = document.createElement("b");
    b.textContent = `${fmtRate(v[i])} грн`;
    tip.replaceChildren(`${fmtDate(s.dates[i])} · `, b);
    cross.hidden = dot.hidden = tip.hidden = false;
    // Підказка не виходить за межі графіка
    const tipW = tip.offsetWidth;
    const px = (left / 100) * rect.width;
    tip.style.left = `${Math.min(Math.max(px - tipW / 2, 0), rect.width - tipW)}px`;
  };
  const hide = () => {
    cross.hidden = tip.hidden = true;
    dot.hidden = n !== 1;
  };
  el.addEventListener("pointermove", (e) => show(e.clientX));
  el.addEventListener("pointerdown", (e) => show(e.clientX));
  el.addEventListener("pointerleave", hide);
}

// ---------- Запуск ----------

async function main() {
  let period = null;
  let codes = null;
  let error = null;
  if (params.has("currencies")) {
    try {
      codes = parseCodes(params.get("currencies"));
      period = resolvePeriod(params, today);
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      error = e.message;
    }
  }

  fillForm(formState(params, period, today));
  setupPresets();
  const directory = fetchJson(`${DATA_URL}index.json`).then((index) => sortDirectory(index)).catch(() => []);
  setupSubmit(setupPicker(directory));

  if (error) {
    output.innerHTML = alert("error", esc(error));
    return;
  }
  if (!codes) {
    renderEmpty();
    return;
  }
  renderLoading();
  try {
    renderReport(buildReport(codes, period, await loadDocs(codes, fetchJson)));
  } catch {
    output.innerHTML = alert("error", "Не вдалося завантажити дані курсів. Перевірте з'єднання й спробуйте ще раз.");
  }
}

main();
