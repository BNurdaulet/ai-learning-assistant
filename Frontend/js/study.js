// Конспект и план изучения: текст от ИИ в Markdown, кнопка «Скопировать».
const studyButtons = [$("studySummary"), $("studyPlan")];
const studyMessage = $("studyMessage");

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
  const stopThinking = startThinking(statusEl);
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
  } finally {
    stopThinking();
  }

  buttons.forEach((b) => (b.disabled = false));
  return result;
}

$("studySummary").addEventListener("click", () => runStudy("summary", studyMessage, $("studyResult"), studyButtons));
$("studyPlan").addEventListener("click", () => runStudy("plan", studyMessage, $("studyResult"), studyButtons));
