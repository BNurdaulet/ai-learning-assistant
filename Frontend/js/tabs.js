// Вкладки приложения (кнопки с data-panel). Кнопки «Вход/Регистрация» сюда не входят.
document.querySelectorAll(".tab[data-panel]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab[data-panel]").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = true));
    tab.classList.add("active");
    $(tab.dataset.panel).hidden = false;
  });
});
