// Оформление экрана входа. Только внешний вид: логика входа и регистрации — в auth.js.

// Кнопка-глаз «показать пароль»
document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  const input = document.getElementById(button.dataset.togglePassword);
  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
  });
});

// После отправки формы пароль снова скрываем
$("authForm").addEventListener("submit", hidePasswords);
$("resetForm").addEventListener("submit", hidePasswords);
function hidePasswords() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    document.getElementById(button.dataset.togglePassword).type = "password";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Показать пароль");
  });
}

// Подсказка в поле пароля зависит от режима (вход / регистрация)
new MutationObserver(() => {
  $("authPassword").placeholder = $("registerOnly").hidden ? "Твой пароль" : "Минимум 8 символов";
}).observe($("registerOnly"), { attributes: true, attributeFilter: ["hidden"] });

// Плашка сообщения: красная для ошибок, нейтральная для подсказок и статусов.
// auth.js пишет только текст, поэтому тип узнаём по известным информационным сообщениям.
const AUTH_INFO = [/^Подождите/, /^Отправляю/, /^Письмо отправлено/, /^Если такой адрес/, /^Придумайте/, /^Пароль изменён/];
function markAuthMessage() {
  const box = $("authMessage");
  const text = box.textContent.trim();
  box.dataset.kind = !text ? "" : AUTH_INFO.some((re) => re.test(text)) ? "info" : "error";
}
new MutationObserver(markAuthMessage).observe($("authMessage"), { childList: true, characterData: true, subtree: true });
markAuthMessage();
