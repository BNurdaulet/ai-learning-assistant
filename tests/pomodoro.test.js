// Тесты ядра таймера Помодоро (чистые функции, без браузера).
// Запуск из корня проекта:  node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../Frontend/js/pomodoro.js");

const MIN = P.MINUTE;
const S = P.sanitizeSettings({}); // 25 / 5 / 15, без автозапуска
const AUTO = P.sanitizeSettings({ autoStart: true });
const T0 = new Date(2026, 10, 11, 10, 0, 0).getTime(); // 11.11.2026 10:00 по местному времени

function finishPhase(state, settings) {
  const s = state.running ? state : P.start(state, state.endAt || T0);
  return P.tick(s, settings, s.endAt);
}

test("defaults and fresh state", () => {
  assert.deepEqual(
    { work: S.work, short: S.short, long: S.long, autoStart: S.autoStart, sound: S.sound },
    { work: 25, short: 5, long: 15, autoStart: false, sound: true },
  );
  const s = P.freshState(S, T0);
  assert.equal(s.mode, "work");
  assert.equal(s.remainingMs, 25 * MIN);
  assert.equal(s.running, false);
  assert.equal(s.today.date, "2026-11-11");
});

test("settings are clamped to 1..120 and junk falls back to defaults", () => {
  const s = P.sanitizeSettings({ work: 0, short: 999, long: "30", autoStart: "yes", sound: false, notify: 1 });
  assert.equal(s.work, 1);
  assert.equal(s.short, 120);
  assert.equal(s.long, 30);
  assert.equal(s.autoStart, false); // не boolean — по умолчанию
  assert.equal(s.sound, false);
  assert.equal(s.notify, false);
  for (const bad of [null, "x", [], 42, { work: NaN }, { work: Infinity }, { work: {} }, { work: "" }]) {
    assert.equal(P.sanitizeSettings(bad).work, 25);
  }
  assert.equal(P.sanitizeSettings({ work: 7.6 }).work, 8);
  assert.equal(P.sanitizeSettings({ work: -5 }).work, 1);
});

test("work → short break, start/pause keep the remaining time from timestamps", () => {
  let s = P.start(P.freshState(S, T0), T0);
  assert.equal(s.endAt, T0 + 25 * MIN);
  assert.equal(P.remaining(s, T0 + 10 * MIN), 15 * MIN);
  s = P.pause(s, T0 + 10 * MIN);
  assert.equal(s.running, false);
  assert.equal(s.remainingMs, 15 * MIN);
  // Пауза длится час — остаток не меняется
  assert.equal(P.remaining(s, T0 + 70 * MIN), 15 * MIN);
  s = P.start(s, T0 + 70 * MIN);
  assert.equal(s.endAt, T0 + 85 * MIN);
  const r = P.tick(s, S, T0 + 85 * MIN);
  assert.equal(r.ended.mode, "work");
  assert.equal(r.ended.minutes, 25);
  assert.equal(r.state.mode, "short");
  assert.equal(r.state.running, false); // без автозапуска перерыв ждёт нажатия
  assert.equal(r.state.today.count, 1);
});

test("tick before the end does nothing", () => {
  const s = P.start(P.freshState(S, T0), T0);
  const r = P.tick(s, S, T0 + 25 * MIN - 1);
  assert.equal(r.ended, null);
  assert.equal(r.state.mode, "work");
});

test("long break after every 4th completed work session", () => {
  let s = P.freshState(S, T0);
  const modes = [];
  for (let i = 0; i < 16; i++) {
    const r = finishPhase(s, S);
    s = r.state;
    modes.push(s.mode);
  }
  assert.deepEqual(modes, [
    "short", "work", "short", "work", "short", "work", "long", "work",
    "short", "work", "short", "work", "short", "work", "long", "work",
  ]);
  assert.equal(s.cycle, 0);
});

test("skipped work does not count and does not advance the cycle", () => {
  let s = P.freshState(S, T0);
  s = P.skip(s, S, T0);
  assert.equal(s.mode, "short");
  assert.equal(s.today.count, 0);
  assert.equal(s.cycle, 0);
  assert.equal(s.running, false); // таймер не шёл и автозапуск выключен
  s = P.skip(P.start(s, T0), S, T0 + MIN); // пропуск идущего перерыва — работа запускается сразу
  assert.equal(s.mode, "work");
  assert.equal(s.running, true);
  assert.equal(s.endAt, T0 + MIN + 25 * MIN);
});

