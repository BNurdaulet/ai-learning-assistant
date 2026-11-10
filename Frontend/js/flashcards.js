// Карточки: одна карточка за раз, клик переворачивает, кнопки Назад / Вперёд / Перемешать.
// Каждый набор — отдельный просмотрщик, поэтому в ленте чата их может быть несколько.
const fcBtn = $("fcBtn");
const fcMessage = $("fcMessage");

// Рисует набор карточек в container. meta.topic — тема для плашки «КАРТОЧКИ · тема».
function renderFlashcards(container, list, meta = {}) {
  const cards = list.slice();
  let cardIndex = 0;
  container.innerHTML = "";

  const box = document.createElement("div");
  box.className = "card fc-card";

  const head = document.createElement("div");
  head.className = "tool-head";
  const tag = document.createElement("span");
  tag.className = "tool-tag";
  tag.textContent = t("tool.cards") + (meta.topic ? " · " + meta.topic : "");
  const counter = document.createElement("span");
  counter.className = "tool-counter";
  head.append(tag, counter);

  const flashcard = document.createElement("div");
  flashcard.className = "flashcard";
  flashcard.tabIndex = 0;
  flashcard.setAttribute("role", "button");
  flashcard.setAttribute("aria-label", t("cards.flip"));
  const inner = document.createElement("div");
  inner.className = "flashcard-inner";
  const front = document.createElement("div");
  front.className = "face front";
  const back = document.createElement("div");
  back.className = "face back";
  inner.append(front, back);
  flashcard.appendChild(inner);

  const hint = document.createElement("div");
  hint.className = "hint center";
  hint.textContent = t("cards.flipHint");

  const nav = document.createElement("div");
  nav.className = "row fc-nav";
  const prev = navButton(t("cards.prev"), "btn-soft");
  const next = navButton(t("cards.next"), "btn-primary");
  const shuffle = navButton(t("cards.shuffle"), "btn-soft");
  nav.append(prev, shuffle, next);

  box.append(head, flashcard, hint, nav);
  container.appendChild(box);

  function navButton(text, className) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = text;
    return b;
  }

  function showCard() {
    const card = cards[cardIndex];
    // Возвращаем лицевую сторону без анимации, чтобы не мелькнул ответ новой карточки
    flashcard.classList.add("instant");
    flashcard.classList.remove("flipped");
    void flashcard.offsetWidth;
    flashcard.classList.remove("instant");
    renderRich(front, card.front, false);
    renderRich(back, card.back, false);
    counter.textContent = t("common.of", { current: cardIndex + 1, total: cards.length });
    prev.disabled = cardIndex === 0;
    next.disabled = cardIndex === cards.length - 1;
  }

  function flipCard() {
    flashcard.classList.toggle("flipped");
  }

  flashcard.addEventListener("click", flipCard);
  flashcard.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      flipCard();
    }
  });
  prev.addEventListener("click", () => {
    if (cardIndex > 0) {
      cardIndex--;
      showCard();
    }
  });
  next.addEventListener("click", () => {
    if (cardIndex < cards.length - 1) {
      cardIndex++;
      showCard();
    }
  });
  shuffle.addEventListener("click", () => {
    // Перемешивание Фишера–Йетса
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    cardIndex = 0;
    showCard();
  });

  showCard();
}

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
  statusEl.textContent = activeDoc
    ? t("cards.creatingDoc")
    : t("cards.creating");
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
  }

  if (button) button.disabled = false;
  return result;
}

fcBtn.addEventListener("click", () => runFlashcards(fcMessage, $("fcViewer"), fcBtn));
