// Удаление аккаунта и всех данных (с подтверждением словом «УДАЛИТЬ»).
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
  if ($("deleteConfirm").value.trim().toUpperCase() !== "УДАЛИТЬ") {
    deleteMessage.textContent = "Введите слово УДАЛИТЬ, чтобы подтвердить.";
    return;
  }

  $("deleteSubmit").disabled = true;
  deleteMessage.textContent = "Удаляю...";
  try {
    const response = await apiJson("/account", "DELETE");
    if (!response.ok) {
      deleteMessage.textContent = "Ошибка " + response.status + ": " + (await readError(response));
      $("deleteSubmit").disabled = false;
      return;
    }
    const data = await response.json();
    deleteDialog.close();
    alert(data.auth_user_deleted
      ? "Аккаунт и все данные удалены."
      : "Все ваши данные удалены. Учётную запись (email) сервер удалить не смог — обратитесь к владельцу сайта.");
    // Сессию стираем только в этом браузере (на сервере пользователя уже может не быть).
    // После выхода страница перезагрузится (см. auth.js).
    await sb.auth.signOut({ scope: "local" });
  } catch (error) {
    deleteMessage.textContent = "Не удалось связаться с сервером: " + error.message;
    $("deleteSubmit").disabled = false;
  }
});
