const chatLog = $("chatLog");
const chatInput = $("chatInput");
const chatSend = $("chatSend");
// Не называем переменную history: это имя занято встроенным window.history
let chatHistory = [];
let currentSessionId = null; // id сохранённого чата (создаётся при первом сообщении)

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = "bubble " + role;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

// Сохраняет пару «вопрос — ответ» в базу. Ошибка сохранения не мешает чату.
async function saveExchange(question, reply) {
  const note = $("chatSaveNote");
  try {
    if (!currentSessionId) {
      const response = await apiJson("/chats", "POST", { title: question.slice(0, 80), style: $("style").value });
      if (!response.ok) throw new Error(await readError(response));
      const session = await response.json();
      currentSessionId = session.id;
      $("chatTitle").textContent = session.title;
    }
    const response = await apiJson("/chats/" + encodeURIComponent(currentSessionId) + "/messages", "POST", {
      messages: [
        { role: "user", content: question },
        { role: "assistant", content: reply },
      ],
    });
    if (!response.ok) throw new Error(await readError(response));
    note.textContent = "";
    if ($("chatSessionsBox").open) loadChatSessions();
  } catch (error) {
    note.textContent = t("chat.notSaved", { message: error.message });
  }
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  // Команды /квиз, /карточки, /конспект, /план выполняет commands.js (ответ — карточка в ленте)
  if (typeof runCommand === "function" && runCommand(text)) {
    chatInput.value = "";
    return;
  }

  chatInput.value = "";
  chatHistory.push({ role: "user", content: text });
  const userBubble = addBubble("user", text);
  const botBubble = addBubble("assistant", "");
  const stopThinking = startThinking(botBubble);
  chatSend.disabled = true;

  try {
    const response = await apiFetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatHistory,
        material: activeDoc ? "" : material.value.trim(),
        style: $("style").value,
        document_id: activeDoc ? activeDoc.id : null,
        lang: getLang(),
      }),
    });
    if (!response.ok) {
      // Убираем неотправленный вопрос и возвращаем его в поле ввода
      chatHistory.pop();
      userBubble.remove();
      botBubble.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      botBubble.classList.add("error");
      chatInput.value = text;
    } else {
      const data = await response.json();
      renderRich(botBubble, data.reply);
      addSources(botBubble, data);
      chatHistory.push({ role: "assistant", content: data.reply });
      saveExchange(text, data.reply);
    }
  } catch (error) {
    chatHistory.pop();
    userBubble.remove();
    botBubble.textContent = t("common.noServer", { message: error.message });
    botBubble.classList.add("error");
    chatInput.value = text;
  } finally {
    stopThinking();
  }

  chatSend.disabled = false;
  chatLog.scrollTop = chatLog.scrollHeight;
}

// Мелкая подпись под ответом: по каким страницам документа он составлен
function addSources(bubble, data) {
  let text = "";
  if (data.sources && data.sources.length) text = t("chat.sources", { pages: formatSources(data.sources) });
  else if (data.found === false) text = t("chat.notFound");
  if (!text) return;
  const line = document.createElement("div");
  line.className = "sources";
  line.textContent = text;
  bubble.after(line);
}

function newChat() {
  chatHistory = [];
  currentSessionId = null;
  chatLog.innerHTML = "";
  setText($("chatTitle"), "chat.newChat");
  $("chatSaveNote").textContent = "";
}

async function loadChatSessions() {
  const box = $("chatSessions");
  const msg = $("chatSessionsMessage");
  msg.textContent = t("common.loading");
  try {
    const response = await apiFetch("/chats");
    if (!response.ok) {
      msg.textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      return;
    }
    const data = await response.json();
    box.innerHTML = "";
    msg.textContent = data.chats.length ? "" : t("chat.noSaved");
    data.chats.forEach((c) => {
      const item = listItem(c.title, formatDate(c.created_at), [
        [t("common.open"), (b) => openChat(c.id, b)],
        [t("common.delete"), (b) => deleteChat(c.id, c.title, b), "danger"],
      ]);
      if (c.id === currentSessionId) item.classList.add("active");
      box.appendChild(item);
    });
  } catch (error) {
    msg.textContent = t("common.noServer", { message: error.message });
  }
}

async function openChat(id, button) {
  button.disabled = true;
  try {
    const response = await apiFetch("/chats/" + encodeURIComponent(id));
    if (!response.ok) {
      $("chatSessionsMessage").textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      return;
    }
    const session = await response.json();
    newChat();
    currentSessionId = session.id;
    $("chatTitle").textContent = session.title;
    $("style").value = session.style;
    session.messages.forEach((m) => {
      const bubble = addBubble(m.role, m.content);
      if (m.role === "assistant") renderRich(bubble, m.content);
      chatHistory.push({ role: m.role, content: m.content });
    });
    loadChatSessions();
  } catch (error) {
    $("chatSessionsMessage").textContent = t("common.noServer", { message: error.message });
  } finally {
    button.disabled = false;
  }
}

async function deleteChat(id, title, button) {
  if (!confirm(t("chat.confirmDelete", { title }))) return;
  button.disabled = true;
  try {
    const response = await apiJson("/chats/" + encodeURIComponent(id), "DELETE");
    if (!response.ok) {
      $("chatSessionsMessage").textContent = t("common.errorStatus", { status: response.status, message: await readError(response) });
      button.disabled = false;
      return;
    }
    if (id === currentSessionId) newChat();
    loadChatSessions();
  } catch (error) {
    $("chatSessionsMessage").textContent = t("common.noServer", { message: error.message });
    button.disabled = false;
  }
}

chatSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

$("chatReset").addEventListener("click", newChat);
$("chatSessionsBox").addEventListener("toggle", () => {
  if ($("chatSessionsBox").open) loadChatSessions();
});
