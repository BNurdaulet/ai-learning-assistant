"""Запросы к Supabase по HTTP (httpx).

Таблицы читаем и пишем через REST API (PostgREST) с токеном самого пользователя
и публичным anon/publishable-ключом. Поэтому доступ проверяют правила RLS в базе:
пользователь видит и меняет только свои строки.
Секретный ключ используется только в admin_delete_user.
В лог не пишем ни токены, ни тексты пользователя — только код ответа.
"""
import httpx

from config import SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL
from errors import AppError

http = httpx.Client(timeout=15)  # один клиент на всё приложение (в тестах подменяется)

# Коды, которые значат «таблицы или функции нет» (schema.sql не запускали)
SCHEMA_MISSING_CODES = {"PGRST205", "PGRST202", "42P01", "42883"}
# Таблицы и функции из supabase/documents.sql (для них своя подсказка)
DOCUMENT_OBJECTS = {"documents", "chunks", "rpc search_chunks"}


class DbError(AppError):
    """Ошибка базы или Supabase Auth: код и параметры (текст — в словаре фронтенда)."""


def _user_headers(token):
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"}


def _check(response, what):
    if response.status_code < 300:
        return
    # В лог пишем только код ошибки Supabase (например PGRST205), без текста запроса
    try:
        error = response.json()
        code, message = error.get("code"), error.get("message")
    except Exception:
        code = message = None
    print(f"Supabase ({what}): ошибка {response.status_code}, код {code}")
    if code in SCHEMA_MISSING_CODES:
        script = "documents.sql" if what in DOCUMENT_OBJECTS else "schema.sql"
        raise DbError(503, "db_not_configured", script=script)
    if code == "P0001" and message == "documents_limit":
        raise DbError(400, "documents_limit_reached")
    if response.status_code == 401:
        raise DbError(401, "session_expired")
    if response.status_code == 403:
        raise DbError(403, "db_forbidden")
    raise DbError(502, "db_error")


def rest(method, table, token, params=None, body=None, returning=False):
    """Запрос к таблице. params — фильтры PostgREST, например {"id": "eq.<uuid>"}.
    returning=True: вернуть изменённые/созданные строки."""
    headers = _user_headers(token)
    if returning:
        headers["Prefer"] = "return=representation"
    try:
        response = http.request(
            method, f"{SUPABASE_URL}/rest/v1/{table}",
            headers=headers, params=params, json=body,
        )
    except httpx.HTTPError:
        print(f"Supabase ({table}): нет связи")
        raise DbError(502, "db_unreachable")
    _check(response, table)
    if response.status_code == 204 or not response.content:
        return []
    return response.json()


def rpc(function, token, args=None):
    """Вызов функции Postgres (например, bump_ai_usage)."""
    try:
        response = http.post(
            f"{SUPABASE_URL}/rest/v1/rpc/{function}",
            headers=_user_headers(token), json=args or {},
        )
    except httpx.HTTPError:
        print(f"Supabase (rpc {function}): нет связи")
        raise DbError(502, "db_unreachable")
    _check(response, f"rpc {function}")
    return response.json()


def get_auth_user_id(token):
    """Спрашивает у Supabase Auth, чей это токен. Возвращает id или None."""
    try:
        response = http.get(f"{SUPABASE_URL}/auth/v1/user", headers=_user_headers(token))
    except httpx.HTTPError:
        print("Supabase Auth: нет связи")
        raise DbError(503, "auth_check_failed")
    if response.status_code != 200:
        return None
    return response.json().get("id")


def fetch_jwks():
    """Публичные ключи, которыми Supabase подписывает токены."""
    response = http.get(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    response.raise_for_status()
    return response.json()


def admin_delete_user(user_id):
    """Удаляет пользователя из Supabase Auth. Нужен SUPABASE_SERVICE_KEY.
    Возвращает True, если удалён, и False, если ключа нет."""
    if not SUPABASE_SERVICE_KEY:
        return False
    headers = {"apikey": SUPABASE_SERVICE_KEY}
    if SUPABASE_SERVICE_KEY.startswith("eyJ"):
        # Старый service_role-ключ (JWT) нужно передавать ещё и в Authorization
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_KEY}"
    try:
        response = http.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}", headers=headers
        )
    except httpx.HTTPError:
        print("Supabase Auth (удаление): нет связи")
        raise DbError(502, "account_delete_failed")
    if response.status_code not in (200, 204, 404):
        print(f"Supabase Auth (удаление): ошибка {response.status_code}")
        raise DbError(502, "account_delete_failed")
    return True
