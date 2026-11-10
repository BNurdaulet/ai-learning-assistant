const material = $("material");

function updateMaterialInfo(extra) {
  const n = material.value.trim().length;
  let text = n === 0 ? t("material.none") : t("material.chars", { count: n });
  if (n > MAX_CHARS) text += " " + t("material.firstChars", { max: MAX_CHARS });
  if (extra) text += " " + extra;
  $("materialInfo").textContent = text;
}

material.addEventListener("input", () => updateMaterialInfo());

$("clearMaterial").addEventListener("click", () => {
  material.value = "";
  updateMaterialInfo();
});

$("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("materialInfo").textContent = t("material.reading");

  const form = new FormData();
  form.append("file", file);

  try {
    const response = await apiFetch("/extract", { method: "POST", body: form });
    if (!response.ok) {
      $("materialInfo").textContent = t("common.error", { message: await readError(response) });
    } else {
      const data = await response.json();
      material.value = data.text;
      updateMaterialInfo(data.truncated ? t("material.fileTruncated") : "");
    }
  } catch (error) {
    $("materialInfo").textContent = t("common.noServer", { message: error.message });
  }
  e.target.value = "";
});

// ===== Фото: ИИ распознаёт текст и добавляет его в материал =====
const MAX_PHOTOS = 5;
const PHOTO_MAX_SIDE = 2000; // больше для распознавания текста не нужно

// Уменьшает фото в браузере, чтобы быстрее загружалось.
// Если браузер не умеет открыть формат (например, HEIC в Chrome), отправляем как есть.
async function shrinkPhoto(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch (e) {
    return file;
  }
}

$("photoBtn").addEventListener("click", () => $("photo").click());

$("photo").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  e.target.value = "";
  if (!files.length) return;
  if (files.length > MAX_PHOTOS) {
    $("materialInfo").textContent = t("material.photoLimit", { max: MAX_PHOTOS });
    return;
  }

  const button = $("photoBtn");
  button.disabled = true;
  $("materialInfo").textContent = t("material.photoReading", { count: files.length });

  try {
    const form = new FormData();
    for (const file of files) {
      form.append("files", await shrinkPhoto(file), file.name || "photo.jpg");
    }
    const response = await apiFetch("/photo", { method: "POST", body: form });
    if (!response.ok) {
      $("materialInfo").textContent = t("common.error", { message: await readError(response) });
    } else {
      const data = await response.json();
      const current = material.value.trim();
      material.value = current ? current + "\n\n" + data.text : data.text;
      updateMaterialInfo(data.truncated ? t("material.photoTruncated") : t("material.photoAdded"));
    }
  } catch (error) {
    $("materialInfo").textContent = t("common.noServer", { message: error.message });
  } finally {
    button.disabled = false;
  }
});
