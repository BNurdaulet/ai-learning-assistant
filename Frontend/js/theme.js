// Тема оформления: светлая или тёмная.
// Подключается в <head> БЕЗ defer, чтобы тема применилась до отрисовки (без вспышки белого).
// Выбор пользователя хранится в localStorage; если он не выбирал — берём системную тему.
(function () {
  const KEY = "theme";
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");

  function saved() {
    try {
      const value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (e) {
      return null; // приватный режим или запрещены данные сайта
    }
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    const key = theme === "dark" ? "theme.toLight" : "theme.toDark";
    // Словарь (i18n.js) может быть ещё не загружен — тогда русская подпись
    const ready = typeof window.t === "function" && window.t(key) !== key;
    const label = ready ? window.t(key) : theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.setAttribute("aria-label", label);
      button.title = label;
    });
  }

  apply(saved() || (system.matches ? "dark" : "light"));

  // Пока пользователь сам не выбрал тему, следуем за системой
  system.addEventListener("change", (e) => {
    if (!saved()) apply(e.matches ? "dark" : "light");
  });

  // Язык сменился (i18n.js) — обновляем подписи кнопок
  document.addEventListener("langchange", () => apply(root.getAttribute("data-theme")));

  document.addEventListener("DOMContentLoaded", () => {
    apply(root.getAttribute("data-theme"));
    // Кнопок темы может быть несколько (шапка, экран входа) — все с классом .theme-toggle
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(KEY, next);
        } catch (e) {
          // не сохранилось — тема всё равно переключится до перезагрузки
        }
        apply(next);
      });
    });
  });
})();
