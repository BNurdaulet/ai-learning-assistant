// Отрисовка карточек. Общая для главной страницы и страницы задания ученика.
// Одна карточка за раз, клик переворачивает. Каждый набор — отдельный просмотрщик.

// Рисует набор карточек в container. meta.topic — тема для плашки «КАРТОЧКИ · тема».
// meta.onRated({known, repeat}): страница задания ученика. Вместо «Назад / Перемешать / Вперёд» —
//   кнопки «Повторить» / «Знаю»; после оценки последней карточки вызывается onRated с номерами карточек.
function renderFlashcards(container, list, meta = {}) {
  const cards = list.slice();
  const onRated = typeof meta.onRated === "function" ? meta.onRated : null;
  const rated = new Array(cards.length).fill(null); // "known" / "repeat" для каждой карточки
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
  hint.textContent = onRated ? t("cards.rateHint") : t("cards.flipHint");

  const nav = document.createElement("div");
  nav.className = "row fc-nav";
  const prev = navButton(t("cards.prev"), "btn-soft");
  const next = navButton(t("cards.next"), "btn-primary");
  const shuffle = navButton(t("cards.shuffle"), "btn-soft");
  const repeatBtn = navButton(t("cards.repeat"), "btn-soft");
  const knowBtn = navButton(t("cards.know"), "btn-primary");
  if (onRated) nav.append(repeatBtn, knowBtn);
  else nav.append(prev, shuffle, next);

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
  // Оценка карточки: запоминаем и переходим к следующей; после последней — onRated
  function rate(value) {
    rated[cardIndex] = value;
    if (cardIndex < cards.length - 1) {
      cardIndex++;
      showCard();
      return;
    }
    knowBtn.disabled = repeatBtn.disabled = true;
    const result = { known: [], repeat: [] };
    rated.forEach((v, i) => result[v === "known" ? "known" : "repeat"].push(i));
    onRated(result, knowBtn);
  }
  knowBtn.addEventListener("click", () => rate("known"));
  repeatBtn.addEventListener("click", () => rate("repeat"));

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
