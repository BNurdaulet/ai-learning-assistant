// Отрисовка конспекта и плана. Общая для главной страницы и страницы задания ученика.

// Рисует конспект или план в container: плашка, текст, кнопка «Скопировать» (копирует исходный Markdown).
// meta.footer — необязательный элемент под текстом (на странице ученика — кнопка «Я прочитал(а)»).
function renderStudy(container, kind, text, meta = {}) {
  container.innerHTML = "";
  const box = document.createElement("div");
  box.className = "card study-card";

  const head = document.createElement("div");
  head.className = "tool-head";
  const tag = document.createElement("span");
  tag.className = "tool-tag";
  tag.textContent = (kind === "plan" ? t("tool.plan") : t("tool.summary")) + (meta.topic ? " · " + meta.topic : "");
  head.appendChild(tag);

  const body = document.createElement("div");
  body.className = "rich";
  renderRich(body, text, false);

  const row = document.createElement("div");
  row.className = "row no-print";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "btn-soft";
  copy.textContent = t("study.copy");
  const copied = document.createElement("span");
  copied.className = "hint";
  copied.style.marginTop = "0";
  row.append(copy, copied);

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Запасной способ, если clipboard API недоступен (например, не https)
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    copied.textContent = t("study.copied");
  });

  box.append(head, body, row);
  if (meta.footer) box.appendChild(meta.footer);
  container.appendChild(box);
}
