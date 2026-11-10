"""Задания для учеников — сторона учителя: создать, список, открыть/закрыть, удалить,
результаты (таблица и CSV), удалить попытку, автоудаление старых попыток.

Все запросы идут с токеном учителя, поэтому база (RLS) сама не даст увидеть
или изменить чужие задания и попытки. Дополнительно фильтруем по teacher_id.
"""
import csv
import io
import json
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import supabase_db as db
from config import (
    ATTEMPT_RETENTION_DAYS,
    MAX_ASSIGNMENT_TITLE,
    MAX_ATTEMPTS_PER_ASSIGNMENT,
    MAX_FIELD_CHARS,
    MAX_FLASHCARDS,
    MAX_LIST_ITEMS,
    MAX_SAVED_QUESTIONS,
    MAX_SUMMARY_CHARS,
)
from errors import AppError
from userdata import NOT_FOUND, clean_question, parse_id

TYPES = ("quiz", "flashcards", "summary")
ASSIGNMENT_FIELDS = "id,code,type,title,content_lang,is_open,created_at"
CONTENT_LANGS = ("ru", "kk", "en")
ATTEMPT_FIELDS = "id,student_name,answers,score,total,duration_seconds,completed,created_at"


def new_code():
    """Случайный код для ссылки: 16 байт = 22 URL-безопасных символа, подобрать невозможно."""
    return secrets.token_urlsafe(16)


# ---------- Создание ----------

def clean_payload(data):
    """Проверяет и обрезает содержимое задания. Возвращает (payload, название по умолчанию)."""
    if data.type == "quiz":
        if not data.questions:
            raise AppError(400, "assignment_empty")
        if len(data.questions) > MAX_SAVED_QUESTIONS:
            raise AppError(400, "too_many_questions", max=MAX_SAVED_QUESTIONS)
        payload = {
            "questions": [clean_question(q) for q in data.questions],
            "difficulty": data.difficulty.strip()[:30],
        }
        return payload

    if data.type == "flashcards":
        cards = [
            {"front": c.front.strip()[:MAX_FIELD_CHARS], "back": c.back.strip()[:MAX_FIELD_CHARS]}
            for c in data.cards
            if c.front.strip() and c.back.strip()
        ]
        if not cards:
            raise AppError(400, "assignment_empty")
        if len(cards) > MAX_FLASHCARDS:
            raise AppError(400, "too_many_cards", max=MAX_FLASHCARDS)
        return {"cards": cards}

    if data.type == "summary":
        text = data.text.strip()
        if not text:
            raise AppError(400, "assignment_empty")
        if len(text) > MAX_SUMMARY_CHARS:
            raise AppError(400, "summary_too_long", max=MAX_SUMMARY_CHARS)
        return {"text": text}

    raise AppError(400, "invalid_assignment_type")


def create_assignment(user, data):
    payload = clean_payload(data)
    title = " ".join(data.title.split())[:MAX_ASSIGNMENT_TITLE]
    row = {
        "teacher_id": user.id,
        "code": new_code(),
        "type": data.type,
        "title": title,
        "content_lang": data.content_lang if data.content_lang in CONTENT_LANGS else "",
        "payload": payload,
    }
    created = db.rest("POST", "assignments", user.token, params={"select": ASSIGNMENT_FIELDS},
                      body=row, returning=True)
    return {**created[0], "attempt_count": 0}


# ---------- Список и изменения ----------

def list_assignments(user):
    cleanup_old_attempts(user)
    rows = db.rest("GET", "assignments", user.token, params={
        # attempts(count) — PostgREST сам посчитает попытки каждого задания (RLS учитывается)
        "select": ASSIGNMENT_FIELDS + ",attempts(count)",
        "teacher_id": f"eq.{user.id}",
        "order": "created_at.desc",
        "limit": str(MAX_LIST_ITEMS),
    })
    for row in rows:
        counts = row.pop("attempts", None) or [{}]
        row["attempt_count"] = counts[0].get("count", 0) if isinstance(counts, list) else 0
    return rows


def set_open(user, assignment_id, is_open):
    rows = db.rest("PATCH", "assignments", user.token, params={
        "id": f"eq.{parse_id(assignment_id)}",
        "teacher_id": f"eq.{user.id}",
        "select": ASSIGNMENT_FIELDS,
    }, body={"is_open": bool(is_open)}, returning=True)
    if not rows:
        raise AppError(404, NOT_FOUND)
    return rows[0]


def delete_assignment(user, assignment_id):
    rows = db.rest("DELETE", "assignments", user.token, params={
        "id": f"eq.{parse_id(assignment_id)}",
        "teacher_id": f"eq.{user.id}",
        "select": "id",
    }, returning=True)
    if not rows:
        raise AppError(404, NOT_FOUND)
    return {"deleted": True}


