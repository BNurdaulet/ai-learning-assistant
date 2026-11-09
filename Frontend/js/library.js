// «Мои квизы»: список сохранённых квизов, открыть или удалить.
const libraryList = $("libraryList");
const libraryMessage = $("libraryMessage");

async function loadQuizList() {
  libraryMessage.textContent = "Загружаю...";
  try {
    const response = await apiFetch("/quizzes");
    if (!response.ok) {
      libraryMessage.textContent = "Ошибка " + response.status + ": " + (await readError(response));
      return;
    }
    const data = await response.json();
    libraryList.innerHTML = "";
    libraryMessage.textContent = data.quizzes.length ? "" : "Сохранённых квизов пока нет. Нажмите «Сохранить квиз» под квизом.";
    data.quizzes.forEach((q) => {
      const subtitle = [q.difficulty, formatDate(q.created_at)].filter(Boolean).join(" · ");
      libraryList.appendChild(listItem(q.topic || "Без темы", subtitle, [
        ["Открыть", (b) => openQuiz(q.id, b)],
        ["Удалить", (b) => deleteQuiz(q.id, q.topic, b), "danger"],
      ]));
    });
  } catch (error) {
    libraryMessage.textContent = "Не удалось связаться с сервером: " + error.message;
  }
}

async function openQuiz(id, button) {
  button.disabled = true;
  try {
    const response = await apiFetch("/quizzes/" + encodeURIComponent(id));
    if (!response.ok) {
      libraryMessage.textContent = "Ошибка " + response.status + ": " + (await readError(response));
      return;
    }
    const quiz = await response.json();
    document.querySelector('.tab[data-panel="quizPanel"]').click();
    message.textContent = "Сохранённый квиз: " + (quiz.topic || "без темы");
    renderQuiz(quizBox, quiz.questions, {
      assignment: $("assignment").checked,
      meta: { topic: quiz.topic, difficulty: quiz.difficulty },
      quizId: quiz.id,
    });
  } catch (error) {
    libraryMessage.textContent = "Не удалось связаться с сервером: " + error.message;
  } finally {
    button.disabled = false;
  }
}

async function deleteQuiz(id, topic, button) {
  if (!confirm("Удалить квиз «" + (topic || "без темы") + "»? Результаты останутся в истории.")) return;
  button.disabled = true;
  try {
    const response = await apiJson("/quizzes/" + encodeURIComponent(id), "DELETE");
    if (!response.ok) {
      libraryMessage.textContent = "Ошибка " + response.status + ": " + (await readError(response));
      button.disabled = false;
      return;
    }
    loadQuizList();
  } catch (error) {
    libraryMessage.textContent = "Не удалось связаться с сервером: " + error.message;
    button.disabled = false;
  }
}

// Обновляем список после входа и при каждом открытии вкладки
loginHooks.push(loadQuizList);
document.querySelector('.tab[data-panel="libraryPanel"]').addEventListener("click", loadQuizList);
