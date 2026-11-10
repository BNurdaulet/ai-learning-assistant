// Команды в поле ввода чата: /квиз, /карточки, /конспект, /план.
// Результат появляется в ленте как ответ ИИ. Сами запросы делают runQuiz (quiz.js),
// runFlashcards (flashcards.js) и runStudy (study.js) — те же, что у отдельных разделов.
const COMMANDS = [
  { name: "квиз", hint: "Тест с вариантами ответов" },
  { name: "карточки", hint: "Запомнить термины и даты" },
  { name: "конспект", hint: "Главное из темы коротко" },
  { name: "план", hint: "План изучения темы" },
];

// «/квиз фотосинтез, 5 вопросов» -> {cmd, args: "фотосинтез, 5 вопросов"}; не команда -> null
function parseCommand(text) {
  const m = text.match(/^\/(\S+)\s*([\s\S]*)$/);
  if (!m) return null;
  const cmd = COMMANDS.find((c) => c.name === m[1].toLowerCase());
  return cmd ? { cmd, args: m[2].trim() } : null;
}

// Из текста после команды достаём число, сложность и тему:
// «по фотосинтезу, 10 вопросов, сложный» -> {count: 10, difficulty: "сложная", topic: "фотосинтезу"}
function parseCommandArgs(args) {
  let rest = " " + args + " ";
  let count = null;
  let difficulty = null;

  const num = rest.match(/(\d{1,3})\s*(вопрос\S*|карточ\S*|шт\S*)?/i);
  if (num) {
    count = Number(num[1]);
    rest = rest.replace(num[0], " ");
  }
  const levels = [
    [/(^|[\s,])(л[её]гк\S*)/i, "лёгкая"],
    [/(^|[\s,])(средн\S*)/i, "средняя"],
    [/(^|[\s,])(сложн\S*)/i, "сложная"],
  ];
  for (const [re, value] of levels) {
    const m = rest.match(re);
    if (m) {
      difficulty = value;
      rest = rest.replace(m[2], " ");
      break;
    }
  }
  const topic = rest
    .replace(/\s*,\s*(,\s*)*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.—-]+|[\s,;:—-]+$/g, "")
    .replace(/^(по теме|на тему|по|про)\s+/i, "")
    .trim();
  return { count, difficulty, topic };
}

// Есть ли материал, по которому можно работать без темы
function hasMaterial() {
  return !!activeDoc || !!material.value.trim();
}

// Выполняет команду. Возвращает false, если это не команда (тогда текст уходит в чат как обычно).
function runCommand(text) {
  const parsed = parseCommand(text);
  if (!parsed) return false;
  const { cmd, args } = parsed;
  const { count, difficulty, topic } = parseCommandArgs(args);

  // Сообщение пользователя: плашка с командой и остальной текст
  const userBubble = addBubble("user", "");
  const tag = document.createElement("span");
  tag.className = "cmd-tag";
  tag.textContent = "/" + cmd.name;
  userBubble.append(tag, args ? " " + args : "");

  // Ответ ИИ: строка статуса и место под карточку
  const reply = addBubble("assistant", "");
  reply.classList.add("tool-msg");
  const status = document.createElement("div");
  status.className = "tool-status";
  const box = document.createElement("div");
  box.className = "tool-box";
  reply.append(status, box);

  if (!topic && !hasMaterial()) {
    status.textContent = "Напиши тему после команды, например: «/" + cmd.name + " фотосинтез»"
      + (cmd.name === "квиз" ? ", 5 вопросов" : "") + " — или прикрепи материал кнопкой «+» / «Файл».";
    return true;
  }

  // Поля разделов, которые читают runQuiz / runFlashcards / runStudy
  $("topic").value = topic;
  const source = topic ? "по теме «" + topic + "»"
    : activeDoc ? "по документу «" + activeDoc.title + "»"
    : "по твоему материалу";

  let job;
  if (cmd.name === "квиз") {
    $("count").value = Math.max(1, Math.min(20, count || 5));
    if (difficulty) $("difficulty").value = difficulty;
    job = runQuiz(status, box, null).then((data) => {
      if (!data) return;
      const extra = quizSourceText(data);
      status.textContent = $("assignment").checked
        ? "Готово! Собрал квиз " + source + ". Ответы покажу, когда нажмёшь «Показать ответы»."
        : "Готово! Собрал квиз " + source + ". Отвечай — если ошибёшься, сразу объясню.";
      if (extra) status.textContent += " " + extra;
    });
  } else if (cmd.name === "карточки") {
    $("fcCount").value = Math.max(1, Math.min(30, count || 10));
    job = runFlashcards(status, box, null).then((data) => {
      if (!data) return;
      status.textContent = "Готово! Вот карточки " + source + ". Нажимай на карточку, чтобы увидеть ответ."
        + (data.note ? " " + data.note : "");
    });
  } else {
    const kind = cmd.name === "план" ? "plan" : "summary";
    job = runStudy(kind, status, box).then((data) => {
      if (!data) return;
      status.textContent = (kind === "plan" ? "Вот план изучения " : "Вот конспект ") + source + "."
        + (data.note ? " " + data.note : "");
    });
  }

  job.finally(() => {
    // Прокручиваем ленту к началу ответа
    chatLog.scrollTop = Math.max(0, reply.offsetTop - chatLog.offsetTop - 12);
  });
  return true;
}

