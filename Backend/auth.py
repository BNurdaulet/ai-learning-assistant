"""Проверка входа (токен Supabase) и дневной лимит запросов к ИИ.

Как проверяем токен (по документации Supabase):
- новые ключи подписи (ES256 / RS256): проверяем подпись сами по публичным ключам
  из JWKS (.../auth/v1/.well-known/jwks.json), плюс срок действия, aud и iss;
- старый общий секрет (HS256): Supabase не советует проверять его локально,
  поэтому спрашиваем сам Supabase Auth (GET /auth/v1/user) и ненадолго запоминаем ответ.
"""
import hashlib
import time
import uuid
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException

import supabase_db
from config import DAILY_AI_LIMIT, SUPABASE_ANON_KEY, SUPABASE_URL

JWKS_TTL = 600          # держим публичные ключи 10 минут (как кэш у Supabase)
JWKS_MIN_REFRESH = 60   # при незнакомом kid обновляем ключи не чаще раза в минуту
REMOTE_TTL = 60         # сколько помним ответ Supabase Auth для HS256-токенов

_jwks = {"keys": None, "loaded": 0.0}
_remote_cache = {}  # sha256(токена) -> (user_id, когда забыть)

NOT_LOGGED_IN = "Войдите в аккаунт."
BAD_TOKEN = "Сессия недействительна. Войдите снова."
EXPIRED = "Сессия истекла. Войдите снова."


@dataclass
class User:
    id: str
    token: str  # нужен, чтобы ходить в базу от имени пользователя (RLS)


def _load_jwks(force=False):
    now = time.time()
    age = now - _jwks["loaded"]
    if _jwks["keys"] is None or age > JWKS_TTL or (force and age > JWKS_MIN_REFRESH):
        try:
            _jwks["keys"] = jwt.PyJWKSet.from_dict(supabase_db.fetch_jwks())
        except Exception:
            # В JWKS нет ключей (проект на старом секрете) или нет связи
            _jwks["keys"] = None
        _jwks["loaded"] = now
    return _jwks["keys"]


def _find_key(kid):
    for force in (False, True):  # второй раз — вдруг ключи сменились
        keys = _load_jwks(force)
        if keys is not None:
            for key in keys.keys:
                if key.key_id == kid:
                    return key
    return None


def _verify_local(token, header):
    key = _find_key(header.get("kid"))
    if key is None:
        raise HTTPException(status_code=401, detail=BAD_TOKEN)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=f"{SUPABASE_URL}/auth/v1",
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail=EXPIRED)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail=BAD_TOKEN)
    return claims["sub"]


def _verify_remote(token):
    digest = hashlib.sha256(token.encode()).hexdigest()
    now = time.time()
    cached = _remote_cache.get(digest)
    if cached and cached[1] > now:
        return cached[0]
    try:
        user_id = supabase_db.get_auth_user_id(token)
    except supabase_db.DbError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    if not user_id:
        raise HTTPException(status_code=401, detail=BAD_TOKEN)
    if len(_remote_cache) > 1000:
        _remote_cache.clear()
    _remote_cache[digest] = (user_id, now + REMOTE_TTL)
    return user_id


def verify_token(token):
    """Возвращает id пользователя или бросает HTTPException 401."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail=BAD_TOKEN)

    alg = header.get("alg")
    if alg in ("ES256", "RS256"):
        user_id = _verify_local(token, header)
    elif alg == "HS256":
        user_id = _verify_remote(token)
    else:
        raise HTTPException(status_code=401, detail=BAD_TOKEN)

    try:
        return str(uuid.UUID(str(user_id)))
    except ValueError:
        raise HTTPException(status_code=401, detail=BAD_TOKEN)


def current_user(authorization: str | None = Header(default=None)) -> User:
    """Зависимость FastAPI: пускает только вошедших пользователей."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="Вход не настроен на сервере.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail=NOT_LOGGED_IN)
    token = authorization[len("Bearer "):].strip()
    if not token or len(token) > 8192:
        raise HTTPException(status_code=401, detail=NOT_LOGGED_IN)
    return User(id=verify_token(token), token=token)


def ai_limit(user: User = Depends(current_user)) -> User:
    """Зависимость для маршрутов с ИИ: считает запросы пользователя за сегодня."""
    try:
        used = supabase_db.rpc("bump_ai_usage", user.token)
    except supabase_db.DbError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    if not isinstance(used, int) or used > DAILY_AI_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Дневной лимит запросов к ИИ исчерпан ({DAILY_AI_LIMIT} в сутки). Попробуйте завтра.",
        )
    return user