test("auto-start chains phases from the exact end time", () => {
  const s = P.start(P.freshState(AUTO, T0), T0);
  const r = P.tick(s, AUTO, T0 + 25 * MIN + 2000); // вкладка проснулась через 2 с после конца
  assert.equal(r.state.mode, "short");
  assert.equal(r.state.running, true);
  assert.equal(r.state.endAt, T0 + 30 * MIN); // перерыв отсчитан от конца работы, а не от «сейчас»
});

test("restore: phase ended while the page was closed → exactly one transition, next phase waits", () => {
  const saved = JSON.parse(JSON.stringify(P.start(P.freshState(AUTO, T0), T0)));
  const now = T0 + 5 * 60 * MIN; // вернулись через 5 часов
  const restored = P.sanitizeState(saved, AUTO, now);
  const r = P.tick(restored, AUTO, now);
  assert.equal(r.ended.mode, "work"); // одно событие — один сигнал, без «очереди» звуков
  assert.equal(r.state.mode, "short");
  assert.equal(r.state.running, false); // перерыв не «прошёл» сам, пока никого не было
  assert.equal(r.state.today.count, 1);
  const again = P.tick(r.state, AUTO, now + 1000);
  assert.equal(again.ended, null);
});

test("restore: still running → keeps the original end timestamp", () => {
  const saved = JSON.parse(JSON.stringify(P.start(P.freshState(S, T0), T0)));
  const restored = P.sanitizeState(saved, S, T0 + 3 * MIN);
  assert.equal(restored.running, true);
  assert.equal(P.remaining(restored, T0 + 3 * MIN), 22 * MIN);
});

test("restore: untrusted state is validated and clamped", () => {
  const now = T0;
  assert.equal(P.sanitizeState(null, S, now).mode, "work");
  assert.equal(P.sanitizeState("garbage", S, now).mode, "work");
  const s = P.sanitizeState({
    mode: "party", running: true, endAt: now + 10 * 24 * 60 * MIN, durationMs: 1e12, cycle: 99,
    today: { date: "<img>", count: -4 },
  }, S, now);
  assert.equal(s.mode, "work");
  assert.equal(s.durationMs, 120 * MIN);
  assert.ok(s.endAt <= now + s.durationMs); // конец не дальше длины фазы
  assert.equal(s.cycle, 3);
  assert.equal(s.today.date, "2026-11-11");
  assert.equal(s.today.count, 0);
  const paused = P.sanitizeState({ mode: "short", running: false, remainingMs: -1, durationMs: 5 * MIN }, S, now);
  assert.equal(paused.remainingMs, 5 * MIN);
  const noEnd = P.sanitizeState({ mode: "work", running: true, endAt: "soon", durationMs: 25 * MIN }, S, now);
  assert.equal(noEnd.running, false);
});

test("today counter resets at local midnight", () => {
  let s = P.freshState(S, T0);
  s = finishPhase(s, S).state;
  assert.equal(s.today.count, 1);
  const tomorrow = new Date(2026, 10, 12, 0, 0, 1).getTime();
  s = P.rollDay(s, tomorrow);
  assert.deepEqual(s.today, { date: "2026-11-12", count: 0 });
});

test("work that ends after midnight counts for the new day", () => {
  const lateStart = new Date(2026, 10, 11, 23, 50).getTime();
  const s = P.start(P.freshState(S, lateStart), lateStart);
  const r = P.tick(s, S, s.endAt);
  assert.deepEqual(r.state.today, { date: "2026-11-12", count: 1 });
});

test("settings change applies to an untouched phase only", () => {
  const fresh = P.freshState(S, T0);
  const longer = P.sanitizeSettings({ work: 50 });
  assert.equal(P.applySettings(fresh, longer).remainingMs, 50 * MIN);
  const running = P.start(fresh, T0);
  assert.equal(P.applySettings(running, longer).endAt, T0 + 25 * MIN);
});

test("startWork from a break jumps to a running work phase", () => {
  let s = finishPhase(P.freshState(S, T0), S).state; // сейчас короткий перерыв
  s = P.startWork(s, S, T0 + 30 * MIN);
  assert.equal(s.mode, "work");
  assert.equal(s.running, true);
  assert.equal(s.cycle, 1);
});

test("formatTime and stable session id", () => {
  assert.equal(P.formatTime(25 * MIN), "25:00");
  assert.equal(P.formatTime(61000 - 1), "01:01"); // секунды округляются вверх: 60,999 с → 01:01
  assert.equal(P.formatTime(0), "00:00");
  assert.equal(P.formatTime(120 * MIN), "2:00:00");
  assert.equal(P.sessionId(T0), P.sessionId(T0));
  assert.match(P.sessionId(T0), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(P.sessionId(T0), P.sessionId(T0 + 1));
});
