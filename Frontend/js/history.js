// «История»: прошлые результаты квизов, ошибки и повторный разбор.
const historyList = $("historyList");
const historyMessage = $("historyMessage");

async function loadHistory() {
  historyMessage.textContent = t("common.loading");
  try {
    const response = await apiFetch("/history");
    if (!response.ok) {
      historyMessage.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      return;
    }
    const data = await response.json();
    historyList.innerHTML = "";
    historyMessage.textContent = data.results.length ? "" : t("history.empty");
    data.results.forEach((r) => historyList.appendChild(historyItem(r)));
  } catch (error) {
    historyMessage.textContent = t("common.noServer", { message: error.message });
  }
}

function historyItem(r) {
  const percent = Math.round((r.score / r.total) * 100);
  const subtitle = t("history.score", { score: r.score, total: r.total, percent }) + " · " + formatDate(r.created_at);
  const details = document.createElement("div");
  details.hidden = true;

  const buttons = [];
  if (r.mistakes.length > 0) {
    buttons.push([t("history.mistakes", { count: r.mistakes.length }), () => {
      details.hidden = !details.hidden;
      if (!details.hidden && !details.childElementCount) fillMistakes(details, r.mistakes);
    }]);
  }
  const item = listItem(r.topic || t("common.noTopic"), subtitle, buttons);
  item.appendChild(details);
  details.className = "history-details";
  return item;
}

function fillMistakes(box, mistakes) {
  mistakes.forEach((m, i) => {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h3");
    const num = document.createElement("span");
    num.textContent = (i + 1) + ". ";
    const q = document.createElement("span");
    renderRich(q, m.question, true);
    title.append(num, q);
    card.append(title, richLine(t("review.yourAnswer"), m.chosen, "wrong-text"), richLine(t("review.correctAnswer"), m.correct, "ok-text"));
    if (m.explanation) {
      const ex = document.createElement("div");
      ex.className = "explanation";
      renderRich(ex, m.explanation, true);
      card.appendChild(ex);
    }
    box.appendChild(card);
  });

  // Повторный разбор этих ошибок (review.js)
  const reviewBox = document.createElement("div");
  const reviewBtn = document.createElement("button");
  reviewBtn.type = "button";
  reviewBtn.textContent = t("quiz.review");
  reviewBtn.style.marginTop = "10px";
  reviewBtn.addEventListener("click", () => startReview(mistakes, reviewBox, reviewBtn));
  box.append(reviewBtn, reviewBox);
}

loginHooks.push(loadHistory);
document.querySelector('.tab[data-panel="historyPanel"]').addEventListener("click", loadHistory);
