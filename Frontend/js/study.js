// Конспект и план изучения: текст от ИИ в Markdown, кнопка «Скопировать».
const studyButtons = [$("studySummary"), $("studyPlan")];
const studyMessage = $("studyMessage");
let studySource = ""; // исходный Markdown, его и копируем

async function requestStudy(kind) {
  const topic = $("topic").value.trim();
  const materialText = material.value.trim();

  if (!activeDoc && !topic && !materialText) {
    studyMessage.textContent = "Введите тему, добавьте материал или выберите документ.";
    return;
  }
  const docError = docParamsError();
  if (docError) {
    studyMessage.textContent = docError;
    return;
  }

  studyButtons.forEach((b) => (b.disabled = true));
  studyMessage.textContent = kind === "summary" ? "Пишу конспект, подождите..." : "Составляю план, подождите...";
  if (activeDoc) studyMessage.textContent += " Большой документ обрабатывается частями, это может занять минуту.";
  $("studyCopied").textContent = "";

  try {
    const response = await apiFetch("/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, topic, material: activeDoc ? "" : materialText, ...docParams() }),
    });
    if (!response.ok) {
      studyMessage.textContent = "Ошибка " + response.status + ": " + (await readError(response));
    } else {
      const data = await response.json();
      studyMessage.textContent = data.note || "";
      studySource = data.text;
      renderRich($("studyText"), data.text, false);
      $("studyResult").hidden = false;
    }
  } catch (error) {
    studyMessage.textContent = "Не удалось связаться с сервером: " + error.message;
  }

  studyButtons.forEach((b) => (b.disabled = false));
}

$("studySummary").addEventListener("click", () => requestStudy("summary"));
$("studyPlan").addEventListener("click", () => requestStudy("plan"));

$("studyCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(studySource);
  } catch (e) {
    // Запасной способ, если clipboard API недоступен (например, не https)
    const area = document.createElement("textarea");
    area.value = studySource;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  $("studyCopied").textContent = "Скопировано (Markdown)";
});