// Кнопки «Квиз / Карточки / Конспект» на главной и в меню «+»:
// если материал уже есть — сразу выполняем команду по нему, иначе ставим команду в поле ввода
function startCommand(name) {
  if (hasMaterial()) {
    runCommand("/" + name);
    return;
  }
  fillCommand(name);
}

function fillCommand(name) {
  chatInput.value = "/" + name + " ";
  chatInput.focus();
  chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
  hideCmdMenu();
}

// ----- Меню команд над полем ввода -----
const cmdMenu = $("cmdMenu");
let cmdItems = [];
let cmdActive = 0;

function renderCmdMenu(prefix) {
  cmdItems = COMMANDS.filter((c) => c.name.startsWith(prefix.toLowerCase()));
  if (!cmdItems.length) return hideCmdMenu();
  cmdActive = Math.min(cmdActive, cmdItems.length - 1);
  cmdMenu.innerHTML = "";
  cmdItems.forEach((c, i) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cmd-item" + (i === cmdActive ? " active" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(i === cmdActive));
    const name = document.createElement("strong");
    name.textContent = "/" + c.name;
    const hint = document.createElement("span");
    hint.textContent = c.hint;
    item.append(name, hint);
    // mousedown, чтобы поле ввода не потеряло фокус до выбора
    item.addEventListener("mousedown", (e) => e.preventDefault());
    item.addEventListener("click", () => fillCommand(c.name));
    cmdMenu.appendChild(item);
  });
  cmdMenu.hidden = false;
}

function hideCmdMenu() {
  cmdMenu.hidden = true;
  cmdActive = 0;
}

// Меню видно, пока в поле только «/» и начало названия команды
function updateCmdMenu() {
  const m = chatInput.value.match(/^\/(\S*)$/);
  if (m) renderCmdMenu(m[1]);
  else hideCmdMenu();
}

chatInput.addEventListener("input", updateCmdMenu);
chatInput.addEventListener("blur", () => setTimeout(hideCmdMenu, 150));

// Стрелки, Enter, Tab и Esc, пока меню открыто. Ловим раньше chat.js (на этапе перехвата),
// иначе Enter отправил бы недописанную команду.
document.addEventListener("keydown", (e) => {
  if (e.target !== chatInput || cmdMenu.hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    cmdActive = (cmdActive + (e.key === "ArrowDown" ? 1 : -1) + cmdItems.length) % cmdItems.length;
    renderCmdMenu(chatInput.value.slice(1));
  } else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
    fillCommand(cmdItems[cmdActive].name);
  } else if (e.key === "Escape") {
    hideCmdMenu();
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
}, true);

// Кнопки на главной, в меню «+» и быстрые подсказки
document.querySelectorAll("[data-cmd]").forEach((b) => {
  b.addEventListener("click", () => {
    if (typeof closeSheets === "function") closeSheets();
    startCommand(b.dataset.cmd);
  });
});
document.querySelectorAll("[data-cmd-fill]").forEach((b) => {
  b.addEventListener("click", () => fillCommand(b.dataset.cmdFill));
});
document.querySelectorAll("[data-say]").forEach((b) => {
  b.addEventListener("click", () => {
    chatInput.value = b.dataset.say;
    chatSend.click();
  });
});
