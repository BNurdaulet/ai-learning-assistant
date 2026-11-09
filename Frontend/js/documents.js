// Большие документы: загрузка с прогрессом, список «Мои документы», выбор активного документа.
// Пока документ выбран, квиз, карточки, конспект и чат отправляют document_id вместо материала.
const MAX_DOC_MB = 20; // столько же ограничивает сервер
let activeDoc = null;  // {id, title, pages, chunk_count} — выбранный документ (только до перезагрузки страницы)

// «1 страница», «3 страницы», «5 страниц»
function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return n + " " + forms[2];
  if (b === 1) return n + " " + forms[0];
  if (b >= 2 && b <= 4) return n + " " + forms[1];
  return n + " " + forms[2];
}
const PAGES = ["страница", "страницы", "страниц"];
const PARTS = ["часть", "части", "частей"];

// Подпись «стр. 12–13, 40» из списка источников [{page_start, page_end}]
function formatSources(sources) {
  return "стр. " + sources
    .map((s) => (s.page_start === s.page_end ? s.page_start : s.page_start + "–" + s.page_end))
    .join(", ");
}

// Поля для запросов к ИИ: документ и выбранная часть (пустой объект, если документа нет)
function docParams() {
  if (!activeDoc) return {};
  const params = { document_id: activeDoc.id, scope: $("docScope").value };
  if (params.scope === "pages") {
    params.page_from = Math.max(1, Math.floor(Number($("pageFrom").value) || 1));
    params.page_to = Math.max(1, Math.floor(Number($("pageTo").value) || params.page_from));
  }
  return params;
}

// Проверка перед запросом: возвращает текст ошибки или "" (если всё в порядке)
function docParamsError() {
  if (activeDoc && $("docScope").value === "topic" && !$("topic").value.trim()) {
    return "Введите тему в поле «Тема» — её будем искать в документе.";
  }
  return "";
}

function setActiveDoc(doc) {
  activeDoc = doc ? { id: doc.id, title: doc.title, pages: doc.pages, chunk_count: doc.chunk_count } : null;
  $("activeDocBox").hidden = !activeDoc;
  material.disabled = !!activeDoc;
  if (activeDoc) {
    $("activeDocTitle").textContent = activeDoc.title + " (" + plural(activeDoc.pages, PAGES) + ")";
    $("pageFrom").max = activeDoc.pages;
    $("pageTo").max = activeDoc.pages;
    $("pageTo").value = Math.min(activeDoc.pages, Math.max(1, Number($("pageTo").value) || 10));
    $("docPagesHint").textContent = "всего " + plural(activeDoc.pages, PAGES);
  }
  if ($("docsBox").open) loadDocuments();
}

$("docScope").addEventListener("change", () => {
  $("docPages").hidden = $("docScope").value !== "pages";
});
$("docOff").addEventListener("click", () => setActiveDoc(null));
$("docUploadBtn").addEventListener("click", () => $("docFile").click());

$("docFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) uploadDocument(file);
});

// Загрузка через XMLHttpRequest: в отличие от fetch, он умеет показывать процент отправки
async function uploadDocument(file) {
  const status = $("docStatus");
  const button = $("docUploadBtn");
  if (file.size > MAX_DOC_MB * 1024 * 1024) {
    status.textContent = "Файл слишком большой (максимум " + MAX_DOC_MB + " МБ).";
    return;
  }

  await authReady;
  const { data } = sb ? await sb.auth.getSession() : { data: {} };
  if (!data.session) {
    showAuth("Войдите в аккаунт.");
    return;
  }

  button.disabled = true;
  status.textContent = "Загружаю файл: 0%";
  const form = new FormData();
  form.append("file", file);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", API_URL + "/documents");
  xhr.setRequestHeader("Authorization", "Bearer " + data.session.access_token);

  xhr.upload.addEventListener("progress", (e) => {
    if (!e.lengthComputable) return;
    const percent = Math.round((e.loaded / e.total) * 100);
    status.textContent = percent < 100
      ? "Загружаю файл: " + percent + "%"
      : "Обрабатываю документ… Большой PDF может обрабатываться до минуты.";
  });

  xhr.addEventListener("load", async () => {
    button.disabled = false;
    if (xhr.status === 401) showAuth("Сессия истекла. Войдите снова.");
    if (xhr.status !== 200) {
      status.textContent = "Ошибка " + xhr.status + ": " + (await readError(new Response(xhr.responseText)));
      return;
    }
    let doc;
    try {
      doc = JSON.parse(xhr.responseText);
    } catch (error) {
      status.textContent = "Сервер вернул непонятный ответ.";
      return;
    }
    let text = "Файл: " + plural(doc.pages, PAGES) + ", " + plural(doc.chunk_count, PARTS) + ". Документ выбран.";
    if (doc.warning) text += " " + doc.warning;
    status.textContent = text;
    setActiveDoc(doc);
  });

  xhr.addEventListener("error", () => {
    button.disabled = false;
    status.textContent = "Не удалось связаться с сервером.";
  });

  xhr.send(form);
}

async function loadDocuments() {
  const box = $("docsList");
  const msg = $("docsMessage");
  msg.textContent = "Загружаю...";
  try {
    const response = await apiFetch("/documents");
    if (!response.ok) {
      msg.textContent = "Ошибка " + response.status + ": " + (await readError(response));
      return;
    }
    const data = await response.json();
    box.innerHTML = "";
    msg.textContent = data.documents.length ? "" : "Документов пока нет. Нажмите «Загрузить большой файл».";
    data.documents.forEach((d) => {
      const ready = d.chunk_count > 0;
      const subtitle = ready
        ? plural(d.pages, PAGES) + " · " + plural(d.chunk_count, PARTS) + " · " + formatDate(d.created_at)
        : "Загружен не полностью — удалите и загрузите снова";
      const buttons = [];
      if (ready) buttons.push(["Выбрать", () => setActiveDoc(d)]);
      buttons.push(["Удалить", (b) => deleteDocument(d, b), "danger"]);
      const item = listItem(d.title, subtitle, buttons);
      if (activeDoc && d.id === activeDoc.id) item.classList.add("active");
      box.appendChild(item);
    });
  } catch (error) {
    msg.textContent = "Не удалось связаться с сервером: " + error.message;
  }
}

async function deleteDocument(doc, button) {
  if (!confirm("Удалить документ «" + doc.title + "»? Его текст будет удалён из аккаунта.")) return;
  button.disabled = true;
  try {
    const response = await apiJson("/documents/" + encodeURIComponent(doc.id), "DELETE");
    if (!response.ok) {
      $("docsMessage").textContent = "Ошибка " + response.status + ": " + (await readError(response));
      button.disabled = false;
      return;
    }
    if (activeDoc && activeDoc.id === doc.id) setActiveDoc(null);
    loadDocuments();
  } catch (error) {
    $("docsMessage").textContent = "Не удалось связаться с сервером: " + error.message;
    button.disabled = false;
  }
}

$("docsBox").addEventListener("toggle", () => {
  if ($("docsBox").open) loadDocuments();
});
