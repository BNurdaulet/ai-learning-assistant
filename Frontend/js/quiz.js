const btn = $("btn");
const message = $("message");
const quizBox = $("quiz");

// Рисует квиз в container. Используется и для основного квиза, и для тренировки после разбора ошибок.
// options.assignment = true: режим задания (без подсветки, ответы по кнопке «Показать ответы»).
// options.meta = {topic, difficulty}: тема квиза (для сохранения и истории).
// options.quizId: id сохранённого квиза (если квиз открыт из «Мои квизы»).
function renderQuiz(container, questions, options = {}) {
  const assignment = !!options.assignment;
  const meta = options.meta || { topic: "", difficulty: "" };
  let quizId = options.quizId || null;
  container.innerHTML = "";

  const total = questions.length;
  const chosen = new Array(total).fill(null); // какой вариант выбрал пользователь
  const reveals = []; // функции, которые показывают правильный ответ у вопроса
  let answered = 0;
  let finished = false;
  let current = 0; // какой вопрос сейчас на экране (в обычном режиме вопросы идут по одному)

  // Карточка квиза: плашка «КВИЗ · тема», «Вопрос N из M», полоска прогресса
  const card = document.createElement("div");
  card.className = "card quiz-card" + (assignment ? " quiz-sheet" : "");
  const head = document.createElement("div");
  head.className = "tool-head";
  const tag = document.createElement("span");
  tag.className = "tool-tag";
  tag.textContent = t("tool.quiz") + (meta.topic ? " · " + meta.topic : "");
  const counter = document.createElement("span");
  counter.className = "tool-counter";
  head.append(tag, counter);
  const progress = document.createElement("div");
  progress.className = "quiz-progress no-print";
  const progressFill = document.createElement("div");
  progress.appendChild(progressFill);
  card.append(head, progress);

  // Кнопка «Сохранить квиз»
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn-soft";
  const saveStatus = document.createElement("div");
  saveStatus.className = "hint no-print";
  saveBtn.textContent = quizId ? t("quiz.saved") : t("quiz.save");
  saveBtn.disabled = !!quizId;
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveStatus.textContent = t("quiz.saving");
    try {
      const response = await apiJson("/quizzes", "POST", {
        topic: meta.topic,
        difficulty: meta.difficulty,
        questions,
      });
      if (!response.ok) {
        saveStatus.textContent = t("common.error", { message: await readError(response) });
        saveBtn.disabled = false;
        return;
      }
      quizId = (await response.json()).id;
      saveBtn.textContent = t("quiz.saved");
      saveStatus.textContent = t("quiz.savedHint");
      if (typeof loadQuizList === "function") loadQuizList();
    } catch (error) {
      saveStatus.textContent = t("common.noServer", { message: error.message });
      saveBtn.disabled = false;
    }
  });

  // «Следующий вопрос» (только в обычном режиме)
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "btn-primary quiz-next";
  nextBtn.hidden = assignment;

  const scoreBox = document.createElement("div");
  scoreBox.className = "score";
  const actions = document.createElement("div");
  actions.className = "row no-print";
  const reviewBox = document.createElement("div"); // сюда review.js выводит разбор ошибок

  const steps = [];
  questions.forEach((q, i) => {
    const step = document.createElement("section");
    step.className = "quiz-step";

    const title = document.createElement("h3");
    const num = document.createElement("span");
    num.className = "quiz-num";
    num.textContent = (i + 1) + ". ";
    const body = document.createElement("span");
    renderRich(body, q.question, true);
    title.append(num, body);
    step.appendChild(title);

    const optionsBox = document.createElement("div");
    optionsBox.className = "quiz-options";

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
      explanation.innerHTML = "";
      if (chosen[i] !== null) {
        const verdict = document.createElement("strong");
        verdict.textContent = chosen[i] === q.correct_index ? t("quiz.correct") : t("quiz.wrong");
        explanation.appendChild(verdict);
        explanation.classList.add(chosen[i] === q.correct_index ? "is-ok" : "is-bad");
      }
      const text = document.createElement("span");
      renderRich(text, q.explanation, true);
      explanation.appendChild(text);
      explanation.hidden = false;
    };

    q.options.forEach((text, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "option";
      const label = document.createElement("span");
      renderRich(label, text, true);
      const letter = document.createElement("span");
      letter.className = "opt-letter";
      letter.textContent = "ABCDEFGH"[idx] + " ·";
      b.append(letter, label);
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
        updateNav();
      });
      buttons.push(b);
      optionsBox.appendChild(b);
    });

    step.append(optionsBox, explanation);
    steps.push(step);
    card.appendChild(step);
  });

  // Итог (в обычном режиме показывается после последнего вопроса)
  const result = document.createElement("section");
  result.className = "quiz-result";
  result.append(scoreBox, actions);
  card.appendChild(result);

  const footer = document.createElement("div");
  footer.className = "quiz-footer no-print";
  footer.append(saveBtn, nextBtn);
  card.append(footer, saveStatus);

  // Показ вопросов по одному
  function show(i) {
    current = i;
    steps.forEach((s, k) => s.classList.toggle("is-current", k === i));
    result.classList.remove("is-current");
    counter.textContent = t("quiz.counter", { current: i + 1, total });
    progressFill.style.width = ((i + 1) / total) * 100 + "%";
    updateNav();
  }
  function updateNav() {
    if (assignment) return;
    const last = current === total - 1;
    nextBtn.textContent = last ? t("quiz.showResult") : t("quiz.next");
    nextBtn.disabled = chosen[current] === null;
  }
  function showResult() {
    steps.forEach((s) => s.classList.remove("is-current"));
    result.classList.add("is-current");
    counter.textContent = t("quiz.result");
    progressFill.style.width = "100%";
    nextBtn.hidden = true;
  }
  nextBtn.addEventListener("click", () => {
    if (current < total - 1) show(current + 1);
    else showResult();
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

    let text = t("quiz.score", { correct: correctCount, total });
    if (answered < total) text += t("quiz.unanswered", { count: total - answered });
    scoreBox.textContent = text;
    saveResult(correctCount, mistakes);

    actions.innerHTML = "";
    // startReview объявлена в review.js
    if (mistakes.length > 0 && typeof startReview === "function") {
      const reviewBtn = document.createElement("button");
      reviewBtn.textContent = t("quiz.review");
      reviewBtn.addEventListener("click", () => startReview(mistakes, reviewBox, reviewBtn));
      actions.appendChild(reviewBtn);
    }
  }

  // Сохраняем результат в историю (тихо: если не вышло, просто пишем об этом под счётом)
  async function saveResult(score, mistakes) {
    const note = document.createElement("div");
    note.className = "hint no-print";
    try {
      const response = await apiJson("/results", "POST", {
        quiz_id: quizId,
        topic: meta.topic,
        score,
        total,
        mistakes: mistakes.slice(0, 30),
      });
      note.textContent = response.ok
        ? t("quiz.resultSaved")
        : t("quiz.resultNotSaved", { message: await readError(response) });
    } catch (error) {
      note.textContent = t("quiz.resultNoServer");
    }
    scoreBox.after(note);
  }

  if (assignment) {
    // Режим задания: все вопросы сразу (так их удобно печатать)
    counter.textContent = t("quiz.questionsCount", { count: total });
    const showBtn = document.createElement("button");
    showBtn.textContent = t("quiz.showAnswers");
    showBtn.addEventListener("click", () => {
      reveals.forEach((reveal) => reveal());
      finish();
    });
    actions.appendChild(showBtn);
  } else {
    show(0);
  }

  container.append(card, reviewBox);
}

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
