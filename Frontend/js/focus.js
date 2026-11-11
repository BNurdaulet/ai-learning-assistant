// Режим фокуса: прячет шапку, навигацию, списки и карточки главной — остаётся текущее занятие
// (чат, квиз, карточки или конспект) и компактный таймер сверху.
// Честно: это скрывает части ТОЛЬКО этого сайта, другие сайты и приложения не блокируются.
//
// Дополнительно (если браузер умеет): полноэкранный режим и запрет гаснуть экрану (Wake Lock).
// Не умеет — молча работаем без них. Перерыв во время фокуса — спокойный экран с советом.
// Зависит от pomodoro.js (window.Pomodoro, события pomodoro:*) и home-ui.js (goTo).
(function () {
  "use strict";
  const ACTIVITY_PANELS = ["chatPanel", "quizPanel", "flashPanel", "studyPanel"];
  const TIPS = 6; // focus.tip.1 … focus.tip.6

  const bar = $("focusBar");
  const breakScreen = $("focusBreak");
  let active = false;
  let wakeLock = null;
  let lastTip = 0;

  function currentPanel() {
    const panel = document.querySelector(".panel:not([hidden])");
    return panel ? panel.id : "";
  }

  // ----- Полный экран и запрет гаснуть экрану: только где поддерживается -----
  function enterFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    try {
      el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    } catch (e) { /* не поддерживается */ }
  }

  function leaveFullscreen() {
    if (!document.fullscreenElement || !document.exitFullscreen) return;
    try {
      document.exitFullscreen().catch(() => {});
    } catch (e) { /* уже вышли */ }
  }

  async function lockScreen() {
    if (!active || wakeLock || document.hidden || !("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } catch (e) {
      wakeLock = null; // нет заряда, запрет политики и т.п.
    }
  }

  function unlockScreen() {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) lock.release().catch(() => {});
  }

  // ----- Вход и выход -----
  function enter() {
    if (!active) {
      active = true;
      // Разделы «Мои квизы», «История», «Задания» — не занятие: возвращаемся в чат
      if (!ACTIVITY_PANELS.includes(currentPanel()) && typeof goTo === "function") goTo("chatPanel");
      document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      document.querySelectorAll("details.menu[open]").forEach((d) => (d.open = false));
      document.body.classList.add("focus-mode");
      bar.hidden = false;
      if (Pomodoro.getSettings().fullscreen) enterFullscreen();
      lockScreen();
      Pomodoro.announce(t("focus.entered"));
    }
    syncBreak();
    if (!breakScreen.open) $("focusExit").focus();
  }

  function exit() {
    if (!active) return;
    active = false;
    document.body.classList.remove("focus-mode");
    bar.hidden = true;
    if (breakScreen.open) breakScreen.close();
    unlockScreen();
    leaveFullscreen();
    Pomodoro.announce(t("focus.exited"));
    const opener = document.querySelector(".app-header [data-pomo-open]");
    if (opener) opener.focus();
  }

  // ----- Экран перерыва -----
  function pickTip() {
    let n = 1 + Math.floor(Math.random() * TIPS);
    if (n === lastTip) n = (n % TIPS) + 1; // не повторять подряд
    lastTip = n;
    setText($("focusTip"), "focus.tip." + n);
  }

  function syncBreak() {
    const onBreak = Pomodoro.getState().mode !== "work";
    if (active && onBreak && !breakScreen.open) {
      pickTip();
      breakScreen.showModal();
      $("focusSkipBreak").focus();
    } else if ((!active || !onBreak) && breakScreen.open) {
      breakScreen.close();
      if (active) $("focusExit").focus();
    }
  }

  // Esc в окне перерыва — выйти из фокуса (как и Esc на странице)
  breakScreen.addEventListener("cancel", (e) => {
    e.preventDefault();
    exit();
  });

  document.addEventListener("pomodoro:phase", syncBreak);

  // ----- Кнопки -----
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-focus]");
    if (!button) return;
    const what = button.dataset.focus;
    if (what === "session") {
      Pomodoro.startWork(); // клик пользователя — можно и полный экран, и звук
      enter();
    } else if (what === "enter") {
      enter();
    } else if (what === "exit") {
      exit();
    }
  });

  // Esc выходит из фокуса. Если открыто окно или меню — Esc сначала закрывает его (как обычно)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !active || e.defaultPrevented) return;
    if (document.querySelector("dialog[open], details.menu[open]")) return;
    exit();
  });

  // Телефон проснулся / вернулись на вкладку — Wake Lock снят браузером, берём снова
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lockScreen();
  });

  // Выход из приложения (экран входа) — фокус тоже выключаем
  new MutationObserver(() => {
    if ($("app").hidden) exit();
  }).observe($("app"), { attributes: true, attributeFilter: ["hidden"] });

  window.Focus = { enter, exit, isActive: () => active };
})();
