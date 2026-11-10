const btn = $("btn");
const message = $("message");
const quizBox = $("quiz");

// Создаёт квиз по полям «Тема», «Количество», «Сложность» и выводит его в container.
// statusEl — куда писать статус и ошибки, button — кнопка, которую блокируем на время запроса (может быть null).
// Возвращает ответ сервера или null, если квиз не получился.
async function runQuiz(statusEl, container, button) {
  const topic = $("topic").value.trim();
  const count = Number($("count").value);
  const difficulty = $("difficulty").value;
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

  if (button) button.disabled = true;
  statusEl.textContent = t("quiz.generating");
  container.innerHTML = "";
  let result = null;

  try {
    const response = await apiFetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, count, difficulty, material: activeDoc ? "" : materialText, ...docParams(), lang: getLang() }),
    });
    if (!response.ok) {
      statusEl.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
    } else {
      const data = await response.json();
      statusEl.textContent = quizSourceText(data);
      renderQuiz(container, data.questions, {
        assignment: $("assignment").checked,
        meta: { topic: topic || (activeDoc ? activeDoc.title : t("quiz.byMaterial")), difficulty },
      });
      result = data;
    }
  } catch (error) {
    statusEl.textContent = t("common.noServer", { message: error.message });
  }

  if (button) button.disabled = false;
  return result;
}

btn.addEventListener("click", () => runQuiz(message, quizBox, btn));

// Подпись под кнопкой: пояснение сервера и страницы, по которым составлены вопросы
function quizSourceText(data) {
  const parts = [];
  if (data.note) parts.push(noteText(data.note));
  if (data.sources && data.sources.length) parts.push(t("quiz.sources", { pages: formatSources(data.sources) }));
  return parts.join(" ");
}
