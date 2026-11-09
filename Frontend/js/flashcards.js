// Карточки: одна карточка за раз, клик переворачивает, кнопки Назад / Вперёд / Перемешать.
const fcBtn = $("fcBtn");
const fcMessage = $("fcMessage");
const fcCard = $("fcCard");

let cards = [];
let cardIndex = 0;

function showCard() {
  const card = cards[cardIndex];
  // Возвращаем лицевую сторону без анимации, чтобы не мелькнул ответ новой карточки
  fcCard.classList.add("instant");
  fcCard.classList.remove("flipped");
  void fcCard.offsetWidth;
  fcCard.classList.remove("instant");
  renderRich($("fcFront"), card.front, false);
  renderRich($("fcBack"), card.back, false);
  $("fcCounter").textContent = (cardIndex + 1) + " / " + cards.length;
  $("fcPrev").disabled = cardIndex === 0;
  $("fcNext").disabled = cardIndex === cards.length - 1;
}

function flipCard() {
  fcCard.classList.toggle("flipped");
}

fcCard.addEventListener("click", flipCard);
fcCard.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    flipCard();
  }
});

$("fcPrev").addEventListener("click", () => {
  if (cardIndex > 0) {
    cardIndex--;
    showCard();
  }
});

$("fcNext").addEventListener("click", () => {
  if (cardIndex < cards.length - 1) {
    cardIndex++;
    showCard();
  }
});

$("fcShuffle").addEventListener("click", () => {
  // Перемешивание Фишера–Йетса
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  cardIndex = 0;
  showCard();
});

fcBtn.addEventListener("click", async () => {
  const topic = $("topic").value.trim();
  const materialText = material.value.trim();
  const count = Math.max(1, Math.min(30, Number($("fcCount").value) || 10));

  if (!activeDoc && !topic && !materialText) {
    fcMessage.textContent = "Введите тему, добавьте материал или выберите документ.";
    return;
  }
  const docError = docParamsError();
  if (docError) {
    fcMessage.textContent = docError;
    return;
  }

  fcBtn.disabled = true;
  fcMessage.textContent = activeDoc
    ? "Создаю карточки по документу. Большой документ обрабатывается частями, это может занять минуту..."
    : "Создаю карточки, подождите...";

  try {
    const response = await apiFetch("/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, count, material: activeDoc ? "" : materialText, ...docParams() }),
    });
    if (!response.ok) {
      fcMessage.textContent = "Ошибка " + response.status + ": " + (await readError(response));
    } else {
      const data = await response.json();
      fcMessage.textContent = data.note || "";
      cards = data.cards;
      cardIndex = 0;
      $("fcViewer").hidden = false;
      showCard();
    }
  } catch (error) {
    fcMessage.textContent = "Не удалось связаться с сервером: " + error.message;
  }

  fcBtn.disabled = false;
});
