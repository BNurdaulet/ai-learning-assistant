document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = true));
    tab.classList.add("active");
    $(tab.dataset.panel).hidden = false;
  });
});
