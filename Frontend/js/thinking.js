// Весёлые фразы ожидания, пока ИИ отвечает: «Листаю конспекты…», «Точу карандаши…».
// Фраза меняется каждые ~2,2 с (начинаем со случайной), через 10 с — «Сервер просыпается…».
//
//   const stop = startThinking(statusEl);        // фразы из словаря: thinking.1 … thinking.8
//   try { ... } finally { stop(); }              // и при успехе, и при ошибке, и при отмене (abort)
//
// stop() можно вызывать сколько угодно раз. Он убирает только свои элементы: если в el уже
// записан результат или ошибка, он их не трогает. Если когда-нибудь появится потоковый ответ
// (streaming), вызывайте stop() сразу при получении первого куска текста.
//
// Доступность: у el на время ожидания aria-live="polite". Экранный диктор слышит только первую
// фразу (и один раз — сообщение «Сервер просыпается»): меняющийся видимый текст скрыт от него
// через aria-hidden, а для диктора есть отдельная невидимая строка.
(function () {
  const INTERVAL_MS = 2200;
  const SLOW_AFTER_MS = 10000;
  const PHRASE_COUNT = 8;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function thinkingPhrases() {
    const list = [];
    for (let i = 1; i <= PHRASE_COUNT; i++) list.push(t("thinking." + i));
    return list;
  }

  function startThinking(el, getPhrases = thinkingPhrases) {
    const box = document.createElement("span");
    box.className = "thinking";
    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    const text = document.createElement("span");      // видимая, меняется
    text.className = "thinking-text";
    text.setAttribute("aria-hidden", "true");
    const spoken = document.createElement("span");    // для диктора, меняется не больше двух раз
    spoken.className = "visually-hidden";
    box.append(dots, text, spoken);

    const previousLive = el.getAttribute("aria-live");
    el.setAttribute("aria-live", "polite");
    el.textContent = "";
    el.appendChild(box);

    let stopped = false;
    let slow = false;
    let index = -1;

    function phrases() {
      const list = (getPhrases() || []).filter(Boolean);
      return list.length ? list : [""];
    }

    function current() {
      if (slow) return t("thinking.slow");
      const list = phrases();
      return list[((index % list.length) + list.length) % list.length];
    }

    function show(value) {
      // В el уже записали результат или ошибку — фразы больше не нужны
      if (box.parentNode !== el) {
        stop();
        return;
      }
      text.textContent = value;
      if (!reduceMotion.matches) {
        text.classList.remove("is-in");
        void text.offsetWidth; // перезапуск анимации появления
        text.classList.add("is-in");
      }
    }

    index = Math.floor(Math.random() * phrases().length);
    show(current());
    // Чуть позже, чем включили aria-live: иначе часть дикторов не замечает первую фразу
    const firstPhrase = current();
    const announceTimer = setTimeout(() => (spoken.textContent = firstPhrase), 100);

    const timer = setInterval(() => {
      if (slow) return;
      index++; // по кругу, без повтора одной фразы два раза подряд
      show(current());
    }, INTERVAL_MS);

    const slowTimer = setTimeout(() => {
      slow = true;
      show(current());
      spoken.textContent = current(); // одно объявление: ждать дольше обычного
    }, SLOW_AFTER_MS);

    // Сменили язык во время ожидания — сразу показываем фразу на новом языке
    const onLang = () => show(current());
    document.addEventListener("langchange", onLang);

    function stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clearTimeout(slowTimer);
      clearTimeout(announceTimer);
      document.removeEventListener("langchange", onLang);
      if (box.parentNode === el) box.remove();
      if (previousLive === null) el.removeAttribute("aria-live");
      else el.setAttribute("aria-live", previousLive);
    }
    return stop;
  }

  window.startThinking = startThinking;
  window.thinkingPhrases = thinkingPhrases;
})();
