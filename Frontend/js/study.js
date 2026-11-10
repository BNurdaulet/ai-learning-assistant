// Конспект и план изучения: текст от ИИ в Markdown, кнопка «Скопировать».
const studyButtons = [$("studySummary"), $("studyPlan")];
const studyMessage = $("studyMessage");

// Рисует конспект или план в container: плашка, текст, кнопка «Скопировать» (копирует исходный Markdown).
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
  container.appendChild(box);
}

// Запрашивает конспект (kind = "summary") или план ("plan") по полю «Тема» и выводит его в container.
// statusEl — куда писать статус и ошибки, buttons — кнопки, которые блокируем на время запроса.
// Возвращает ответ сервера или null.
async function runStudy(kind, statusEl, container, buttons = []) {
  const topic = $("topic").value.trim();
  const materialText = material.value.trim();

  if (!activeDoc && !topic && !materialText) {
    statusEl.textContent = t("common.needSource");
    return null;
  }
  const docError = docParamsError();
  if (docError) {
    statusEl.textContent = docError;
    return null;
  }

  buttons.forEach((b) => (b.disabled = true));
  statusEl.textContent = kind === "summary" ? t("study.writingSummary") : t("study.writingPlan");
  if (activeDoc) statusEl.textContent += t("study.docSlow");
  let result = null;

  try {
    const response = await apiFetch("/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, topic, material: activeDoc ? "" : materialText, ...docParams(), lang: getLang() }),
    });
    if (!response.ok) {
      statusEl.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
    } else {
      const data = await response.json();
      statusEl.textContent = noteText(data.note);
      renderStudy(container, kind, data.text, { topic: topic || (activeDoc ? activeDoc.title : "") });
      result = data;
    }
  } catch (error) {
    statusEl.textContent = t("common.noServer", { message: error.message });
  }

  buttons.forEach((b) => (b.disabled = false));
  return result;
}

$("studySummary").addEventListener("click", () => runStudy("summary", studyMessage, $("studyResult"), studyButtons));
$("studyPlan").addEventListener("click", () => runStudy("plan", studyMessage, $("studyResult"), studyButtons));
