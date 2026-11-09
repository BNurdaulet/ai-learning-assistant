// Разбор ошибок: вызывается из renderQuiz (quiz.js) кнопкой «Разобрать ошибки».
const MAX_MISTAKES = 10; // столько же ограничивает сервер

async function startReview(mistakes, box, button) {
  button.disabled = true;
  box.innerHTML = "";
  const status = document.createElement("div");
  status.className = "hint";
  status.textContent = "Разбираю ошибки, подождите...";
  box.appendChild(status);

  const sent = mistakes.slice(0, MAX_MISTAKES);
  try {
    const response = await apiFetch("/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mistakes: sent,
        topic: $("topic").value.trim(),
        material: activeDoc ? "" : material.value.trim(),
        document_id: activeDoc ? activeDoc.id : null,
      }),
    });
    if (!response.ok) {
      status.textContent = "Ошибка " + response.status + ": " + (await readError(response));
      button.disabled = false;
      return;
    }
    const data = await response.json();
    status.remove();
    if (mistakes.length > sent.length) {
      status.textContent = "Разобраны первые " + sent.length + " ошибок из " + mistakes.length + ".";
      box.appendChild(status);
    }
    renderReview(box, data);
  } catch (error) {
    status.textContent = "Не удалось связаться с сервером: " + error.message;
    button.disabled = false;
  }
}

function renderReview(box, data) {
  const heading = document.createElement("h2");
  heading.textContent = "Разбор ошибок";
  box.appendChild(heading);

  data.items.forEach((item, i) => {
    const card = document.createElement("div");
    card.className = "card review-card";

    const title = document.createElement("h3");
    const num = document.createElement("span");
    num.textContent = (i + 1) + ". ";
    const q = document.createElement("span");
    renderRich(q, item.question, true);
    title.append(num, q);

    card.append(
      title,
      richLine("Ваш ответ: ", item.chosen, "wrong-text"),
      richLine("Правильный ответ: ", item.correct, "ok-text"),
    );

    const why = document.createElement("div");
    why.className = "rich explanation";
    renderRich(why, item.why_wrong, false);
    card.appendChild(why);

    if (item.concept) card.appendChild(richLine("Что повторить: ", item.concept, ""));
    box.appendChild(card);
  });

  if (data.topics.length > 0) {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = "Темы для повторения";
    const list = document.createElement("ul");
    data.topics.forEach((t) => {
      const li = document.createElement("li");
      renderRich(li, t, true);
      list.appendChild(li);
    });
    card.append(title, list);
    box.appendChild(card);
  }

  if (data.practice.length > 0) {
    const title = document.createElement("h2");
    title.textContent = "Тренировка: похожие вопросы";
    const practiceBox = document.createElement("div");
    box.append(title, practiceBox);
    // Тот же квиз, что и основной: со счётом и повторным разбором ошибок
    renderQuiz(practiceBox, data.practice, {
      assignment: $("assignment").checked,
      meta: { topic: "Тренировка: " + ($("topic").value.trim() || "по материалу"), difficulty: "" },
    });
  }
}

// Строка «Подпись: текст ИИ», где текст рисуется через renderRich
function richLine(label, text, className) {
  const line = document.createElement("div");
  line.className = "review-line " + className;
  const strong = document.createElement("strong");
  strong.textContent = label;
  const body = document.createElement("span");
  renderRich(body, text, true);
  line.append(strong, body);
  return line;
}
