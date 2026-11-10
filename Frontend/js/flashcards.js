// Карточки: одна карточка за раз, клик переворачивает, кнопки Назад / Вперёд / Перемешать.
// Каждый набор — отдельный просмотрщик, поэтому в ленте чата их может быть несколько.
const fcBtn = $("fcBtn");
const fcMessage = $("fcMessage");

// Создаёт карточки по полям «Тема» и «Количество карточек» и выводит их в container.
// statusEl — куда писать статус и ошибки, button — кнопка, которую блокируем (может быть null).
// Возвращает ответ сервера или null.
async function runFlashcards(statusEl, container, button) {
  const topic = $("topic").value.trim();
  const materialText = material.value.trim();
  const count = Math.max(1, Math.min(30, Number($("fcCount").value) || 10));

  if (!activeDoc && !topic && !materialText) {
    statusEl.textContent = t("common.needSource");
    return null;
  }
  const docError = docParamsError();
  if (docError) {
    statusEl.textContent = docError;
    return null;
  }

  if (button) button.disabled = true;
  const stopThinking = startThinking(statusEl);
  let result = null;

  try {
    const response = await apiFetch("/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, count, material: activeDoc ? "" : materialText, ...docParams(), lang: getLang() }),
    });
    if (!response.ok) {
      statusEl.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
    } else {
      const data = await response.json();
      statusEl.textContent = noteText(data.note);
      renderFlashcards(container, data.cards, { topic: topic || (activeDoc ? activeDoc.title : "") });
      result = data;
    }
  } catch (error) {
    statusEl.textContent = t("common.noServer", { message: error.message });
  } finally {
    stopThinking();
  }

  if (button) button.disabled = false;
  return result;
}

fcBtn.addEventListener("click", () => runFlashcards(fcMessage, $("fcViewer"), fcBtn));
