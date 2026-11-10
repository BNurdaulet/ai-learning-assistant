// Оформление экрана входа. Только внешний вид: логика входа и регистрации — в auth.js.

// Кнопка-глаз «показать пароль»
document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  const input = document.getElementById(button.dataset.togglePassword);
  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", String(show));
    setI18n(button, "aria", show ? "password.hide" : "password.show");
  });
});

// После отправки формы пароль снова скрываем
$("authForm").addEventListener("submit", hidePasswords);
$("resetForm").addEventListener("submit", hidePasswords);
function hidePasswords() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    document.getElementById(button.dataset.togglePassword).type = "password";
    button.setAttribute("aria-pressed", "false");
    setI18n(button, "aria", "password.show");
  });
}

// Подсказка в поле пароля зависит от режима (вход / регистрация)
new MutationObserver(() => {
  setI18n($("authPassword"), "placeholder", $("registerOnly").hidden ? "login.passwordPlaceholder" : "register.passwordPlaceholder");
}).observe($("registerOnly"), { attributes: true, attributeFilter: ["hidden"] });

// Плашка сообщения: красная для ошибок, нейтральная для подсказок и статусов.
// auth.js ставит сообщение по ключу словаря (data-i18n), поэтому тип узнаём по ключу.
const AUTH_INFO = ["auth.wait", "auth.sending", "auth.emailSent", "auth.resetSent", "auth.newPasswordPrompt", "auth.passwordChanged"];
function markAuthMessage() {
  const box = $("authMessage");
  const text = box.textContent.trim();
  box.dataset.kind = !text ? "" : AUTH_INFO.includes(box.dataset.i18n) ? "info" : "error";
}
new MutationObserver(markAuthMessage).observe($("authMessage"), { childList: true, characterData: true, subtree: true });
markAuthMessage();
