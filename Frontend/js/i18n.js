// Языки интерфейса: русский (ru), казахский (kk), английский (en).
// Подключается в <head> сразу после theme.js: словарь начинает грузиться до отрисовки страницы.
//
// В HTML:
//   data-i18n="ключ"             — текст элемента (если внутри есть иконки, меняется только текст рядом с ними)
//   data-i18n-html="ключ"        — разметка из словаря (только для наших строк со ссылкой или <strong>)
//   data-i18n-placeholder="ключ" — подсказка в поле
//   data-i18n-aria="ключ"        — aria-label
// В JS:
//   t("ключ", {параметры})       — строка из словаря; {count} выбирает форму множественного числа
//   setText(el, "ключ", {...})   — то же, но текст обновится сам при смене языка
//   setLang("kk"), getLang(), getLocale()
(function () {
  const LANGS = ["ru", "kk", "en"];
  const CODES = { ru: "RU", kk: "KZ", en: "EN" }; // подписи на кнопке переключателя
  const LOCALES = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };
  const KEY = "lang";
  const ATTRS = { text: "i18n", html: "i18nHtml", placeholder: "i18nPlaceholder", aria: "i18nAria" };

  const cache = {};       // загруженные словари
  let lang = initialLang();
  let dict = {};
  let fallback = {};      // русский словарь — если в другом языке нет ключа
  const rendered = new WeakMap(); // элемент -> {вид: последнее значение, которое поставили мы}

  function saved() {
    try {
      const value = localStorage.getItem(KEY);
      return LANGS.includes(value) ? value : null;
    } catch (e) {
      return null; // приватный режим или запрещены данные сайта
    }
  }

  // Сохранённый выбор, иначе язык браузера (если он ru/kk/en), иначе русский
  function initialLang() {
    const own = saved();
    if (own) return own;
    for (const tag of navigator.languages || [navigator.language || ""]) {
      const base = String(tag).toLowerCase().split("-")[0];
      if (LANGS.includes(base)) return base;
    }
    return "ru";
  }

  function load(code) {
    if (!cache[code]) {
      cache[code] = fetch("i18n/" + code + ".json")
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .catch((error) => {
          delete cache[code]; // в следующий раз попробуем снова
          throw error;
        });
    }
    return cache[code];
  }

  function lookup(key, params) {
    // {count: 5} -> ключ.one / .few / .many / .other по правилам языка
    if (params && typeof params.count === "number") {
      const form = new Intl.PluralRules(LOCALES[lang]).select(params.count);
      for (const k of [key + "." + form, key + ".other"]) {
        if (typeof dict[k] === "string") return dict[k];
      }
      const ruForm = new Intl.PluralRules("ru-RU").select(params.count);
      for (const k of [key + "." + ruForm, key + ".other"]) {
        if (typeof fallback[k] === "string") return fallback[k];
      }
    }
    if (typeof dict[key] === "string") return dict[key];
    if (typeof fallback[key] === "string") return fallback[key];
    return null;
  }

  function t(key, params) {
    const value = lookup(key, params);
    if (value === null) return key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (m, name) => {
      if (!(name in params)) return m;
      const v = params[name];
      return typeof v === "number" ? v.toLocaleString(LOCALES[lang]) : String(v);
    });
  }

  function hasKey(key) {
    return lookup(key) !== null;
  }

  function readArgs(el) {
    try {
      return el.dataset.i18nArgs ? JSON.parse(el.dataset.i18nArgs) : undefined;
    } catch (e) {
      return undefined;
    }
  }

  // Текстовый узел, который переводим: у элемента с иконками меняем только текст, svg не трогаем
  function textNode(el) {
    if (!el.firstElementChild) return null;
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) return node;
    }
    const node = document.createTextNode("");
    el.appendChild(node);
    return node;
  }

  function current(el, kind) {
    if (kind === "text") {
      const node = textNode(el);
      return node ? node.nodeValue : el.textContent;
    }
    if (kind === "html") return el.innerHTML;
    return el.getAttribute(kind === "aria" ? "aria-label" : "placeholder") || "";
  }

  function put(el, kind, value) {
    if (kind === "text") {
      const node = textNode(el);
      if (node) node.nodeValue = value;
      else el.textContent = value;
    } else if (kind === "html") {
      el.innerHTML = value;
    } else {
      el.setAttribute(kind === "aria" ? "aria-label" : "placeholder", value);
    }
  }

  // force = false: если код уже сам поменял текст элемента (например, поставил название чата),
  // при смене языка его не перезаписываем
  function render(el, kind, force) {
    const key = el.dataset[ATTRS[kind]];
    if (!key) return;
    const memo = rendered.get(el) || {};
    if (!force && memo[kind] !== undefined && memo[kind] !== current(el, kind)) return;
    put(el, kind, t(key, readArgs(el)));
    memo[kind] = current(el, kind);
    rendered.set(el, memo);
  }

  function translate(root) {
    const scope = root || document;
    for (const kind of Object.keys(ATTRS)) {
      const attr = "data-" + ATTRS[kind].replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      if (scope !== document && scope.matches && scope.matches("[" + attr + "]")) render(scope, kind, false);
      scope.querySelectorAll("[" + attr + "]").forEach((el) => render(el, kind, false));
    }
  }

  // Перевод с запоминанием ключа: при смене языка текст обновится сам
  function setI18n(el, kind, key, params) {
    const name = ATTRS[kind];
    if (!key) {
      delete el.dataset[name];
      delete el.dataset.i18nArgs;
      if (kind === "text") el.textContent = "";
      return;
    }
    el.dataset[name] = key;
    if (params) el.dataset.i18nArgs = JSON.stringify(params);
    else delete el.dataset.i18nArgs;
    render(el, kind, true);
  }

  function setText(el, key, params) {
    setI18n(el, "text", key, params);
  }

  function updateSwitchers() {
    document.querySelectorAll(".lang-menu").forEach((menu) => {
      const label = menu.querySelector(".lang-current");
      if (label) label.textContent = CODES[lang];
      menu.querySelectorAll("[data-lang]").forEach((b) => {
        b.setAttribute("aria-checked", String(b.dataset.lang === lang));
      });
    });
  }

  function domReady() {
    return document.readyState === "loading"
      ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }))
      : Promise.resolve();
  }

  async function setLang(next) {
    if (!LANGS.includes(next)) next = "ru";
    let data;
    try {
      data = await load(next);
      if (next !== "ru") fallback = await load("ru").catch(() => ({}));
      else fallback = {};
    } catch (error) {
      console.warn("Не удалось загрузить словарь " + next + ":", error);
      if (next !== "ru") return setLang("ru");
      data = {}; // остаётся русский текст из HTML
    }
    lang = next;
    dict = data;
    document.documentElement.lang = next;
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {
      // не сохранилось — язык всё равно сменится до перезагрузки
    }
    await domReady();
    if (typeof dict["app.title"] === "string") document.title = dict["app.title"];
    translate(document);
    updateSwitchers();
    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
  }

  document.documentElement.lang = lang;
  const ready = setLang(lang);

  // Переключатель языка: <details class="menu lang-menu"> с кнопками data-lang
  domReady().then(() => {
    updateSwitchers();
    document.querySelectorAll(".lang-menu [data-lang]").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest("details").open = false;
        setLang(button.dataset.lang);
      });
    });
  });

  window.t = t;
  window.hasT = hasKey;
  window.setText = setText;
  window.setI18n = setI18n;
  window.translatePage = translate;
  window.setLang = setLang;
  window.getLang = () => lang;
  window.getLocale = () => LOCALES[lang];
  window.i18nReady = ready;
})();
