const btn = $("btn");
const message = $("message");
const quizBox = $("quiz");
const scoreBox = $("score");

let total = 0;
let answered = 0;
let correctCount = 0;

function renderQuiz(questions) {
  quizBox.innerHTML = "";
  scoreBox.textContent = "";
  total = questions.length;
  answered = 0;
  correctCount = 0;

  questions.forEach((q, i) => {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = (i + 1) + ". " + q.question;
    card.appendChild(title);

    const explanation = document.createElement("div");
    explanation.className = "explanation";
    explanation.hidden = true;

    const buttons = [];
    q.options.forEach((text, idx) => {
      const b = document.createElement("button");
      b.className = "option";
      b.textContent = text;
      b.addEventListener("click", () => {
        buttons.forEach((x) => (x.disabled = true));
        buttons[q.correct_index].classList.add("correct");
        if (idx === q.correct_index) {
          correctCount++;
        } else {
          b.classList.add("wrong");
        }
        explanation.textContent = q.explanation;
        explanation.hidden = false;
        answered++;
        if (answered === total) {
          scoreBox.textContent = "Результат: " + correctCount + " из " + total;
        }
      });
      buttons.push(b);
      card.appendChild(b);
    });

    card.appendChild(explanation);
    quizBox.appendChild(card);
  });
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
  scoreBox.textContent = "";

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
      renderQuiz(data.questions);
    }
  } catch (error) {
    message.textContent = "Не удалось связаться с сервером: " + error.message;
  }

  btn.disabled = false;
});
