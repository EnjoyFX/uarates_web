(() => {
  "use strict";

  const form = document.getElementById("query-form");
  const readJson = (id) => {
    const el = document.getElementById(id);
    try { return el ? JSON.parse(el.textContent) : null; } catch { return null; }
  };

  // ---------- Вибір валют ----------
  // Текстове поле лишається робочим без JS; тут воно стає прихованим, а замість нього — picker.

  const rawInput = form.querySelector("[data-currency-input]");
  const directory = readJson("currency-directory") || [];
  const names = new Map(directory.map((c) => [c.code, c.name]));
  let selected = rawInput.value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  selected = [...new Set(selected)];

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
    // Дозволяємо ввести код, якого немає в сьогоднішньому довіднику (історичні валюти)
    if (/^[a-z]{3}$/.test(q) && !names.has(q.toUpperCase()) && !selected.includes(q.toUpperCase())) {
      options.unshift({ code: q.toUpperCase(), name: "додати код" });
    }
    active = Math.min(active, Math.max(options.length - 1, 0));
    list.replaceChildren();
    if (!options.length) {
      const empty = document.createElement("li");
      empty.className = "picker-empty";
      empty.textContent = "Нічого не знайдено";
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
    const el = list.children[i];
    if (el) el.scrollIntoView({ block: "nearest" });
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

  sync();

  // ---------- Швидкі періоди ----------

  form.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = JSON.parse(btn.dataset.preset);
      form.querySelector(`#period-${p.period}`).checked = true;
      for (const key of ["year", "month", "quarter"]) {
        if (p[key] != null) form.elements[key].value = p[key];
      }
      form.requestSubmit();
    });
  });

  // ---------- Відправка ----------

  form.addEventListener("submit", (e) => {
    if (!selected.length) {
      e.preventDefault();
      search.focus();
      picker.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 200 });
      return;
    }
    // Відправляємо лише поля обраного типу періоду — URL виходить коротким і читабельним
    const period = form.elements.period.value;
    const used = { month: ["year", "month"], quarter: ["year", "quarter"], year: ["year"], custom: ["start", "end"] }[period];
    for (const name of ["year", "month", "quarter", "start", "end"]) {
      form.elements[name].disabled = !used.includes(name);
    }
    const submit = form.querySelector("[data-submit]");
    submit.classList.add("is-loading");
    submit.disabled = true;
    form.querySelector("[data-submit-label]").textContent = "Завантаження…";
  });

  // Повернення назад з bfcache — розблоковуємо форму
  window.addEventListener("pageshow", () => {
    const submit = form.querySelector("[data-submit]");
    submit.classList.remove("is-loading");
    submit.disabled = false;
    form.querySelector("[data-submit-label]").textContent = "Показати курси";
    form.querySelectorAll("select, input[type=date]").forEach((el) => { el.disabled = false; });
  });

  // ---------- Графіки ----------

  const SVG = "http://www.w3.org/2000/svg";
  const W = 300, H = 96, PAD = 6;
  const charts = readJson("chart-data") || [];

  document.querySelectorAll("[data-chart]").forEach((el) => {
    const s = charts[Number(el.dataset.chart)];
    if (!s || !s.values.length) return;
    const v = s.values, n = v.length;
    let lo = Math.min(...v), hi = Math.max(...v);
    if (hi === lo) { lo -= Math.abs(lo) * 0.01 || 1; hi += Math.abs(hi) * 0.01 || 1; }
    const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (val) => PAD + (1 - (val - lo) / (hi - lo)) * (H - 2 * PAD);

    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    const pts = v.map((val, i) => `${x(i).toFixed(2)},${y(val).toFixed(2)}`);
    const base = document.createElementNS(SVG, "line");
    base.setAttribute("class", "grid");
    base.setAttribute("x1", 0); base.setAttribute("x2", W);
    base.setAttribute("y1", H - 0.5); base.setAttribute("y2", H - 0.5);
    const area = document.createElementNS(SVG, "path");
    area.setAttribute("class", "area");
    area.setAttribute("d", `M${pts[0]} L${pts.join(" L")} L${x(n - 1)},${H} L${x(0)},${H} Z`);
    const line = document.createElementNS(SVG, "path");
    line.setAttribute("class", "line");
    line.setAttribute("d", `M${pts.join(" L")}`);
    svg.append(base, area, line);

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
      tip.innerHTML = "";
      const b = document.createElement("b");
      b.textContent = `${s.labels[i]} грн`;
      tip.append(`${s.dates[i]} · `, b);
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
  });
})();
