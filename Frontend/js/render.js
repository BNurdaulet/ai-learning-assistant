// Превращает Markdown и LaTeX-формулы в красивый HTML.
// inline = true: без абзацев и списков (для вопросов, вариантов и пояснений).
function renderRich(el, text, inline) {
  if (!window.marked || !window.DOMPurify || !window.katex) {
    el.textContent = text; // библиотеки не загрузились: показываем как есть
    return;
  }

  // Прячем формулы, чтобы Markdown их не испортил (например, символы _ и *)
  const maths = [];
  const stash = (tex, display) => {
    maths.push({ tex, display });
    return "MATHTOKEN" + (maths.length - 1) + "END";
  };

  const src = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => stash(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (m, t) => stash(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => stash(t, false))
    .replace(/\$(?!\s)([^$\n]*?[^\s$])\$(?!\d)/g, (m, t) => stash(t, false));

  const raw = inline ? marked.parseInline(src) : marked.parse(src, { breaks: true });
  let html = DOMPurify.sanitize(raw);

  // Возвращаем формулы, уже нарисованные
  html = html.replace(/MATHTOKEN(\d+)END/g, (m, i) => {
    const { tex, display } = maths[Number(i)];
    return katex.renderToString(tex, { displayMode: display, throwOnError: false });
  });

  el.innerHTML = html;
}
