// Таймер Помодоро: работа → короткий перерыв → … → после каждой 4-й работы длинный перерыв.
//
// Две части:
// 1. Ядро (PomodoroCore) — чистые функции без DOM: переходы фаз, восстановление, проверка настроек.
//    Его же грузят тесты: node --test tests/pomodoro.test.js
// 2. Интерфейс — только в браузере. Работает и на главной (index.html), и на странице ученика.
//
// Точность: секунды НЕ считаются прибавлением в setInterval. Храним момент окончания фазы (endAt,
// по Date.now) и каждый раз заново считаем остаток — так фоновая вкладка и уснувший телефон
// показывают правильное время.
//
// Разметка (любой элемент с атрибутом обновится сам, см. render):
//   data-pomo-time, data-pomo-mode, data-pomo-ring, data-pomo-count, data-pomo-round, data-pomo-note,
//   data-pomo-live (aria-live), data-pomo-action="toggle|reset|skip|start-work", data-pomo-open.
// События на document: "pomodoro:phase" {mode, from, reason}, "pomodoro:completed" {mode, at, minutes}.
(function (root) {
  "use strict";

  // ===================== 1. Ядро =====================
  const MODES = ["work", "short", "long"];
  const LONG_EVERY = 4;        // длинный перерыв после каждой 4-й завершённой работы
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 120;
  const MINUTE = 60000;
  const DEFAULTS = Object.freeze({
    work: 25, short: 5, long: 15,
    autoStart: false, sound: true, notify: false, fullscreen: true,
  });
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Целое число в [min, max]; мусор (строка, NaN, объект) — значение по умолчанию
  function clampInt(value, min, max, fallback) {
    let n = NaN;
    if (typeof value === "number") n = value;
    else if (typeof value === "string" && value.trim() !== "") n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function bool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  // Настройки из localStorage — недоверенные: всё проверяем и обрезаем
  function sanitizeSettings(raw) {
    const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      work: clampInt(s.work, MIN_MINUTES, MAX_MINUTES, DEFAULTS.work),
      short: clampInt(s.short, MIN_MINUTES, MAX_MINUTES, DEFAULTS.short),
      long: clampInt(s.long, MIN_MINUTES, MAX_MINUTES, DEFAULTS.long),
      autoStart: bool(s.autoStart, DEFAULTS.autoStart),
      sound: bool(s.sound, DEFAULTS.sound),
      notify: bool(s.notify, DEFAULTS.notify),
      fullscreen: bool(s.fullscreen, DEFAULTS.fullscreen),
    };
  }

  function phaseMs(mode, settings) {
    return settings[mode] * MINUTE;
  }

  // Местная дата «ГГГГ-ММ-ДД» (счётчик «сегодня» сбрасывается в местную полночь)
  function localDay(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function freshState(settings, now) {
    const ms = phaseMs("work", settings);
    return rollDay({
      mode: "work", running: false, endAt: null, remainingMs: ms, durationMs: ms, cycle: 0,
      today: { date: "", count: 0 },
    }, now);
  }

  // Новый день — счётчик завершённых работ обнуляется
  function rollDay(state, now) {
    const day = localDay(now);
    if (state.today.date === day) return state;
    return { ...state, today: { date: day, count: 0 } };
  }

  // Состояние из localStorage: проверяем каждое поле, иначе начинаем заново
  function sanitizeState(raw, settings, now) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return freshState(settings, now);
    const mode = MODES.includes(raw.mode) ? raw.mode : "work";
    const durationMs = clampInt(raw.durationMs, MINUTE, MAX_MINUTES * MINUTE, phaseMs(mode, settings));
    const cycle = clampInt(raw.cycle, 0, LONG_EVERY - 1, 0);
    let running = raw.running === true;
    let endAt = null;
    let remainingMs = durationMs;
    if (running) {
      if (typeof raw.endAt === "number" && Number.isFinite(raw.endAt)) {
        // Конец фазы не может быть дальше, чем вся её длина (подмена или перевод часов назад)
        endAt = Math.min(raw.endAt, now + durationMs);
      } else {
        running = false;
      }
    } else {
      const left = clampInt(raw.remainingMs, 0, durationMs, durationMs);
      remainingMs = left > 0 ? left : durationMs;
    }
    const t = raw.today && typeof raw.today === "object" ? raw.today : {};
    const today = {
      date: typeof t.date === "string" && DAY_RE.test(t.date) ? t.date : "",
      count: clampInt(t.count, 0, 999, 0),
    };
    return rollDay({ mode, running, endAt, remainingMs, durationMs, cycle, today }, now);
  }

  function remaining(state, now) {
    return state.running ? Math.max(0, state.endAt - now) : state.remainingMs;
  }

  // Какая фаза следующая. completed = фаза дошла до конца (а не пропущена)
  function nextAfter(state, completed) {
    if (state.mode !== "work") return { mode: "work", cycle: state.cycle };
    if (!completed) return { mode: "short", cycle: state.cycle }; // пропущенная работа не считается
    const cycle = state.cycle + 1;
    return cycle >= LONG_EVERY ? { mode: "long", cycle: 0 } : { mode: "short", cycle };
  }

  function enterPhase(state, mode, cycle, settings, startAt, run) {
    const ms = phaseMs(mode, settings);
    return { ...state, mode, cycle, durationMs: ms, remainingMs: ms, running: run, endAt: run ? startAt + ms : null };
  }

  // +1 завершённая работа в день её окончания
  function countWork(today, at) {
    const day = localDay(at);
    if (today.date === day) return { date: day, count: Math.min(999, today.count + 1) };
    if (!today.date || day > today.date) return { date: day, count: 1 };
    return today; // закончилась «вчера», а счётчик уже за сегодня
  }

  // Главный шаг: если фаза закончилась — завершаем её (ОДНУ) и переходим к следующей.
  // Следующая запускается сама, только если включён автозапуск И она ещё не успела бы закончиться
  // (страница была закрыта дольше) — так таймер не «прокручивает» фазы без человека.
  // Возвращает {state, ended: null | {mode, at, minutes}}
  function tick(state, settings, now) {
    if (!state.running || state.endAt > now) return { state: rollDay(state, now), ended: null };
    const at = state.endAt;
    const ended = { mode: state.mode, at, minutes: clampInt(state.durationMs / MINUTE, 1, MAX_MINUTES, 1) };
    let s = state.mode === "work" ? { ...state, today: countWork(state.today, at) } : state;
    const next = nextAfter(s, true);
    const chain = settings.autoStart && at + phaseMs(next.mode, settings) > now;
    s = enterPhase(s, next.mode, next.cycle, settings, at, chain);
    return { state: rollDay(s, now), ended };
  }

  function start(state, now) {
    if (state.running) return state;
    return { ...state, running: true, endAt: now + state.remainingMs };
  }

  function pause(state, now) {
    if (!state.running) return state;
    const left = Math.max(0, state.endAt - now);
    return { ...state, running: false, endAt: null, remainingMs: left > 0 ? left : state.durationMs };
  }

  // Сброс текущей фазы к полной длине (по текущим настройкам)
  function reset(state, settings) {
    const ms = phaseMs(state.mode, settings);
    return { ...state, running: false, endAt: null, durationMs: ms, remainingMs: ms };
  }

  // Пропуск: к следующей фазе без засчитывания. Шёл таймер или включён автозапуск — следующая идёт сразу
  function skip(state, settings, now) {
    const next = nextAfter(state, false);
    return enterPhase(state, next.mode, next.cycle, settings, now, state.running || settings.autoStart);
  }

  // Новые настройки: длину нетронутой фазы меняем сразу, начатой — со следующей фазы
  function applySettings(state, settings) {
    if (state.running || state.remainingMs !== state.durationMs) return state;
    const ms = phaseMs(state.mode, settings);
    return { ...state, durationMs: ms, remainingMs: ms };
  }

  // «Начать фокус-сессию»: работа с начала (если сейчас не идёт работа) и сразу запуск
  function startWork(state, settings, now) {
    if (state.mode === "work") return start(state, now);
    return enterPhase(state, "work", state.cycle, settings, now, true);
  }

  function formatTime(ms) {
    const total = Math.ceil(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  // Стабильный id завершённой сессии (по моменту окончания): повторная отправка и вторая вкладка
  // не посчитают одну сессию дважды. Формат UUID, чтобы база приняла его как uuid.
  function sessionId(at) {
    const hex = Math.max(0, Math.floor(at)).toString(16).padStart(12, "0").slice(-12);
    return "00000000-0000-4000-8000-" + hex;
  }

  const core = {
    MODES, LONG_EVERY, MIN_MINUTES, MAX_MINUTES, MINUTE, DEFAULTS,
    clampInt, sanitizeSettings, sanitizeState, freshState, rollDay, localDay, remaining,
    nextAfter, tick, start, pause, reset, skip, applySettings, startWork, formatTime, sessionId,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = core;
    return;
  }
  root.PomodoroCore = core;
  if (typeof document === "undefined") return;

  // ===================== 2. Интерфейс =====================
  const SETTINGS_KEY = "pomodoro.settings";
  const STATE_KEY = "pomodoro.state";
  const NAV_TITLES = { work: "pomo.mode.work", short: "pomo.mode.short", long: "pomo.mode.long" };

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null; // приватный режим, запрещённые данные сайта или испорченный JSON
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // не сохранилось — таймер всё равно работает до перезагрузки
    }
  }

  let settings = sanitizeSettings(readJson(SETTINGS_KEY));
  let state = sanitizeState(readJson(STATE_KEY), settings, Date.now());
  let timer = null;
  let baseTitle = null;   // заголовок вкладки до того, как таймер начал его менять
  let lastTitle = null;   // что поставили мы (чтобы заметить, если заголовок сменил кто-то другой)
  let audioCtx = null;
  let lastAlertAt = 0;

  const tr = (key, params) => (typeof window.t === "function" ? window.t(key, params) : key);
  const save = () => writeJson(STATE_KEY, state);
  const all = (sel) => document.querySelectorAll(sel);

  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ----- Звук (Web Audio, без файлов), уведомление, вибрация -----
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    } catch (e) {
      audioCtx = null;
    }
  }

  function chime() {
    unlockAudio();
    if (!audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + 0.02;
      [[784, 0], [988, 0.22], [1175, 0.44]].forEach(([freq, offset]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.35);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.4);
      });
    } catch (e) {
      // звук не обязателен
    }
  }

  function notificationsSupported() {
    return "Notification" in window;
  }

  function alertUser(ended) {
    const now = Date.now();
    if (now - lastAlertAt < 3000) return; // никогда не «очередь» сигналов
    lastAlertAt = now;
    if (settings.sound) {
      chime();
      try {
        if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
      } catch (e) { /* нет вибрации */ }
    }
    if (settings.notify && notificationsSupported() && Notification.permission === "granted"
        && (document.hidden || !document.hasFocus())) {
      try {
        new Notification(tr("pomo.ended." + ended.mode), {
          body: tr("pomo.next", { mode: tr(NAV_TITLES[state.mode]), minutes: settings[state.mode] }),
          tag: "pomodoro",
          silent: true,
        });
      } catch (e) {
        // Например, Chrome на Android: уведомления только через service worker — молча пропускаем
      }
    }
  }

  // ----- Объявления для экранного диктора (только смена фазы, не каждую секунду) -----
  function announce(text) {
    // Пока открыто модальное окно, всё вне его «инертно» — пишем в регион внутри окна
    const dialogs = [...all("dialog[open]")];
    const top = dialogs.length ? dialogs[dialogs.length - 1].querySelector("[data-pomo-live]") : null;
    const region = top || document.querySelector("body > [data-pomo-live]");
    if (!region) return;
    region.textContent = "";
    setTimeout(() => (region.textContent = text), 50);
  }

  function setNote(key, params) {
    all("[data-pomo-note]").forEach((el) => {
      if (key && typeof window.setText === "function") window.setText(el, key, params);
      else el.textContent = "";
      el.hidden = !key;
    });
  }

  // ----- Отрисовка -----
  // Ключ перевода (обновится сам при смене языка). Тот же ключ и параметры — не трогаем DOM
  function setKey(el, key, params) {
    const args = params ? JSON.stringify(params) : undefined;
    if (el.dataset.i18n === key && el.dataset.i18nArgs === args) return;
    if (typeof window.setText === "function") window.setText(el, key, params);
    else el.textContent = key;
  }

  function renderTitle(left) {
    if (state.running) {
      if (document.title !== lastTitle) baseTitle = document.title;
      lastTitle = formatTime(left) + " · " + tr(NAV_TITLES[state.mode]) + " — " + baseTitle;
      document.title = lastTitle;
    } else if (lastTitle !== null) {
      if (document.title === lastTitle) document.title = baseTitle;
      lastTitle = null;
    }
  }

  function render() {
    const now = Date.now();
    const left = remaining(state, now);
    const time = formatTime(left);
    const progress = state.durationMs ? Math.min(1, Math.max(0, left / state.durationMs)) : 0;
    const active = state.running || state.remainingMs !== state.durationMs;
    const modeName = tr(NAV_TITLES[state.mode]);

    const body = document.body;
    body.dataset.pomoPhase = state.mode; // не data-pomo-mode: в такие элементы пишется название фазы
    body.dataset.pomoRunning = String(state.running);
    body.dataset.pomoActive = String(active);

    all("[data-pomo-time]").forEach((el) => {
      if (el.textContent !== time) el.textContent = time;
    });
    all("[data-pomo-mode]").forEach((el) => setKey(el, NAV_TITLES[state.mode]));
    all("[data-pomo-ring]").forEach((el) => {
      el.style.strokeDashoffset = String(100 - progress * 100);
    });
    all("[data-pomo-count]").forEach((el) => setKey(el, "pomo.today", { count: state.today.count }));
    all("[data-pomo-round]").forEach((el) => {
      el.hidden = state.mode !== "work";
      if (!el.hidden) setKey(el, "pomo.round", { n: state.cycle + 1, total: LONG_EVERY });
    });
    const toggleKey = state.running ? "pomo.pause" : active ? "pomo.resume" : "pomo.start";
    all('[data-pomo-action="toggle"]').forEach((el) => {
      // Кнопка с текстом (.pomo-toggle-text) — меняем текст; кнопка-иконка — подпись aria-label
      const text = el.querySelector(".pomo-toggle-text");
      if (text) setKey(text, toggleKey);
      else if (typeof window.setI18n === "function") window.setI18n(el, "aria", toggleKey);
      el.classList.toggle("is-running", state.running);
    });
    all("[data-pomo-open]").forEach((el) => {
      const label = active
        ? tr("pomo.openActive", { time, mode: modeName })
        : tr("pomo.open");
      el.setAttribute("aria-label", label);
      el.title = label;
    });
    renderTitle(left);
  }

  // ----- Цикл: просыпаемся к следующей целой секунде, остаток всегда считаем от endAt -----
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!state.running) return;
    const left = remaining(state, Date.now());
    const delay = (left % 1000 || 1000) + 15;
    timer = setTimeout(update, delay);
  }

  // quiet = восстановление после закрытой страницы: без звука и уведомления
  function update(quiet) {
    const now = Date.now();
    const result = tick(state, settings, now);
    const changedDay = result.state.today !== state.today;
    state = result.state;
    if (result.ended) {
      save();
      const ended = result.ended;
      emit("pomodoro:completed", ended);
      const text = tr("pomo.ended." + ended.mode) + " " +
        tr("pomo.next", { mode: tr(NAV_TITLES[state.mode]), minutes: Math.round(state.durationMs / MINUTE) });
      announce(text);
      if (quiet === true) setNote("pomo.whileAway." + ended.mode);
      else alertUser(ended);
      emit("pomodoro:phase", { mode: state.mode, from: ended.mode, reason: "completed" });
    } else if (changedDay) {
      save();
    }
    render();
    schedule();
  }

  // ----- Действия -----
  function act(fn) {
    unlockAudio(); // клик пользователя — браузер разрешит звук позже
    update(); // фаза могла закончиться прямо сейчас — сначала завершаем её как обычно
    const prevMode = state.mode;
    state = fn(state, Date.now());
    setNote(null);
    save();
    if (state.mode !== prevMode) {
      announce(tr("pomo.nowMode", { mode: tr(NAV_TITLES[state.mode]) }));
      emit("pomodoro:phase", { mode: state.mode, from: prevMode, reason: "skipped" });
    }
    render();
    schedule();
    emit("pomodoro:change", { running: state.running, mode: state.mode });
  }

  const ACTIONS = {
    toggle: () => act((s, now) => (s.running ? pause(s, now) : start(s, now))),
    reset: () => act((s) => reset(s, settings)),
    skip: () => act((s, now) => skip(s, settings, now)),
    "start-work": () => act((s, now) => startWork(s, settings, now)),
  };

  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-pomo-action]");
    if (button && ACTIONS[button.dataset.pomoAction]) ACTIONS[button.dataset.pomoAction]();
    const opener = e.target.closest("[data-pomo-open]");
    if (opener) openDialog();
  });

  // ----- Окно таймера -----
  function dialog() {
    return document.getElementById("pomoDialog");
  }
  function openDialog() {
    const d = dialog();
    if (!d) return;
    syncForm();
    if (!d.open) d.showModal();
  }

  // ----- Настройки -----
  function form() {
    return document.getElementById("pomoSettings");
  }

  function syncForm() {
    const f = form();
    if (!f) return;
    ["work", "short", "long"].forEach((k) => {
      if (f.elements[k]) f.elements[k].value = settings[k];
    });
    ["autoStart", "sound", "fullscreen"].forEach((k) => {
      if (f.elements[k]) f.elements[k].checked = settings[k];
    });
    const notify = f.elements.notify;
    if (notify) {
      const supported = notificationsSupported();
      notify.disabled = !supported;
      notify.checked = supported && settings.notify && Notification.permission === "granted";
      if (!supported) setNotifyHint("pomo.notifyUnsupported");
      else if (Notification.permission === "denied") setNotifyHint("pomo.notifyDenied");
      else setNotifyHint(null);
    }
  }

  function setNotifyHint(key) {
    const el = document.getElementById("pomoNotifyHint");
    if (!el) return;
    el.hidden = !key;
    if (key) setKey(el, key);
  }

  function saveSettings(next) {
    settings = sanitizeSettings(next);
    writeJson(SETTINGS_KEY, settings);
    state = applySettings(state, settings);
    save();
    render();
    emit("pomodoro:settings", settings);
  }

  function bindForm() {
    const f = form();
    if (!f) return;
    f.addEventListener("submit", (e) => e.preventDefault());
    f.addEventListener("change", async (e) => {
      const input = e.target;
      const name = input.name;
      if (["work", "short", "long"].includes(name)) {
        const value = clampInt(input.value, MIN_MINUTES, MAX_MINUTES, settings[name]);
        input.value = value; // показать, что значение поправлено
        saveSettings({ ...settings, [name]: value });
      } else if (name === "notify") {
        if (!input.checked) {
          saveSettings({ ...settings, notify: false });
          return;
        }
        // Разрешение спрашиваем ТОЛЬКО по явному действию пользователя (этот клик)
        let permission = "denied";
        try {
          permission = await Notification.requestPermission();
        } catch (err) {
          permission = "denied";
        }
        input.checked = permission === "granted";
        saveSettings({ ...settings, notify: permission === "granted" });
        setNotifyHint(permission === "granted" ? null : "pomo.notifyDenied");
      } else if (name in DEFAULTS) {
        saveSettings({ ...settings, [name]: input.checked });
      }
    });
  }

  // Закрытие окна крестиком и кликом по фону (на главной это же делает home-ui.js — повтор безвреден)
  function bindDialog() {
    const d = dialog();
    if (!d) return;
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    });
    d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
  }

  // Другая вкладка изменила таймер — берём её состояние (без повторных сигналов)
  window.addEventListener("storage", (e) => {
    if (e.key === STATE_KEY) state = sanitizeState(readJson(STATE_KEY), settings, Date.now());
    else if (e.key === SETTINGS_KEY) settings = sanitizeSettings(readJson(SETTINGS_KEY));
    else return;
    render();
    schedule();
  });

  // Вернулись на вкладку / телефон проснулся — сразу пересчитываем
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) update();
  });
  window.addEventListener("pageshow", () => update());
  document.addEventListener("langchange", () => render());

  function init() {
    bindForm();
    bindDialog();
    update(true); // фаза могла закончиться, пока страница была закрыта
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  root.Pomodoro = {
    getState: () => ({ ...state, remainingMs: remaining(state, Date.now()) }),
    getSettings: () => ({ ...settings }),
    startWork: ACTIONS["start-work"],
    skip: ACTIONS.skip,
    toggle: ACTIONS.toggle,
    announce,
    openDialog,
  };
})(typeof window !== "undefined" ? window : globalThis);
