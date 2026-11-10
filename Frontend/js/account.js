// Удаление аккаунта и всех данных (с подтверждением словом «УДАЛИТЬ» / «ЖОЮ» / «DELETE» — по языку).
const deleteDialog = $("deleteDialog");
const deleteMessage = $("deleteMessage");

$("deleteAccountBtn").addEventListener("click", () => {
  $("deleteConfirm").value = "";
  deleteMessage.textContent = "";
  $("deleteSubmit").disabled = false;
  deleteDialog.showModal();
});

$("deleteCancel").addEventListener("click", () => deleteDialog.close());

$("deleteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = t("delete.word");
  if ($("deleteConfirm").value.trim().toUpperCase() !== word.toUpperCase()) {
    deleteMessage.textContent = t("delete.wrongWord", { word });
    return;
  }

  $("deleteSubmit").disabled = true;
  deleteMessage.textContent = t("delete.progress");
  try {
    const response = await apiJson("/account", "DELETE");
    if (!response.ok) {
      deleteMessage.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      $("deleteSubmit").disabled = false;
      return;
    }
    const data = await response.json();
    deleteDialog.close();
    alert(data.auth_user_deleted
      ? t("delete.done")
      : t("delete.donePartial"));
    // Сессию стираем только в этом браузере (на сервере пользователя уже может не быть).
    // После выхода страница перезагрузится (см. auth.js).
    await sb.auth.signOut({ scope: "local" });
  } catch (error) {
    deleteMessage.textContent = t("common.noServer", { message: error.message });
    $("deleteSubmit").disabled = false;
  }
});
