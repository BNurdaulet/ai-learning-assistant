const material = $("material");

function updateMaterialInfo(extra) {
  const n = material.value.trim().length;
  let text = n === 0 ? "Материал не добавлен." : "Материал: " + n + " символов.";
  if (n > MAX_CHARS) text += " Будут использованы первые " + MAX_CHARS + ".";
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
  $("materialInfo").textContent = "Читаю файл...";

  const form = new FormData();
  form.append("file", file);

  try {
    const response = await apiFetch("/extract", { method: "POST", body: form });
    if (!response.ok) {
      $("materialInfo").textContent = "Ошибка: " + (await readError(response));
    } else {
      const data = await response.json();
      material.value = data.text;
      updateMaterialInfo(data.truncated ? "Файл длинный, взята только первая часть." : "");
    }
  } catch (error) {
    $("materialInfo").textContent = "Не удалось связаться с сервером: " + error.message;
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
    $("materialInfo").textContent = "За один раз можно добавить не больше " + MAX_PHOTOS + " фото.";
    return;
  }

  const button = $("photoBtn");
  button.disabled = true;
  $("materialInfo").textContent = "Распознаю текст на фото (" + files.length + ")...";

  try {
    const form = new FormData();
    for (const file of files) {
      form.append("files", await shrinkPhoto(file), file.name || "photo.jpg");
    }
    const response = await apiFetch("/photo", { method: "POST", body: form });
    if (!response.ok) {
      $("materialInfo").textContent = "Ошибка: " + (await readError(response));
    } else {
      const data = await response.json();
      const current = material.value.trim();
      material.value = current ? current + "\n\n" + data.text : data.text;
      updateMaterialInfo(data.truncated ? "Текста на фото много, взята только первая часть." : "Текст с фото добавлен.");
    }
  } catch (error) {
    $("materialInfo").textContent = "Не удалось связаться с сервером: " + error.message;
  } finally {
    button.disabled = false;
  }
});
