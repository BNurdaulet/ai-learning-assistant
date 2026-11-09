const chatLog = $("chatLog");
const chatInput = $("chatInput");
const chatSend = $("chatSend");
let history = [];

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = "bubble " + role;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = "";
  history.push({ role: "user", content: text });
  const userBubble = addBubble("user", text);
  const botBubble = addBubble("assistant", "Думаю...");
  chatSend.disabled = true;

  try {
    const response = await fetch(API_URL + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history,
        material: material.value.trim(),
        style: $("style").value,
      }),
    });
    if (!response.ok) {
      // Убираем неотправленный вопрос и возвращаем его в поле ввода
      history.pop();
      userBubble.remove();
      botBubble.textContent = "Ошибка " + response.status + ": " + (await readError(response));
      botBubble.classList.add("error");
      chatInput.value = text;
    } else {
      const data = await response.json();
      renderRich(botBubble, data.reply);
      history.push({ role: "assistant", content: data.reply });
    }
  } catch (error) {
    history.pop();
    userBubble.remove();
    botBubble.textContent = "Не удалось связаться с сервером: " + error.message;
    botBubble.classList.add("error");
    chatInput.value = text;
  }

  chatSend.disabled = false;
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

$("chatReset").addEventListener("click", () => {
  history = [];
  chatLog.innerHTML = "";
});
