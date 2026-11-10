"""Задания глазами ученика (без входа): открыть задание по коду и сдать попытку.

В базу ходим только через две функции из supabase/assignments.sql с публичным
anon-ключом (секретный ключ не нужен). Эти функции сами проверяют всё важное
и сами считают баллы. Здесь мы проверяем то же самое ещё раз заранее — чтобы
ученик получил понятную ошибку, а мусор не доходил до базы.

В лог не пишем ни имя ученика, ни ответы.
"""
import re
import time
import unicodedata

import supabase_db as db
from config import MAX_STUDENT_NAME
from errors import AppError

CODE_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
UNAVAILABLE = "assignment_unavailable"
INVALID_ANSWERS = "invalid_answers"
INVALID_NAME = "invalid_name"
# Ответ «нет такого задания» не быстрее этого времени: неверный код, несуществующий
# и закрытый выглядят одинаково (и по ответу, и примерно по времени).
MIN_UNAVAILABLE_SECONDS = 0.3
MAX_DURATION = 86400


def _unavailable(started):
    left = MIN_UNAVAILABLE_SECONDS - (time.monotonic() - started)
    if left > 0:
        time.sleep(left)
    return AppError(404, UNAVAILABLE)


def load_assignment(code):
    """{type, title, payload} открытого задания или 404 assignment_unavailable."""
    started = time.monotonic()
    data = None
    if isinstance(code, str) and CODE_RE.match(code):
        data = db.anon_rpc("get_assignment_by_code", {"p_code": code})
    if not isinstance(data, dict) or data.get("type") not in ("quiz", "flashcards", "summary"):
        raise _unavailable(started)
    return data


def public_view(assignment):
    """Что видит ученик. Правильные ответы квиза тоже отдаём: ученик сразу видит,
    верно ли ответил (как в обычном квизе). Баллы всё равно считает сервер."""
    payload = assignment.get("payload") or {}
    view = {
        "type": assignment["type"],
        "title": assignment.get("title", ""),
        "content_lang": assignment.get("content_lang", ""),
    }
    if assignment["type"] == "quiz":
        view["questions"] = payload.get("questions", [])
    elif assignment["type"] == "flashcards":
        view["cards"] = payload.get("cards", [])
    else:
        view["text"] = payload.get("text", "")
    return view


def clean_name(raw):
    """Имя или ник: без управляющих символов, пробелы схлопнуты, не длиннее 40 символов."""
    if not isinstance(raw, str):
        raise AppError(400, INVALID_NAME)
    text = unicodedata.normalize("NFC", raw)
    text = "".join(ch if ch.isprintable() else " " for ch in text)
    name = " ".join(text.split())[:MAX_STUDENT_NAME].strip()
    if not name:
        raise AppError(400, INVALID_NAME)
    return name


def clean_duration(value):
    if value is None:
        return None
    return max(0, min(int(value), MAX_DURATION))


def _is_index(value, size):
    # bool в Python — тоже int (True == 1), поэтому исключаем его явно
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value < size


def validate_answers(kind, payload, answers):
    """Строго проверяет ответы по сохранённому заданию. Возвращает очищенные ответы
    (только нужные поля) или бросает 400 invalid_answers."""
    if not isinstance(answers, dict):
        raise AppError(400, INVALID_ANSWERS)

    if kind == "quiz":
        questions = payload.get("questions") or []
        choices = answers.get("choices")
        if not isinstance(choices, list) or len(choices) != len(questions):
            raise AppError(400, INVALID_ANSWERS)
        for choice, q in zip(choices, questions):
            if choice is not None and not _is_index(choice, len(q.get("options") or [])):
                raise AppError(400, INVALID_ANSWERS)
        return {"choices": list(choices)}

    if kind == "flashcards":
        total = len(payload.get("cards") or [])
        known, repeat = answers.get("known"), answers.get("repeat")
        if not isinstance(known, list) or not isinstance(repeat, list):
            raise AppError(400, INVALID_ANSWERS)
        every = known + repeat
        # Каждая карточка ровно один раз
        if len(every) != total or not all(_is_index(i, total) for i in every) or len(set(every)) != total:
            raise AppError(400, INVALID_ANSWERS)
        return {"known": list(known), "repeat": list(repeat)}

    if kind == "summary":
        if answers.get("read") is not True:
            raise AppError(400, INVALID_ANSWERS)
        return {"read": True}

    raise AppError(400, INVALID_ANSWERS)


def grade(kind, payload, answers):
    """Баллы по уже проверенным ответам: {"score", "total", "completed"}.
    Та же логика, что в submit_attempt (база считает сама, это — для проверки и тестов)."""
    if kind == "quiz":
        questions = payload.get("questions") or []
        choices = answers["choices"]
        score = sum(1 for c, q in zip(choices, questions) if c is not None and c == q.get("correct_index"))
        return {"score": score, "total": len(questions), "completed": all(c is not None for c in choices)}
    if kind == "flashcards":
        return {"score": len(answers["known"]), "total": len(payload.get("cards") or []), "completed": True}
    return {"score": None, "total": None, "completed": True}


def submit(code, data):
    """Сдать попытку. Возвращает {"score", "total", "completed"} — то, что посчитала база."""
    assignment = load_assignment(code)
    name = clean_name(data.name)
    answers = validate_answers(assignment["type"], assignment.get("payload") or {}, data.answers)
    result = db.anon_rpc("submit_attempt", {
        "p_code": code,
        "p_name": name,
        "p_answers": answers,
        "p_duration": clean_duration(data.duration_seconds),
    })
    if not isinstance(result, dict):
        raise AppError(502, "db_error")
    return {
        "score": result.get("score"),
        "total": result.get("total"),
        "completed": bool(result.get("completed", True)),
    }
