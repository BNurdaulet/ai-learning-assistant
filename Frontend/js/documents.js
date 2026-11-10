// Большие документы: загрузка с прогрессом, список «Мои документы», выбор активного документа.
// Пока документ выбран, квиз, карточки, конспект и чат отправляют document_id вместо материала.
const MAX_DOC_MB = 20; // столько же ограничивает сервер
let activeDoc = null;  // {id, title, pages, chunk_count} — выбранный документ (только до перезагрузки страницы)

// «1 страница», «3 страницы», «5 страниц» — формы берутся из словаря по правилам языка
function plural(n, key) {
  return t(key, { count: n });
}
const PAGES = "docs.pages";
const PARTS = "docs.parts";

// Подпись «стр. 12–13, 40» из списка источников [{page_start, page_end}]
function formatSources(sources) {
  return t("docs.pagesShort", { list: sources
    .map((s) => (s.page_start === s.page_end ? s.page_start : s.page_start + "–" + s.page_end))
    .join(", ") });
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
    return t("docs.needTopic");
  }
  return "";
}

function setActiveDoc(doc) {
  activeDoc = doc ? { id: doc.id, title: doc.title, pages: doc.pages, chunk_count: doc.chunk_count } : null;
  $("activeDocBox").hidden = !activeDoc;
  material.disabled = !!activeDoc;
  if (activeDoc) {
    $("activeDocTitle").textContent = t("docs.activeTitle", { title: activeDoc.title, pages: plural(activeDoc.pages, PAGES) });
    $("pageFrom").max = activeDoc.pages;
    $("pageTo").max = activeDoc.pages;
    $("pageTo").value = Math.min(activeDoc.pages, Math.max(1, Number($("pageTo").value) || 10));
    $("docPagesHint").textContent = t("docs.totalPages", { pages: plural(activeDoc.pages, PAGES) });
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
    status.textContent = t("docs.tooBig", { max: MAX_DOC_MB });
    return;
  }

  await authReady;
  const { data } = sb ? await sb.auth.getSession() : { data: {} };
  if (!data.session) {
    showAuth("auth.loginRequired");
    return;
  }

  button.disabled = true;
  status.textContent = t("docs.uploading", { percent: 0 });
  const form = new FormData();
  form.append("file", file);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", API_URL + "/documents");
  xhr.setRequestHeader("Authorization", "Bearer " + data.session.access_token);

  xhr.upload.addEventListener("progress", (e) => {
    if (!e.lengthComputable) return;
    const percent = Math.round((e.loaded / e.total) * 100);
    status.textContent = percent < 100
      ? t("docs.uploading", { percent })
      : t("docs.processing");
  });

  xhr.addEventListener("load", async () => {
    button.disabled = false;
    if (xhr.status === 401) showAuth("auth.sessionExpired");
    if (xhr.status !== 200) {
      status.textContent = t("common.errorStatus", { status: xhr.status, message: await readError(new Response(xhr.responseText)) });
      return;
    }
    let doc;
    try {
      doc = JSON.parse(xhr.responseText);
    } catch (error) {
      status.textContent = t("common.badResponse");
      return;
    }
    let text = t("docs.uploaded", { pages: plural(doc.pages, PAGES), parts: plural(doc.chunk_count, PARTS) });
    if (doc.warning) text += " " + noteText(doc.warning);
    status.textContent = text;
    setActiveDoc(doc);
  });

  xhr.addEventListener("error", () => {
    button.disabled = false;
    status.textContent = t("common.noServerShort");
  });

  xhr.send(form);
}

async function loadDocuments() {
  const box = $("docsList");
  const msg = $("docsMessage");
  msg.textContent = t("common.loading");
  try {
    const response = await apiFetch("/documents");
    if (!response.ok) {
      msg.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      return;
    }
    const data = await response.json();
    box.innerHTML = "";
    msg.textContent = data.documents.length ? "" : t("docs.empty");
    data.documents.forEach((d) => {
      const ready = d.chunk_count > 0;
      const subtitle = ready
        ? plural(d.pages, PAGES) + " · " + plural(d.chunk_count, PARTS) + " · " + formatDate(d.created_at)
        : t("docs.incomplete");
      const buttons = [];
      if (ready) buttons.push([t("common.select"), () => setActiveDoc(d)]);
      buttons.push([t("common.delete"), (b) => deleteDocument(d, b), "danger"]);
      const item = listItem(d.title, subtitle, buttons);
      if (activeDoc && d.id === activeDoc.id) item.classList.add("active");
      box.appendChild(item);
    });
  } catch (error) {
    msg.textContent = t("common.noServer", { message: error.message });
  }
}

async function deleteDocument(doc, button) {
  if (!confirm(t("docs.confirmDelete", { title: doc.title }))) return;
  button.disabled = true;
  try {
    const response = await apiJson("/documents/" + encodeURIComponent(doc.id), "DELETE");
    if (!response.ok) {
      $("docsMessage").textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      button.disabled = false;
      return;
    }
    if (activeDoc && activeDoc.id === doc.id) setActiveDoc(null);
    loadDocuments();
  } catch (error) {
    $("docsMessage").textContent = t("common.noServer", { message: error.message });
    button.disabled = false;
  }
}

$("docsBox").addEventListener("toggle", () => {
  if ($("docsBox").open) loadDocuments();
});
