const btn = $("btn");
const message = $("message");
const quizBox = $("quiz");

// Рисует квиз в container. Используется и для основного квиза, и для тренировки после разбора ошибок.
// options.assignment = true: режим задания (без подсветки, ответы по кнопке «Показать ответы»).
function renderQuiz(container, questions, options = {}) {
  const assignment = !!options.assignment;
  container.innerHTML = "";

  const total = questions.length;
  const chosen = new Array(total).fill(null); // какой вариант выбрал пользователь
  const reveals = []; // функции, которые показывают правильный ответ у вопроса
  let answered = 0;
  let finished = false;

  const scoreBox = document.createElement("div");
  scoreBox.className = "score";
  const actions = document.createElement("div");
  actions.className = "row no-print";
  const reviewBox = document.createElement("div"); // сюда review.js выводит разбор ошибок

  questions.forEach((q, i) => {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("h3");
    const num = document.createElement("span");
    num.textContent = (i + 1) + ". ";
    const body = document.createElement("span");
    renderRich(body, q.question, true);
    title.append(num, body);
    card.appendChild(title);

    const explanation = document.createElement("div");
    explanation.className = "explanation";
    explanation.hidden = true;

    const buttons = [];
    reveals[i] = () => {
      buttons.forEach((x) => (x.disabled = true));
      buttons[q.correct_index].classList.add("correct");
      if (chosen[i] !== null && chosen[i] !== q.correct_index) {
        buttons[chosen[i]].classList.add("wrong");
      }
      renderRich(explanation, q.explanation, true);
      explanation.hidden = false;
    };

    q.options.forEach((text, idx) => {
      const b = document.createElement("button");
      b.className = "option";
      renderRich(b, text, true);
      b.addEventListener("click", () => {
        if (assignment) {
          // Только отмечаем выбор, без зелёного/красного
          if (chosen[i] === null) answered++;
          chosen[i] = idx;
          buttons.forEach((x) => x.classList.toggle("selected", x === b));
          return;
        }
        chosen[i] = idx;
        reveals[i]();
        answered++;
        if (answered === total) finish();
      });
      buttons.push(b);
      card.appendChild(b);
    });

    card.appendChild(explanation);
    container.appendChild(card);
  });

  function finish() {
    if (finished) return;
    finished = true;

    let correctCount = 0;
    const mistakes = [];
    questions.forEach((q, i) => {
      if (chosen[i] === q.correct_index) {
        correctCount++;
      } else if (chosen[i] !== null) {
        mistakes.push({
          question: q.question,
          options: q.options,
          chosen: q.options[chosen[i]],
          correct: q.options[q.correct_index],
          explanation: q.explanation,
        });
      }
    });

    let text = "Результат: " + correctCount + " из " + total;
    if (answered < total) text += " (без ответа: " + (total - answered) + ")";
    scoreBox.textContent = text;

    actions.innerHTML = "";
    // startReview объявлена в review.js
    if (mistakes.length > 0 && typeof startReview === "function") {
      const reviewBtn = document.createElement("button");
      reviewBtn.textContent = "Разобрать ошибки";
      reviewBtn.addEventListener("click", () => startReview(mistakes, reviewBox, reviewBtn));
      actions.appendChild(reviewBtn);
    }
  }

  if (assignment) {
    const showBtn = document.createElement("button");
    showBtn.textContent = "Показать ответы";
    showBtn.addEventListener("click", () => {
      reveals.forEach((reveal) => reveal());
      finish();
    });
    actions.appendChild(showBtn);
  }

  container.append(scoreBox, actions, reviewBox);
}

btn.addEventListener("click", async () => {
  const topic = $("topic").value.trim();
  const count = Number($("count").value);
  const difficulty = $("difficulty").value;
  const materialText = material.value.trim();

  if (!topic && !materialText) {
    message.textContent = "Введите тему или добавьте материал.";
    return;
  }

  btn.disabled = true;
  message.textContent = "Генерирую, подождите...";
  quizBox.innerHTML = "";

  try {
    const response = await fetch(API_URL + "/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, count, difficulty, material: materialText }),
    });
    if (!response.ok) {
      message.textContent = "Ошибка " + response.status + ": " + (await readError(response));
    } else {
      const data = await response.json();
      message.textContent = "";
      renderQuiz(quizBox, data.questions, { assignment: $("assignment").checked });
    }
  } catch (error) {
    message.textContent = "Не удалось связаться с сервером: " + error.message;
  }

  btn.disabled = false;
});