def delete_attempt(user, attempt_id):
    # RLS пропустит только попытку задания этого учителя
    rows = db.rest("DELETE", "attempts", user.token, params={
        "id": f"eq.{parse_id(attempt_id)}",
        "select": "id",
    }, returning=True)
    if not rows:
        raise AppError(404, NOT_FOUND)
    return {"deleted": True}


def cleanup_old_attempts(user, now=None):
    """Удаляет попытки старше ATTEMPT_RETENTION_DAYS во всех заданиях учителя.
    Тихо: если не получилось, список всё равно откроется."""
    if ATTEMPT_RETENTION_DAYS <= 0:
        return
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=ATTEMPT_RETENTION_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        db.rest("DELETE", "attempts", user.token, params={"created_at": f"lt.{cutoff}"})
    except db.DbError as e:
        print(f"Автоудаление старых попыток не удалось: {e.code}")


# ---------- Результаты ----------

def get_results(user, assignment_id):
    """Задание (с содержимым — для подробного разбора попыток) и все его попытки."""
    assignment_id = parse_id(assignment_id)
    rows = db.rest("GET", "assignments", user.token, params={
        "select": ASSIGNMENT_FIELDS + ",payload",
        "id": f"eq.{assignment_id}",
        "teacher_id": f"eq.{user.id}",
    })
    if not rows:
        raise AppError(404, NOT_FOUND)
    attempts = db.rest("GET", "attempts", user.token, params={
        "select": ATTEMPT_FIELDS,
        "assignment_id": f"eq.{assignment_id}",
        "order": "created_at.desc",
        "limit": str(MAX_ATTEMPTS_PER_ASSIGNMENT),
    })
    return {"assignment": rows[0], "attempts": attempts}


# ---------- CSV ----------

# Заголовки и статусы CSV берём из тех же словарей, что и сайт (Frontend/i18n, ключи csv.*)
I18N_DIR = Path(__file__).resolve().parent.parent / "Frontend" / "i18n"
CSV_COLUMNS = ("name", "status", "score", "total", "percent", "known", "repeat", "date", "duration")
CSV_STATUSES = ("done", "partial", "read")


@lru_cache(maxsize=4)
def _dictionary(lang):
    try:
        return json.loads((I18N_DIR / f"{lang}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def csv_text(lang, key):
    """Строка csv.<key> на языке lang; если её нет — по-русски; если и её нет — сам ключ."""
    for code in (lang, "ru"):
        value = _dictionary(code).get("csv." + key)
        if isinstance(value, str):
            return value
    return key


# Ячейка, которая начинается с этих символов, в Excel / Google Таблицах станет формулой
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value):
    """Защита от «формул» в таблице: текст ученика вроде =HYPERLINK(...) не должен выполниться."""
    text = "" if value is None else str(value)
    if text.startswith(FORMULA_START):
        return "'" + text
    return text


def format_time(iso):
    try:
        return datetime.fromisoformat(iso).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return ""


def attempt_row(kind, attempt, lang):
    status_words = {k: csv_text(lang, "status." + k) for k in CSV_STATUSES}
    score, total = attempt.get("score"), attempt.get("total")
    answers = attempt.get("answers") or {}
    if kind == "summary":
        status = status_words["read"]
    else:
        status = status_words["done"] if attempt.get("completed") else status_words["partial"]
    percent = round(100 * score / total) if kind == "quiz" and total else ""
    known = len(answers.get("known") or []) if kind == "flashcards" else ""
    repeat = len(answers.get("repeat") or []) if kind == "flashcards" else ""
    return [
        csv_safe(attempt.get("student_name")),
        status,
        score if kind == "quiz" and score is not None else "",
        total if kind == "quiz" and total is not None else "",
        percent,
        known,
        repeat,
        format_time(attempt.get("created_at")),
        attempt.get("duration_seconds") if attempt.get("duration_seconds") is not None else "",
    ]


def results_csv(kind, attempts, lang="ru"):
    """CSV с результатами. С BOM, чтобы Excel правильно показал кириллицу."""
    lang = lang if lang in CONTENT_LANGS else "ru"
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([csv_text(lang, "col." + c) for c in CSV_COLUMNS])
    for attempt in attempts:
        writer.writerow(attempt_row(kind, attempt, lang))
    return "﻿" + out.getvalue()


def csv_filename(assignment):
    day = format_time(assignment.get("created_at"))[:10] or "results"
    return f"results-{assignment.get('type', 'assignment')}-{day}.csv"
