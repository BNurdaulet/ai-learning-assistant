// Страница задания для ученика (/a/<код>). Без входа: ученик вводит только имя.
// Шаг 1 — имя, шаг 2 — задание (квиз, карточки или конспект), шаг 3 — результат.
// Баллы считает сервер; страница только отправляет выбранные ответы.
// Имя ученика и любой текст из базы — только через textContent / setText, текст ИИ — через renderRich.
(function () {
  const code = decodeURIComponent(location.pathname.split("/")[2] || "");
  const TYPE_KEYS = { quiz: "tool.quiz", flashcards: "tool.cards", summary: "tool.summary" };
  const NAME_MAX = 40;

  let assignment = null; // {type, title, content_lang, questions | cards | text}
  let studentName = "";
  let startedAt = 0;

  function show(id) {
    ["loading", "unavailable", "stepName", "stepWork", "stepDone"].forEach((s) => ($(s).hidden = s !== id));
    window.scrollTo(0, 0);
  }

  function updateTitle() {
    const name = assignment && assignment.title ? assignment.title : t("student.title");
    document.title = name + " · " + t("app.logo");
  }
  document.addEventListener("langchange", updateTitle);

  // ---------- Загрузка задания ----------
  async function load() {
    await i18nReady;
    updateTitle();
    try {
      const response = await fetch(API_URL + "/api/a/" + encodeURIComponent(code));
      if (!response.ok) {
        // 404 — задания нет или оно закрыто; иное (429, 5xx) — показываем текст ошибки
        const text = response.status === 404 ? null : await readError(response);
        showUnavailable(text);
        return;
      }
      assignment = await response.json();
    } catch (error) {
      showUnavailable(t("common.noServer", { message: error.message }));
      return;
    }
    updateTitle();
    setText($("typeTag"), TYPE_KEYS[assignment.type]);
    $("assignmentTitle").textContent = assignment.title || "";
    $("assignmentTitle").hidden = !assignment.title;
    show("stepName");
    $("studentName").focus();
  }

  function showUnavailable(text) {
    if (text) $("unavailableTitle").textContent = text;
    else setText($("unavailableTitle"), "errors.assignment_unavailable");
    show("unavailable");
  }

  // ---------- Шаг 1: имя ----------
  $("nameForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("studentName").value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
    if (!name) {
      setText($("nameError"), "student.nameRequired");
      $("studentName").focus();
      return;
    }
    setText($("nameError"), null);
    studentName = name;
    startWork();
  });

  // ---------- Шаг 2: задание ----------
  function startWork() {
    setText($("youAre"), "student.you", { name: studentName });
    setText($("sendStatus"), null);
    $("retryBtn").hidden = true;
    const work = $("work");
    // Содержимое составлено на одном языке и показывается как есть
    if (assignment.content_lang) work.lang = assignment.content_lang;
    else work.removeAttribute("lang");
    const meta = { topic: assignment.title || "" };

    if (assignment.type === "quiz") {
      renderQuiz(work, assignment.questions, {
        meta,
        onSubmit: (chosen, button) => submit({ choices: chosen }, button),
      });
    } else if (assignment.type === "flashcards") {
      renderFlashcards(work, assignment.cards, {
        ...meta,
        onRated: (result, button) => submit(result, button),
      });
    } else {
      const done = document.createElement("button");
      done.type = "button";
      done.className = "btn-primary student-read";
      setText(done, "study.readDone");
      done.addEventListener("click", () => submit({ read: true }, done));
      renderStudy(work, "summary", assignment.text, { ...meta, footer: done });
    }
    startedAt = Date.now();
    show("stepWork");
  }

  // ---------- Отправка ----------
  async function submit(answers, button) {
    if (button) button.disabled = true;
    $("retryBtn").hidden = true;
    const status = $("sendStatus");
    status.removeAttribute("data-kind");
    setText(status, "student.sending");
    const body = {
      name: studentName,
      answers,
      duration_seconds: Math.round((Date.now() - startedAt) / 1000),
    };
    try {
      const response = await fetch(API_URL + "/api/a/" + encodeURIComponent(code) + "/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        failed(t("student.sendFailed", { message: await readError(response) }), answers, button);
        return;
      }
      showDone(await response.json(), answers);
    } catch (error) {
      failed(t("student.sendFailed", { message: t("common.noServerShort") }), answers, button);
    }
  }

  function failed(text, answers, button) {
    const status = $("sendStatus");
    status.dataset.kind = "error";
    setText(status, null);
    status.textContent = text;
    const retry = $("retryBtn");
    retry.hidden = false;
    retry.onclick = () => submit(answers, button);
  }

  // ---------- Шаг 3: результат ----------
  function showDone(result, answers) {
    const line = $("resultLine");
    if (assignment.type === "quiz") {
      setText(line, "student.score", { score: result.score, total: result.total });
    } else if (assignment.type === "flashcards") {
      setText(line, "asg.cardsSummary", { known: answers.known.length, repeat: answers.repeat.length });
    } else {
      setText(line, "student.readDone");
    }
    show("stepDone");
  }

  $("againBtn").addEventListener("click", startWork);

  load();
})();
