// Если страница открыта через порт 5500, ходим на локальный бэкенд; иначе на тот же адрес.
const API_URL = window.location.port === "5500" ? "http://127.0.0.1:8000" : "";
const MAX_CHARS = 15000;

const $ = (id) => document.getElementById(id);

// Достаёт понятный текст ошибки из ответа сервера.
// Сервер присылает код: {"detail": "file_too_large", "params": {"max_mb": 10}} — текст берём из словаря (errors.*).
async function readError(response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return errorText(data.detail, data.params);
  } catch (e) {
    return text;
  }
}

function errorText(detail, params) {
  if (typeof detail === "string") {
    return hasT("errors." + detail) ? t("errors." + detail, params || {}) : detail;
  }
  if (Array.isArray(detail)) return t("errors.validation_error"); // ошибка проверки полей FastAPI
  return JSON.stringify(detail);
}

// Пояснения сервера (note, warning): {code, params} или список таких — в текст на текущем языке
function noteText(note) {
  if (!note) return "";
  if (typeof note === "string") return note;
  const list = Array.isArray(note) ? note : [note];
  return list
    .map((n) => (n && n.code ? t("notes." + n.code, n.params || {}) : ""))
    .filter(Boolean)
    .join(" ");
}

// ===== Вход и запросы к нашему серверу =====
let sb = null; // клиент Supabase, создаётся в auth.js
let resolveAuthReady;
const authReady = new Promise((resolve) => (resolveAuthReady = resolve));
const loginHooks = []; // функции, которые нужно вызвать после входа (загрузить списки и т.п.)

// fetch к нашему бэкенду с токеном пользователя. Использовать для всех запросов к API.
async function apiFetch(path, options = {}) {
  await authReady;
  const headers = new Headers(options.headers || {});
  if (sb) {
    const { data } = await sb.auth.getSession(); // при необходимости сам обновит токен
    if (data.session) headers.set("Authorization", "Bearer " + data.session.access_token);
  }
  const response = await fetch(API_URL + path, { ...options, headers });
  if (response.status === 401 && typeof showAuth === "function") {
    showAuth("auth.sessionExpired");
  }
  return response;
}

// POST/DELETE с JSON-телом: короткая запись для частого случая
function apiJson(path, method, body) {
  return apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Дата из базы в виде «12.11.2026, 14:05» (формат — по языку интерфейса)
function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString(getLocale(), { dateStyle: "short", timeStyle: "short" });
}

// Строка списка: заголовок, подпись и кнопки. Весь текст через textContent (данные из базы недоверенные).
function listItem(title, subtitle, buttons) {
  const item = document.createElement("div");
  item.className = "list-item";
  const text = document.createElement("div");
  text.className = "list-text";
  const t = document.createElement("div");
  t.className = "list-title";
  t.textContent = title;
  const sub = document.createElement("div");
  sub.className = "hint";
  sub.style.marginTop = "2px";
  sub.textContent = subtitle;
  text.append(t, sub);
  const actions = document.createElement("div");
  actions.className = "list-actions";
  buttons.forEach(([label, onClick, className]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (className) b.className = className;
    b.addEventListener("click", () => onClick(b));
    actions.appendChild(b);
  });
  item.append(text, actions);
  return item;
}
