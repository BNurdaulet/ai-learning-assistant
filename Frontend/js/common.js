// Если страница открыта через порт 5500, ходим на локальный бэкенд; иначе на тот же адрес.
const API_URL = window.location.port === "5500" ? "http://127.0.0.1:8000" : "";
const MAX_CHARS = 15000;

const $ = (id) => document.getElementById(id);

// Достаёт понятный текст ошибки из ответа сервера
async function readError(response) {
  const text = await response.text();
  try {
    const detail = JSON.parse(text).detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  } catch (e) {
    return text;
  }
}
