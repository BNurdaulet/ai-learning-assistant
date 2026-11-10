// «Задания»: учитель создаёт квиз, карточки или конспект, проверяет, публикует и получает ссылку
// для ученика (/a/<код>). Здесь же «Мои задания» и результаты учеников (таблица, подробности, CSV).
//
// Генерация — те же маршруты, что и на главной (/generate, /flashcards, /study) и тот же материал
// (окно «Материал», большой документ). Ученик потом ничего не генерирует: содержимое хранится в задании.
// Безопасность: имя ученика и всё из базы — только textContent; текст ИИ — только renderRich.
(function () {
  const TYPE_KEYS = { quiz: "tool.quiz", flashcards: "tool.cards", summary: "tool.summary" };
  const COUNT = {
    quiz: { label: "quiz.countLabel", max: 20, value: 5 },
    flashcards: { label: "cards.countLabel", max: 30, value: 10 },
  };

  let type = "quiz";
  let draft = null;        // сгенерированное, но ещё не опубликованное задание
  let retentionDays = 0;

  // ---------- Общие мелочи ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    const b = el("button", className, label);
    b.type = "button";
    b.addEventListener("click", () => onClick(b));
    return b;
  }

  function studentLink(code) {
    // На порту 5500 (Live Server) страница ученика есть только у бэкенда
    return (API_URL || location.origin) + "/a/" + encodeURIComponent(code);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Запасной способ, если clipboard API недоступен (например, не https)
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  }

  function langName(code) {
    return code ? t("lang.name." + code) : "";
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return "—";
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return t("asg.durationSec", { sec: s });
    return t("asg.duration", { min: Math.floor(s / 60), sec: s % 60 });
  }

  async function failText(response) {
    return t("common.errorStatus", { status: response.status, message: await readError(response) });
  }

  // ---------- Вкладки «Создать» / «Мои задания» ----------

  function showView(id) {
    document.querySelectorAll("[data-asg-view]").forEach((tab) => {
      const active = tab.dataset.asgView === id;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $("asgCreate").hidden = id !== "asgCreate";
    $("asgList").hidden = id !== "asgList";
    $("asgResults").hidden = id !== "asgResults";
    if (id === "asgList") loadAssignments();
  }

  document.querySelectorAll("[data-asg-view]").forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.asgView));
  });

  // Раздел открыт (из шапки или меню) — обновляем подпись материала
  document.querySelector('.tab[data-panel="assignmentsPanel"]').addEventListener("click", () => {
    updateMaterialNote();
    if (!$("asgList").hidden) loadAssignments();
  });

  // ---------- Создание: тип, количество, язык ----------

  function setType(next) {
    type = next;
    document.querySelectorAll("[data-asg-type]").forEach((b) => {
      const active = b.dataset.asgType === type;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    const count = COUNT[type];
    $("asgCountBox").hidden = !count;
    $("asgDifficultyBox").hidden = type !== "quiz";
    if (count) {
      setText($("asgCountLabel"), count.label);
      $("asgCount").max = count.max;
      $("asgCount").value = count.value;
    }
  }
  document.querySelectorAll("[data-asg-type]").forEach((b) => {
    b.addEventListener("click", () => setType(b.dataset.asgType));
  });

  // Язык содержимого по умолчанию — язык интерфейса
  $("asgLang").value = getLang();
  document.addEventListener("langchange", () => {
    if (!draft) $("asgLang").value = getLang();
    updateMaterialNote();
  });

  // Подпись «Материал: …» — тот же материал, что на главной (окно «Материал» или большой документ)
  function updateMaterialNote() {
    const text = material.value.trim();
    if (activeDoc) setText($("asgMaterialInfo"), "asg.materialDoc", { title: activeDoc.title });
    else if (text) setText($("asgMaterialInfo"), "asg.materialOwn", { chars: text.length });
    else setText($("asgMaterialInfo"), "asg.materialNone");
  }
  // Материал меняется в других модулях (файл, фото, документ) — следим за их подписями
  const watch = new MutationObserver(updateMaterialNote);
  watch.observe($("materialInfo"), { childList: true, characterData: true, subtree: true });
  watch.observe($("activeDocBox"), { attributes: true, attributeFilter: ["hidden"] });
  material.addEventListener("input", updateMaterialNote);
  $("materialDialog").addEventListener("close", updateMaterialNote);

  // ---------- Генерация ----------

  $("asgGenerate").addEventListener("click", generate);

  async function generate() {
    const status = $("asgMessage");
    const topic = $("asgTopic").value.trim();
    const materialText = activeDoc ? "" : material.value.trim();
    if (!activeDoc && !topic && !materialText) {
      status.textContent = t("common.needSource");
      return;
    }
    if (activeDoc && $("docScope").value === "topic" && !topic) {
      status.textContent = t("docs.needTopic");
      return;
    }

    const contentLang = $("asgLang").value;
    const count = COUNT[type]
      ? Math.max(1, Math.min(COUNT[type].max, Math.floor(Number($("asgCount").value)) || COUNT[type].value))
      : 0;
    const base = { topic, material: materialText, ...docParams(), lang: contentLang };
    const request = {
      quiz: ["/generate", { ...base, count, difficulty: $("asgDifficulty").value }],
      flashcards: ["/flashcards", { ...base, count }],
      summary: ["/study", { ...base, kind: "summary" }],
    }[type];

    $("asgGenerate").disabled = true;
    $("asgPublished").hidden = true;
    $("asgPreview").innerHTML = "";
    draft = null;
    status.textContent = t("asg.generating");
    try {
      const response = await apiJson(request[0], "POST", request[1]);
      if (!response.ok) {
        status.textContent = await failText(response);
        return;
      }
      const data = await response.json();
      status.textContent = noteText(data.note);
      draft = {
        type,
        contentLang,
        difficulty: type === "quiz" ? $("asgDifficulty").value : "",
        title: $("asgTitle").value.trim() || topic || (activeDoc ? activeDoc.title : ""),
        items: type === "quiz" ? data.questions : type === "flashcards" ? data.cards : null,
        text: type === "summary" ? data.text : "",
      };
      renderPreview();
    } catch (error) {
      status.textContent = t("common.noServer", { message: error.message });
    } finally {
      $("asgGenerate").disabled = false;
    }
  }

  // ---------- Предпросмотр ----------

  function renderPreview() {
    const box = $("asgPreview");
    box.innerHTML = "";
    if (!draft) return;

    const card = el("div", "card asg-preview");
    const head = el("div", "tool-head");
    head.append(
      el("span", "tool-tag", t(TYPE_KEYS[draft.type]) + (draft.title ? " · " + draft.title : "")),
      el("span", "tool-counter", draft.items
        ? t(draft.type === "quiz" ? "asg.questions" : "asg.cards", { count: draft.items.length })
        : langName(draft.contentLang)),
    );
    card.append(head, el("h3", "", t("asg.previewTitle")), el("p", "hint", t("asg.previewHint")));

    const content = el("div", "asg-preview-body");
    content.lang = draft.contentLang; // содержимое — на языке генерации, показываем как есть

    if (draft.type === "summary") {
      const body = el("div", "rich");
      renderRich(body, draft.text, false);
      content.appendChild(body);
    } else {
      draft.items.forEach((item, i) => content.appendChild(previewItem(item, i)));
    }
    card.appendChild(content);

    const empty = draft.items && draft.items.length === 0;
    const publish = button(t("asg.publish"), "primary", publishDraft);
    publish.disabled = empty;
    card.appendChild(publish);
    if (empty) card.appendChild(el("p", "hint", t("asg.emptyPreview")));
    box.appendChild(card);
  }

  function previewItem(item, index) {
    const row = el("div", "asg-item");
    const top = el("div", "asg-item-head");
    const title = el("div", "asg-item-title");
    const num = el("span", "asg-num", index + 1 + ". ");
    const text = el("span");
    renderRich(text, draft.type === "quiz" ? item.question : item.front, true);
    title.append(num, text);
    const remove = button(t("asg.remove"), "btn-soft asg-remove", () => {
      draft.items.splice(index, 1);
      renderPreview();
    });
    remove.setAttribute("aria-label", t("asg.remove") + " " + (index + 1));
    top.append(title, remove);
    row.appendChild(top);

    if (draft.type === "quiz") {
      const list = el("ol", "asg-options");
      list.type = "A";
      item.options.forEach((option, k) => {
        const li = el("li", k === item.correct_index ? "is-correct" : "");
        const label = el("span");
        renderRich(label, option, true);
        li.appendChild(label);
        if (k === item.correct_index) li.appendChild(el("span", "asg-badge is-ok", t("asg.correctMark")));
        list.appendChild(li);
      });
      row.appendChild(list);
      if (item.explanation) {
        const exp = el("div", "hint");
        renderRich(exp, item.explanation, true);
        row.appendChild(exp);
      }
    } else {
      const back = el("div", "asg-card-back");
      renderRich(back, item.back, true);
      row.appendChild(back);
    }
    return row;
  }

  // ---------- Публикация ----------

  async function publishDraft(btn) {
    if (!draft) return;
    btn.disabled = true;
    const status = $("asgMessage");
    status.textContent = t("asg.publishing");
    const body = {
      type: draft.type,
      title: draft.title,
      content_lang: draft.contentLang,
      difficulty: draft.difficulty,
      questions: draft.type === "quiz" ? draft.items : [],
      cards: draft.type === "flashcards" ? draft.items : [],
      text: draft.text,
    };
    try {
      const response = await apiJson("/assignments", "POST", body);
      if (!response.ok) {
        status.textContent = await failText(response);
        btn.disabled = false;
        return;
      }
      const created = await response.json();
      draft = null;
      status.textContent = "";
      $("asgPreview").innerHTML = "";
      $("asgLink").value = studentLink(created.code);
      $("asgCopyStatus").textContent = "";
      $("asgPublished").hidden = false;
      $("asgCopyLink").focus();
    } catch (error) {
      status.textContent = t("common.noServer", { message: error.message });
      btn.disabled = false;
    }
  }

  $("asgCopyLink").addEventListener("click", async () => {
    await copyText($("asgLink").value);
    setText($("asgCopyStatus"), "asg.copied");
  });
  $("asgLink").addEventListener("focus", () => $("asgLink").select());

  $("asgAnother").addEventListener("click", () => {
    $("asgPublished").hidden = true;
    $("asgTitle").value = "";
    $("asgTopic").focus();
  });

  // ---------- Мои задания ----------

  async function loadAssignments() {
    const message = $("asgListMessage");
    const list = $("asgItems");
    message.textContent = t("common.loading");
    try {
      const response = await apiFetch("/assignments");
      if (!response.ok) {
        message.textContent = await failText(response);
        return;
      }
      const data = await response.json();
      retentionDays = data.retention_days || 0;
      list.innerHTML = "";
      message.textContent = data.assignments.length ? "" : t("asg.empty");
      data.assignments.forEach((a) => list.appendChild(assignmentItem(a)));
      $("asgRetention").textContent = retentionDays > 0 && data.assignments.length
        ? t("asg.retention", { days: retentionDays }) : "";
    } catch (error) {
      message.textContent = t("common.noServer", { message: error.message });
    }
  }

  function assignmentSubtitle(a) {
    return [
      t(TYPE_KEYS[a.type]),
      a.content_lang ? t("asg.langShort", { lang: langName(a.content_lang) }) : "",
      formatDate(a.created_at),
      t("asg.attempts", { count: a.attempt_count || 0 }),
      a.is_open ? t("asg.statusOpen") : t("asg.statusClosed"),
    ].filter(Boolean).join(" · ");
  }

  function assignmentItem(a) {
    const item = listItem(a.title || t("asg.untitled"), assignmentSubtitle(a), [
      [t("asg.results"), () => openResults(a.id)],
      [t("asg.copyLink"), (b) => copyLinkButton(a.code, b)],
      [a.is_open ? t("asg.close") : t("asg.reopen"), (b) => toggleOpen(a, b)],
      [t("common.delete"), (b) => deleteAssignment(a, b), "danger"],
    ]);
    if (!a.is_open) item.classList.add("is-closed");
    return item;
  }

  async function copyLinkButton(code, b) {
    await copyText(studentLink(code));
    const label = b.textContent;
    b.textContent = t("asg.copied");
    setTimeout(() => (b.textContent = label), 1500);
  }

  async function toggleOpen(a, b) {
    b.disabled = true;
    try {
      const response = await apiJson("/assignments/" + encodeURIComponent(a.id), "PATCH", { is_open: !a.is_open });
      if (!response.ok) {
        $("asgListMessage").textContent = await failText(response);
        b.disabled = false;
        return;
      }
      loadAssignments();
    } catch (error) {
      $("asgListMessage").textContent = t("common.noServer", { message: error.message });
      b.disabled = false;
    }
  }

  async function deleteAssignment(a, b) {
    if (!confirm(t("asg.confirmDelete", { title: a.title || t("asg.untitled") }))) return;
    b.disabled = true;
    try {
      const response = await apiJson("/assignments/" + encodeURIComponent(a.id), "DELETE");
      if (!response.ok) {
        $("asgListMessage").textContent = await failText(response);
        b.disabled = false;
        return;
      }
      loadAssignments();
    } catch (error) {
      $("asgListMessage").textContent = t("common.noServer", { message: error.message });
      b.disabled = false;
    }
  }

  // ---------- Результаты ----------

  async function openResults(id) {
    const box = $("asgResults");
    box.innerHTML = "";
    const message = el("div", "message", t("common.loading"));
    box.appendChild(message);
    $("asgCreate").hidden = true;
    $("asgList").hidden = true;
    box.hidden = false;
    window.scrollTo(0, 0);
    try {
      const response = await apiFetch("/assignments/" + encodeURIComponent(id) + "/results");
      if (!response.ok) {
        message.textContent = await failText(response);
        box.prepend(backButton());
        return;
      }
      renderResults(await response.json());
    } catch (error) {
      message.textContent = t("common.noServer", { message: error.message });
      box.prepend(backButton());
    }
  }

  function backButton() {
    const back = button("", "btn-soft asg-back-btn", () => showView("asgList"));
    back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    back.appendChild(document.createTextNode(t("asg.back")));
    return back;
  }

  function statusText(kind, attempt) {
    if (kind === "summary") return t("csv.status.read");
    return attempt.completed ? t("csv.status.done") : t("csv.status.partial");
  }

  function scoreText(kind, attempt) {
    const answers = attempt.answers || {};
    if (kind === "quiz") return attempt.total ? attempt.score + " / " + attempt.total : "—";
    if (kind === "flashcards") return (answers.known || []).length + " / " + (answers.repeat || []).length;
    return "";
  }

  function renderResults({ assignment, attempts }) {
    const kind = assignment.type;
    const box = $("asgResults");
    box.innerHTML = "";
    box.appendChild(backButton());

    // Шапка: название, тип, статус, кнопки
    const card = el("div", "card");
    const head = el("div", "tool-head");
    head.append(
      el("span", "tool-tag", t(TYPE_KEYS[kind])),
      el("span", "asg-badge " + (assignment.is_open ? "is-ok" : ""), assignment.is_open ? t("asg.statusOpen") : t("asg.statusClosed")),
    );
    const title = el("h3", "asg-results-title", assignment.title || t("asg.untitled"));
    const meta = [formatDate(assignment.created_at), t("asg.attempts", { count: attempts.length })];
    if (assignment.content_lang) meta.splice(1, 0, t("asg.langShort", { lang: langName(assignment.content_lang) }));
    if (kind === "quiz" && attempts.length) {
      const sum = attempts.reduce((acc, a) => acc + (a.total ? a.score / a.total : 0), 0);
      meta.push(t("asg.average", { percent: Math.round((100 * sum) / attempts.length) }));
    }
    const actions = el("div", "row");
    actions.append(
      button(t("asg.downloadCsv"), "btn-primary", (b) => downloadCsv(assignment, b, status)),
      button(t("asg.copyLink"), "btn-soft", (b) => copyLinkButton(assignment.code, b)),
    );
    card.append(head, title, el("p", "hint", meta.join(" · ")), actions);
    box.appendChild(card);

    const status = el("div", "message", "");
    status.setAttribute("role", "status");
    box.appendChild(status);

    if (!attempts.length) {
      box.appendChild(el("p", "hint", t("asg.noAttempts")));
      return;
    }

    // Таблица попыток. На телефоне строки становятся карточками (подписи из data-label).
    const wrap = el("div", "asg-table-wrap");
    const table = el("table", "asg-table");
    const columns = [
      ["name", t("asg.col.name")],
      ["status", t("asg.col.status")],
      ...(kind === "quiz" ? [["score", t("asg.col.score")]] : []),
      ...(kind === "flashcards" ? [["score", t("asg.col.cards")]] : []),
      ["date", t("asg.col.date")],
      ["duration", t("asg.col.duration")],
      ["actions", t("asg.col.actions")],
    ];
    const thead = el("thead");
    const headRow = el("tr");
    columns.forEach(([, label]) => {
      const th = el("th", "", label);
      th.scope = "col";
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    const tbody = el("tbody");

    attempts.forEach((attempt) => {
      const row = el("tr");
      const detailRow = el("tr", "asg-detail-row");
      detailRow.hidden = true;
      const detailCell = el("td");
      detailCell.colSpan = columns.length;
      detailRow.appendChild(detailCell);

      const values = {
        name: attempt.student_name,
        status: statusText(kind, attempt),
        score: scoreText(kind, attempt),
        date: formatDate(attempt.created_at),
        duration: formatDuration(attempt.duration_seconds),
      };
      columns.forEach(([key, label]) => {
        const td = el("td");
        td.dataset.label = label;
        if (key === "actions") {
          const more = button(t("asg.details"), "btn-soft", () => {
            detailRow.hidden = !detailRow.hidden;
            more.textContent = detailRow.hidden ? t("asg.details") : t("asg.hideDetails");
            more.setAttribute("aria-expanded", String(!detailRow.hidden));
            if (!detailRow.hidden && !detailCell.firstChild) {
              detailCell.appendChild(attemptDetails(assignment, attempt));
            }
          });
          more.setAttribute("aria-expanded", "false");
          const del = button(t("common.delete"), "danger", (b) => deleteAttempt(assignment.id, attempt, b, status));
          td.append(more, del);
          td.className = "asg-actions";
        } else {
          td.textContent = values[key]; // имя ученика — только как текст
          if (key === "name") td.className = "asg-name";
        }
        row.appendChild(td);
      });
      tbody.append(row, detailRow);
    });
    table.append(thead, tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
  }

  // Подробности попытки: каждый вопрос, ответ ученика, правильный ответ
  function attemptDetails(assignment, attempt) {
    const kind = assignment.type;
    const payload = assignment.payload || {};
    const answers = attempt.answers || {};
    const box = el("div", "asg-details");

    if (kind === "quiz") {
      const choices = answers.choices || [];
      (payload.questions || []).forEach((q, i) => {
        const chosen = choices[i];
        const ok = chosen === q.correct_index;
        const item = el("div", "asg-detail-item");
        const head = el("div", "asg-item-head");
        const question = el("div", "asg-item-title");
        if (assignment.content_lang) question.lang = assignment.content_lang;
        const text = el("span");
        renderRich(text, q.question, true);
        question.append(el("span", "asg-num", i + 1 + ". "), text);
        head.append(question, el("span", "asg-badge " + (ok ? "is-ok" : "is-bad"), ok ? t("asg.right") : t("asg.wrong")));
        item.appendChild(head);
        item.appendChild(answerLine(t("asg.studentAnswer"), chosen === null || chosen === undefined ? null : q.options[chosen], ok ? "is-ok" : "is-bad", assignment.content_lang));
        if (!ok) item.appendChild(answerLine(t("asg.correctAnswer"), q.options[q.correct_index], "is-ok", assignment.content_lang));
        box.appendChild(item);
      });
    } else if (kind === "flashcards") {
      const repeat = answers.repeat || [];
      box.appendChild(el("p", "", t("asg.cardsSummary", { known: (answers.known || []).length, repeat: repeat.length })));
      if (repeat.length) {
        box.appendChild(el("p", "hint", t("asg.repeatList")));
        const list = el("ul", "asg-repeat");
        if (assignment.content_lang) list.lang = assignment.content_lang;
        repeat.forEach((i) => {
          const card = (payload.cards || [])[i];
          if (!card) return;
          const li = el("li");
          const front = el("strong");
          renderRich(front, card.front, true);
          const back = el("span");
          renderRich(back, card.back, true);
          li.append(front, document.createTextNode(" — "), back);
          list.appendChild(li);
        });
        box.appendChild(list);
      }
    } else {
      box.appendChild(el("p", "", t("asg.readIn", { time: formatDuration(attempt.duration_seconds) })));
    }
    return box;
  }

  function answerLine(label, value, kindClass, lang) {
    const line = el("div", "asg-answer " + kindClass);
    line.appendChild(el("strong", "", label));
    const text = el("span");
    if (value === null || value === undefined) {
      text.textContent = t("asg.noAnswer");
    } else {
      if (lang) text.lang = lang;
      renderRich(text, value, true);
    }
    line.appendChild(text);
    return line;
  }

  async function deleteAttempt(assignmentId, attempt, b, status) {
    if (!confirm(t("asg.confirmDeleteAttempt", { name: attempt.student_name }))) return;
    b.disabled = true;
    try {
      const response = await apiJson("/attempts/" + encodeURIComponent(attempt.id), "DELETE");
      if (!response.ok) {
        status.textContent = await failText(response);
        b.disabled = false;
        return;
      }
      openResults(assignmentId);
    } catch (error) {
      status.textContent = t("common.noServer", { message: error.message });
      b.disabled = false;
    }
  }

  // CSV скачиваем через fetch (нужен токен), затем сохраняем как файл
  async function downloadCsv(assignment, b, status) {
    b.disabled = true;
    try {
      const path = "/assignments/" + encodeURIComponent(assignment.id) + "/results.csv?lang=" + encodeURIComponent(getLang());
      const response = await apiFetch(path);
      if (!response.ok) {
        status.textContent = await failText(response);
        return;
      }
      status.textContent = "";
      const blob = await response.blob();
      const match = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = match ? match[1] : "results.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
      status.textContent = t("common.noServer", { message: error.message });
    } finally {
      b.disabled = false;
    }
  }

  setType("quiz");
  i18nReady.then(updateMaterialNote);
})();
