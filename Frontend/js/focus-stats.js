// Статистика фокуса: завершённые рабочие сессии таймера сохраняются в аккаунт (Supabase, через наш сервер),
// во вкладке «История» — график минут фокуса за последние 7 дней.
//
// Считаются только работы, дошедшие до конца (пропуск не считается). У каждой сессии стабильный id
// (по моменту окончания), поэтому повторная отправка и вторая вкладка не посчитают её дважды.
// Нет связи — сессия ждёт в очереди в localStorage (до 3 дней, потом сервер её уже не примет).
(function () {
  "use strict";
  const QUEUE_KEY = "focus.pending";
  const MAX_QUEUE = 100;
  const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const core = window.PomodoroCore;

  let flushing = false;
  let lastStats = null;

  const userId = () => (typeof currentUserId !== "undefined" ? currentUserId : null);

  // ----- Очередь (данные из localStorage недоверенные — проверяем каждую запись) -----
  function readQueue() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    } catch (e) {
      raw = [];
    }
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw.filter((x) =>
      x && typeof x === "object" &&
      typeof x.id === "string" && UUID_RE.test(x.id) &&
      typeof x.user === "string" && x.user.length <= 64 &&
      typeof x.day === "string" && DAY_RE.test(x.day) &&
      Number.isInteger(x.minutes) && x.minutes >= 1 && x.minutes <= core.MAX_MINUTES &&
      typeof x.at === "number" && now - x.at < MAX_AGE_MS && x.at <= now + 60000,
    ).slice(-MAX_QUEUE);
  }

  function writeQueue(items) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE)));
    } catch (e) {
      // не сохранилось — отправим, пока страница открыта
    }
  }

  // Сессия, закончившаяся, пока страница была закрыта, обнаруживается при загрузке — ещё до входа.
  // Такие ждут в памяти и записываются на пользователя, когда он войдёт.
  let beforeLogin = [];

  function enqueue(done, user) {
    const item = {
      id: core.sessionId(done.at), user, day: core.localDay(done.at),
      minutes: core.clampInt(done.minutes, 1, core.MAX_MINUTES, 1), at: done.at,
    };
    const queue = readQueue().filter((x) => x.id !== item.id);
    queue.push(item);
    writeQueue(queue);
  }

  document.addEventListener("pomodoro:completed", (e) => {
    const done = e.detail;
    if (!done || done.mode !== "work" || typeof done.at !== "number") return;
    const user = userId();
    if (!user) {
      beforeLogin.push(done);
      return;
    }
    enqueue(done, user);
    flush();
  });

  // Отправляет очередь текущего пользователя. Ошибка сети или сервера — оставляем на потом.
  async function flush() {
    const user = userId();
    if (flushing || !user) return;
    flushing = true;
    let sent = 0;
    try {
      for (const item of readQueue().filter((x) => x.user === user)) {
        let response;
        try {
          response = await apiJson("/focus", "POST", { client_id: item.id, day: item.day, minutes: item.minutes });
        } catch (err) {
          break; // нет связи
        }
        if (response.status >= 500 || response.status === 401 || response.status === 429) break;
        // 2xx — сохранено; другие 4xx (неверные данные, лимит за день) — повтор не поможет
        writeQueue(readQueue().filter((x) => x.id !== item.id));
        if (response.ok) sent++;
      }
    } finally {
      flushing = false;
    }
    if (sent && !$("historyPanel").hidden) loadStats();
  }

  // ----- График за неделю -----
  const box = $("focusStats");

  async function loadStats() {
    if (!userId()) return;
    const msg = $("focusStatsMessage");
    try {
      const response = await apiFetch("/focus/stats?today=" + encodeURIComponent(core.localDay(Date.now())));
      if (!response.ok) {
        msg.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
        return;
      }
      lastStats = await response.json();
      msg.textContent = "";
      renderStats();
    } catch (error) {
      msg.textContent = t("common.noServer", { message: error.message });
    }
  }

  // Ответ сервера тоже проверяем: ровно то, что умеем показать
  function cleanDays(data) {
    if (!data || !Array.isArray(data.days)) return [];
    return data.days
      .filter((d) => d && typeof d.day === "string" && DAY_RE.test(d.day))
      .slice(-7)
      .map((d) => ({
        day: d.day,
        minutes: core.clampInt(d.minutes, 0, 24 * 60, 0),
        sessions: core.clampInt(d.sessions, 0, 1000, 0),
      }));
  }

  function dayDate(day) {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function renderStats() {
    const days = cleanDays(lastStats);
    const chart = $("focusChart");
    const table = $("focusTable");
    chart.textContent = "";
    table.textContent = "";
    const totalMin = days.reduce((a, d) => a + d.minutes, 0);
    const totalSessions = days.reduce((a, d) => a + d.sessions, 0);
    setText($("focusTotal"), "focus.stats.total", { minutes: totalMin });
    setText($("focusSessions"), "focus.stats.sessions", { count: totalSessions });
    $("focusEmpty").hidden = totalMin > 0;
    chart.hidden = totalMin === 0;
    $("focusTableBox").hidden = totalMin === 0;
    if (!totalMin) return;

    const max = Math.max(...days.map((d) => d.minutes));
    const today = core.localDay(Date.now());
    const weekday = new Intl.DateTimeFormat(getLocale(), { weekday: "short" });
    const full = new Intl.DateTimeFormat(getLocale(), { weekday: "long", day: "numeric", month: "long" });

    days.forEach((d) => {
      const date = dayDate(d.day);
      const label = t("focus.stats.bar", { date: full.format(date), minutes: d.minutes, count: d.sessions });

      const col = document.createElement("div");
      col.className = "fs-col" + (d.day === today ? " is-today" : "");
      col.tabIndex = 0;
      col.setAttribute("role", "img");
      col.setAttribute("aria-label", label);
      col.dataset.tip = label;

      const plot = document.createElement("div");
      plot.className = "fs-plot";
      // Подпись значения — только у максимума и у сегодняшнего дня (остальное — в подсказке и таблице)
      if (d.minutes && (d.minutes === max || d.day === today)) {
        const value = document.createElement("span");
        value.className = "fs-value";
        value.textContent = t("focus.stats.min", { minutes: d.minutes });
        plot.appendChild(value);
      }
      const bar = document.createElement("div");
      bar.className = "fs-bar";
      bar.style.height = d.minutes ? Math.max(2, (d.minutes / max) * 100) + "%" : "0";
      plot.appendChild(bar);

      const name = document.createElement("span");
      name.className = "fs-day";
      name.textContent = weekday.format(date);
      col.append(plot, name);
      chart.appendChild(col);

      const row = table.insertRow();
      row.insertCell().textContent = full.format(date);
      row.insertCell().textContent = String(d.minutes);
      row.insertCell().textContent = String(d.sessions);
    });
  }

  // Подсказка при наведении и фокусе клавиатурой (то же, что в aria-label и таблице)
  const tip = $("focusStatsTip");
  function showTip(col) {
    tip.textContent = col.dataset.tip;
    tip.hidden = false;
    const c = col.getBoundingClientRect();
    const host = box.getBoundingClientRect();
    const left = Math.min(Math.max(0, c.left - host.left + c.width / 2 - tip.offsetWidth / 2), host.width - tip.offsetWidth);
    tip.style.left = left + "px";
    tip.style.top = (c.top - host.top - tip.offsetHeight - 6) + "px";
  }
  function hideTip() {
    tip.hidden = true;
  }
  $("focusChart").addEventListener("pointerover", (e) => {
    const col = e.target.closest(".fs-col");
    if (col) showTip(col);
  });
  $("focusChart").addEventListener("pointerleave", hideTip);
  $("focusChart").addEventListener("focusin", (e) => {
    const col = e.target.closest(".fs-col");
    if (col) showTip(col);
  });
  $("focusChart").addEventListener("focusout", hideTip);

  document.addEventListener("langchange", () => {
    if (lastStats) renderStats();
  });
  window.addEventListener("online", flush);

  loginHooks.push(() => {
    beforeLogin.forEach((done) => enqueue(done, userId()));
    beforeLogin = [];
    flush();
    loadStats();
  });
  document.querySelector('.tab[data-panel="historyPanel"]').addEventListener("click", loadStats);
})();
