// Вход и регистрация через Supabase Auth (email + пароль).
// Сессию хранит сама библиотека supabase-js (в браузере). Токен к нашим запросам добавляет apiFetch (common.js).
let authMode = "login"; // "login" или "register"
let currentUserId = null;
const authMsg = $("authMessage");

// Коды ошибок Supabase Auth, для которых есть текст в словаре (errors.*)
const AUTH_ERRORS = [
  "invalid_credentials", "email_not_confirmed", "user_already_exists", "email_exists",
  "weak_password", "same_password", "email_address_invalid", "validation_failed",
  "over_email_send_rate_limit", "over_request_rate_limit", "signup_disabled", "otp_expired",
];

// Сообщение на экране входа: ключ словаря и параметры (текст обновится при смене языка)
function authSay(key, params) {
  setText(authMsg, key || "", params);
}

// Ошибка Supabase -> [ключ, параметры]
function authError(error) {
  if (AUTH_ERRORS.includes(error.code)) return ["errors." + error.code];
  if (error.status === 429) return ["errors.over_request_rate_limit"];
  if (error.name === "AuthRetryableFetchError") return ["auth.noConnection"];
  return error.message
    ? ["auth.errorGeneric", { message: error.message }]
    : ["auth.errorGeneric", { message: t("auth.unknownError") }];
}

function authSayError(error) {
  authSay(...authError(error));
}

// Показывает экран входа и прячет приложение. key — ключ сообщения из словаря (или пусто)
function showAuth(key, params) {
  $("app").hidden = true;
  $("authScreen").hidden = false;
  $("resetForm").hidden = true;
  $("authForm").hidden = false;
  authSay(key, params);
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
  setText($("authSubmit"), register ? "register.submit" : "login.submit");
  $("authPassword").autocomplete = register ? "new-password" : "current-password";
  authSay("");
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
  return AUTH_ERRORS.includes(code) ? "errors." + code : "auth.linkFailed";
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
    showAuth("auth.unavailable", { error: error.message });
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
      authSay("auth.newPasswordPrompt");
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
    authSay("auth.invalidEmail");
    return;
  }
  if (password.length < 8) {
    authSay("auth.passwordShort");
    return;
  }

  if (authMode === "register") {
    if (password !== $("authPassword2").value) {
      authSay("auth.passwordsMismatch");
      return;
    }
    if (!$("authConsent").checked) {
      authSay("auth.consentRequired");
      return;
    }
  }

  $("authSubmit").disabled = true;
  authSay("auth.wait");

  if (authMode === "register") {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl() },
    });
    if (error) {
      authSayError(error);
    } else if (!data.session) {
      // Нужно подтверждение почты. Не говорим, существует ли уже такой адрес.
      setAuthMode("login");
      authSay("auth.emailSent", { email });
    }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) authSayError(error);
  }

  $("authPassword").value = "";
  $("authPassword2").value = "";
  $("authSubmit").disabled = false;
});

$("authForgot").addEventListener("click", async () => {
  if (!sb) return;
  const email = $("authEmail").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    authSay("auth.forgotNeedEmail");
    return;
  }
  authSay("auth.sending");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
  if (error) authSayError(error);
  else authSay("auth.resetSent");
});

$("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("resetPassword").value;
  if (password.length < 8) {
    authSay("auth.passwordShort");
    return;
  }
  const { error } = await sb.auth.updateUser({ password });
  $("resetPassword").value = "";
  if (error) {
    authSayError(error);
    return;
  }
  $("resetForm").hidden = true;
  $("authForm").hidden = false;
  window.history.replaceState(null, "", redirectUrl());
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData.session) showApp(sessionData.session);
  else showAuth("auth.passwordChanged");
});

$("logoutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
});

initAuth();
