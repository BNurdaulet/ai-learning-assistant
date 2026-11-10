// Оформление главной: навигация, меню аккаунта, окна материала, плашка материала в шапке.
// Только внешний вид: кнопки здесь нажимают уже существующие вкладки и кнопки загрузки,
// логика чата, загрузки и генерации остаётся в chat.js, material.js, documents.js и т.д.

// Переход в раздел — нажатие на скрытую вкладку (её обработчик в tabs.js)
function goTo(panel) {
  document.querySelector('.tab[data-panel="' + panel + '"]').click();
  window.scrollTo(0, 0);
}

function closeMenus() {
  document.querySelectorAll("details.menu[open]").forEach((d) => (d.open = false));
}
function closeSheets() {
  document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close());
}
function openSheet(dialog) {
  if (!dialog.open) dialog.showModal();
}

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => {
    closeMenus();
    closeSheets();
    goTo(button.dataset.go);
  });
});

// Загрузка материала: нажимаем старые кнопки и поля выбора файла.
// Окно закрываем ДО нажатия, чтобы браузер открыл выбор файла (пока окно открыто, всё вокруг неактивно).
const UPLOAD_ACTIONS = {
  file: () => $("file").click(),
  photo: () => $("photoBtn").click(),
  book: () => $("docUploadBtn").click(),
  text: () => {
    openSheet($("materialDialog"));
    if (!$("material").disabled) $("material").focus();
  },
  docs: () => {
    openSheet($("materialDialog"));
    $("docsBox").open = true; // откроет список (обработчик toggle в documents.js)
  },
};
document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    closeMenus();
    if ($("attachSheet").open) $("attachSheet").close();
    UPLOAD_ACTIONS[button.dataset.action]();
  });
});

$("attachBtn").addEventListener("click", () => openSheet($("attachSheet")));

// Окна закрываются крестиком и нажатием на затемнённый фон
document.querySelectorAll("dialog.sheet").forEach((dialog) => {
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
});
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

// Меню аккаунта: закрываем по клику снаружи и после выбора пункта
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.menu[open]").forEach((d) => {
    if (!d.contains(e.target)) d.open = false;
  });
});
document.querySelectorAll(".menu-pop button").forEach((b) => b.addEventListener("click", closeMenus));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenus();
});

// Буква на аватаре — первая буква email
new MutationObserver(() => {
  const email = $("userEmail").textContent.trim();
  $("avatarLetter").textContent = email ? email[0].toUpperCase() : "?";
}).observe($("userEmail"), { childList: true, characterData: true, subtree: true });

// «Недавние чаты» на главной: после входа раскрываем список (загрузку делает chat.js по событию toggle)
loginHooks.push(() => {
  $("chatSessionsBox").open = true;
});

// ----- Плашка «Материал: …» в шапке -----
let materialName = "";  // название того, что сейчас в поле «Материал»
let pendingName = null; // {name, before}: файл выбран, ждём, пока текст появится в поле

// Слушаем на этапе перехвата: material.js очищает поле выбора файла сразу в своём обработчике
document.addEventListener("change", (e) => {
  const input = e.target;
  if ((input.id === "file" || input.id === "photo") && input.files.length) {
    const name = input.id === "file" ? input.files[0].name : "Фото конспекта";
    pendingName = { name, before: $("material").value };
  }
}, true);

$("material").addEventListener("input", () => {
  pendingName = null;
  if (!materialName) materialName = "свой текст";
  updateMaterialChip();
});

function updateMaterialChip() {
  const text = $("material").value.trim();
  if (pendingName && $("material").value !== pendingName.before) {
    materialName = pendingName.name;
    pendingName = null;
  }
  if (!text) materialName = "";

  let label = "";
  if (typeof activeDoc !== "undefined" && activeDoc) label = activeDoc.title;
  else if (text) label = materialName || "свой текст";

  $("materialChipName").textContent = label;
  $("materialChip").hidden = !label;
  $("materialChip").title = label ? "Материал: " + label : "";
}

// Строка «Материал не добавлен.» под полем ввода не нужна — показываем только полезные статусы
function syncMaterialStatus() {
  const info = $("materialInfo");
  info.hidden = info.textContent.trim() === "Материал не добавлен.";
  updateMaterialChip();
}
new MutationObserver(syncMaterialStatus)
  .observe($("materialInfo"), { childList: true, characterData: true, subtree: true });
new MutationObserver(updateMaterialChip)
  .observe($("activeDocBox"), { attributes: true, attributeFilter: ["hidden"] });
new MutationObserver(updateMaterialChip)
  .observe($("activeDocTitle"), { childList: true, characterData: true, subtree: true });
syncMaterialStatus();

// На телефоне поле ввода в одну строку — подсказка короче
const longPlaceholder = $("chatInput").placeholder;
const phone = window.matchMedia("(max-width: 700px)");
function syncPlaceholder() {
  $("chatInput").placeholder = phone.matches ? "Спроси или набери /" : longPlaceholder;
}
phone.addEventListener("change", syncPlaceholder);
syncPlaceholder();
