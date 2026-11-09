// Вход и регистрация через Supabase Auth (email + пароль).
// Сессию хранит сама библиотека supabase-js (в браузере). Токен к нашим запросам добавляет apiFetch (common.js).
let authMode = "login"; // "login" или "register"
let currentUserId = null;
const authMsg = $("authMessage");

const AUTH_ERRORS = {
  invalid_credentials: "Неверный email или пароль.",
  email_not_confirmed: "Email не подтверждён. Откройте письмо и перейдите по ссылке.",
  user_already_exists: "Пользователь с таким email уже зарегистрирован.",
  email_exists: "Пользователь с таким email уже зарегистрирован.",
  weak_password: "Слишком простой пароль. Используйте не меньше 8 символов, буквы и цифры.",
  same_password: "Новый пароль должен отличаться от старого.",
  email_address_invalid: "Некорректный email.",
  validation_failed: "Проверьте правильность email и пароля.",
  over_email_send_rate_limit: "Слишком много писем. Подождите немного и попробуйте снова.",
  over_request_rate_limit: "Слишком много попыток. Подождите немного и попробуйте снова.",
  signup_disabled: "Регистрация сейчас отключена.",
  otp_expired: "Ссылка из письма устарела или уже использована. Запросите новую.",
};

function authErrorText(error) {
  if (!error) return "";
  if (AUTH_ERRORS[error.code]) return AUTH_ERRORS[error.code];
  if (error.status === 429) return AUTH_ERRORS.over_request_rate_limit;
  if (error.name === "AuthRetryableFetchError") return "Нет связи с сервером входа. Проверьте интернет.";
  return "Ошибка входа: " + (error.message || "неизвестная ошибка");
}

// Показывает экран входа и прячет приложение
function showAuth(text) {
  $("app").hidden = true;
  $("authScreen").hidden = false;
  $("resetForm").hidden = true;
  $("authForm").hidden = false;
  authMsg.textContent = text || "";
}

function showApp(session) {
  $("authScreen").hidden = true;
  $("app").hidden = false;
  $("userEmail").textContent = session.user.email || "";
  if (currentUserId !== session.user.id) {
    currentUserId = session.user.id;
    loginHooks.forEach((hook) => hook());
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const register = mode === "register";
  $("authModeLogin").classList.toggle("active", !register);
  $("authModeRegister").classList.toggle("active", register);
  $("registerOnly").hidden = !register;
  $("authSubmit").textContent = register ? "Зарегистрироваться" : "Войти";
  $("authPassword").autocomplete = register ? "new-password" : "current-password";
  authMsg.textContent = "";
}

// Адрес, куда Supabase вернёт пользователя из письма (эта же страница)
function redirectUrl() {
  return window.location.origin + window.location.pathname;
}

// Ошибка из ссылки в письме (например, ссылка устарела) приходит в адресе после #
function readUrlError() {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
  const code = params.get("error_code") || params.get("error");
  if (!code) return "";
  window.history.replaceState(null, "", redirectUrl());
  return AUTH_ERRORS[code] || "Не удалось подтвердить ссылку из письма. Попробуйте ещё раз.";
}

async function initAuth() {
  const urlError = readUrlError();
  try {
    const response = await fetch(API_URL + "/config");
    if (!response.ok) throw new Error(await readError(response));
    const config = await response.json();
    sb = supabase.createClient(config.supabase_url, config.supabase_anon_key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (error) {
    resolveAuthReady();
    showAuth("Вход недоступен: " + error.message);
    $("authSubmit").disabled = true;
    return;
  }

  sb.auth.onAuthStateChange((event, session) => {
    // Внутри этого обработчика нельзя ждать (await) другие вызовы supabase — только обновляем экран
    if (event === "PASSWORD_RECOVERY") {
      $("app").hidden = true;
      $("authScreen").hidden = false;
      $("authForm").hidden = true;
      $("resetForm").hidden = false;
      authMsg.textContent = "Придумайте новый пароль.";
      return;
    }
    if (event === "SIGNED_OUT") {
      // Перезагрузка стирает с экрана все данные прошлого пользователя
      if (currentUserId) window.location.reload();
      else showAuth(urlError);
      return;
    }
    if (session && $("resetForm").hidden) {
      if (window.location.hash.includes("access_token")) window.history.replaceState(null, "", redirectUrl());
      showApp(session);
    } else if (!session) {
      showAuth(urlError);
    }
  });

  resolveAuthReady();
  const { data } = await sb.auth.getSession();
  if (!data.session) showAuth(urlError);
}

$("authModeLogin").addEventListener("click", () => setAuthMode("login"));
$("authModeRegister").addEventListener("click", () => setAuthMode("register"));

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sb) return;
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    authMsg.textContent = "Введите корректный email.";
    return;
  }
  if (password.length < 8) {
    authMsg.textContent = "Пароль должен быть не короче 8 символов.";
    return;
  }

  if (authMode === "register") {
    if (password !== $("authPassword2").value) {
      authMsg.textContent = "Пароли не совпадают.";
      return;
    }
    if (!$("authConsent").checked) {
      authMsg.textContent = "Чтобы зарегистрироваться, отметьте согласие с политикой конфиденциальности.";
      return;
    }
  }

  $("authSubmit").disabled = true;
  authMsg.textContent = "Подождите...";

  if (authMode === "register") {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl() },
    });
    if (error) {
      authMsg.textContent = authErrorText(error);
    } else if (!data.session) {
      // Нужно подтверждение почты. Не говорим, существует ли уже такой адрес.
      setAuthMode("login");
      authMsg.textContent = "Письмо отправлено на " + email + ". Подтвердите адрес по ссылке, затем войдите.";
    }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) authMsg.textContent = authErrorText(error);
  }

  $("authPassword").value = "";
  $("authPassword2").value = "";
  $("authSubmit").disabled = false;
});

$("authForgot").addEventListener("click", async () => {
  if (!sb) return;
  const email = $("authEmail").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    authMsg.textContent = "Введите email в поле выше, и мы пришлём ссылку для сброса пароля.";
    return;
  }
  authMsg.textContent = "Отправляю письмо...";
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
  authMsg.textContent = error
    ? authErrorText(error)
    : "Если такой адрес зарегистрирован, на него придёт письмо со ссылкой для сброса пароля.";
});

$("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("resetPassword").value;
  if (password.length < 8) {
    authMsg.textContent = "Пароль должен быть не короче 8 символов.";
    return;
  }
  const { error } = await sb.auth.updateUser({ password });
  $("resetPassword").value = "";
  if (error) {
    authMsg.textContent = authErrorText(error);
    return;
  }
  $("resetForm").hidden = true;
  $("authForm").hidden = false;
  window.history.replaceState(null, "", redirectUrl());
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData.session) showApp(sessionData.session);
  else showAuth("Пароль изменён. Войдите с новым паролем.");
});

$("logoutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
});

initAuth();
