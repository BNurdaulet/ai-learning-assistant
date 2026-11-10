// «Мои квизы»: список сохранённых квизов, открыть или удалить.
const libraryList = $("libraryList");
const libraryMessage = $("libraryMessage");

async function loadQuizList() {
  libraryMessage.textContent = t("common.loading");
  try {
    const response = await apiFetch("/quizzes");
    if (!response.ok) {
      libraryMessage.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      return;
    }
    const data = await response.json();
    libraryList.innerHTML = "";
    libraryMessage.textContent = data.quizzes.length ? "" : t("library.empty");
    data.quizzes.forEach((q) => {
      const subtitle = [difficultyLabel(q.difficulty), formatDate(q.created_at)].filter(Boolean).join(" · ");
      libraryList.appendChild(listItem(q.topic || t("common.noTopic"), subtitle, [
        [t("common.open"), (b) => openQuiz(q.id, b)],
        [t("common.delete"), (b) => deleteQuiz(q.id, q.topic, b), "danger"],
      ]));
    });
  } catch (error) {
    libraryMessage.textContent = t("common.noServer", { message: error.message });
  }
}

// Сложность хранится по-русски (значение из списка «Сложность») — показываем на языке интерфейса
const DIFFICULTY_KEYS = { "лёгкая": "difficulty.easy", "средняя": "difficulty.medium", "сложная": "difficulty.hard" };
function difficultyLabel(value) {
  return DIFFICULTY_KEYS[value] ? t(DIFFICULTY_KEYS[value]) : value;
}

async function openQuiz(id, button) {
  button.disabled = true;
  try {
    const response = await apiFetch("/quizzes/" + encodeURIComponent(id));
    if (!response.ok) {
      libraryMessage.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      return;
    }
    const quiz = await response.json();
    document.querySelector('.tab[data-panel="quizPanel"]').click();
    message.textContent = t("library.savedQuiz", { topic: quiz.topic || t("common.noTopicLower") });
    renderQuiz(quizBox, quiz.questions, {
      assignment: $("assignment").checked,
      meta: { topic: quiz.topic, difficulty: quiz.difficulty },
      quizId: quiz.id,
    });
  } catch (error) {
    libraryMessage.textContent = t("common.noServer", { message: error.message });
  } finally {
    button.disabled = false;
  }
}

async function deleteQuiz(id, topic, button) {
  if (!confirm(t("library.confirmDelete", { topic: topic || t("common.noTopicLower") }))) return;
  button.disabled = true;
  try {
    const response = await apiJson("/quizzes/" + encodeURIComponent(id), "DELETE");
    if (!response.ok) {
      libraryMessage.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      button.disabled = false;
      return;
    }
    loadQuizList();
  } catch (error) {
    libraryMessage.textContent = t("common.noServer", { message: error.message });
    button.disabled = false;
  }
}

// Обновляем список после входа и при каждом открытии вкладки
loginHooks.push(loadQuizList);
document.querySelector('.tab[data-panel="libraryPanel"]').addEventListener("click", loadQuizList);
