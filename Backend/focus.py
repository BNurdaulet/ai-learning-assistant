"""Статистика фокуса: завершённые рабочие сессии таймера Помодоро (таблица focus_sessions).

Запись и чтение — с токеном пользователя, поэтому RLS в базе пускает только к своим строкам.
Те же проверки (минуты, дата, лимит за день) стоят и в supabase/focus.sql: anon-ключ публичный,
и в таблицу можно писать в обход сервера. Здесь проверяем, чтобы отвечать понятной ошибкой.
"""
import re
import uuid
from datetime import date, datetime, timedelta, timezone

import supabase_db as db
from config import MAX_FOCUS_MINUTES, MAX_FOCUS_SESSIONS_PER_DAY
from errors import AppError

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DAY_WINDOW = 2       # дата от браузера — не дальше ±2 дней от сегодняшней по UTC (как в focus.sql)
STATS_DAYS = 7


def utc_today():
    return datetime.now(timezone.utc).date()


def parse_day(value, today=None):
    """Местная дата пользователя 'ГГГГ-ММ-ДД' рядом с сегодняшней. Иначе 400."""
    if not isinstance(value, str) or not DAY_RE.match(value):
        raise AppError(400, "invalid_day")
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise AppError(400, "invalid_day")
    today = today or utc_today()
    if abs((day - today).days) > DAY_WINDOW:
        raise AppError(400, "invalid_day")
    return day


def save_session(user, data):
    try:
        client_id = str(uuid.UUID(str(data.client_id)))
    except ValueError:
        raise AppError(400, "invalid_focus_session")
    if not (1 <= data.minutes <= MAX_FOCUS_MINUTES):
        raise AppError(400, "invalid_focus_session")
    day = parse_day(data.day)
    row = {"user_id": user.id, "client_id": client_id, "day": day.isoformat(), "minutes": data.minutes}
    # Повтор той же сессии (тот же client_id) молча пропускается — дублей не бывает
    db.rest("POST", "focus_sessions", user.token,
            params={"on_conflict": "user_id,client_id"}, body=row,
            prefer="resolution=ignore-duplicates")
    return {"saved": True}


def summarize(rows, today):
    """Строки {day, minutes} -> 7 дней по порядку (последний — today), пустые дни с нулями."""
    days = [today - timedelta(days=i) for i in range(STATS_DAYS - 1, -1, -1)]
    by_day = {d.isoformat(): {"day": d.isoformat(), "minutes": 0, "sessions": 0} for d in days}
    for r in rows:
        bucket = by_day.get(str(r.get("day")))
        minutes = r.get("minutes")
        if bucket is None or not isinstance(minutes, int):
            continue
        bucket["minutes"] += minutes
        bucket["sessions"] += 1
    result = list(by_day.values())
    return {
        "days": result,
        "total_minutes": sum(d["minutes"] for d in result),
        "total_sessions": sum(d["sessions"] for d in result),
    }


def weekly_stats(user, today_value):
    today = parse_day(today_value)
    start = today - timedelta(days=STATS_DAYS - 1)
    rows = db.rest("GET", "focus_sessions", user.token, params={
        "select": "day,minutes",
        "user_id": f"eq.{user.id}",
        "and": f"(day.gte.{start.isoformat()},day.lte.{today.isoformat()})",
        "limit": str(STATS_DAYS * MAX_FOCUS_SESSIONS_PER_DAY),
    })
    return summarize(rows, today)
