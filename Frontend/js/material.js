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
