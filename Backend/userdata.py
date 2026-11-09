"""Данные пользователя в Supabase: квизы, результаты, чаты, удаление аккаунта.

Все запросы идут с токеном пользователя, поэтому база (RLS) сама не даст
прочитать или изменить чужие строки. Дополнительно фильтруем по user_id.
Здесь же проверяем и обрезаем всё, что пришло от браузера.
"""
import uuid

from fastapi import HTTPException

import supabase_db as db
from config import (
    MAX_CHAT_MESSAGES,
    MAX_FIELD_CHARS,
    MAX_LIST_ITEMS,
    MAX_MESSAGE_CHARS,
    MAX_OPTION_CHARS,
    MAX_SAVED_QUESTIONS,
    MAX_TOPIC_CHARS,
)

NOT_FOUND = "Не найдено."


def parse_id(value):
    """Проверяет, что id похож на UUID. Иначе 404 (как будто такой записи нет)."""
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise HTTPException(status_code=404, detail=NOT_FOUND)


def clean_question(q):
    """Проверяет и обрезает вопрос квиза. Возвращает dict или бросает 400."""
    options = [o.strip()[:MAX_OPTION_CHARS] for o in q.options]
    question = q.question.strip()[:MAX_FIELD_CHARS]
    if not question or not (2 <= len(options) <= 6) or not all(options):
        raise HTTPException(status_code=400, detail="Некорректный вопрос в квизе.")
    if not (0 <= q.correct_index < len(options)):
        raise HTTPException(status_code=400, detail="Некорректный номер правильного ответа.")
    return {
        "question": question,
        "options": options,
        "correct_index": q.correct_index,
        "explanation": q.explanation.strip()[:MAX_FIELD_CHARS],
    }


# ---------- Квизы ----------

def save_quiz(user, data):
    if not data.questions:
        raise HTTPException(status_code=400, detail="В квизе нет вопросов.")
    if len(data.questions) > MAX_SAVED_QUESTIONS:
        raise HTTPException(
            status_code=400, detail=f"Слишком много вопросов (максимум {MAX_SAVED_QUESTIONS})."
        )
    row = {
        "user_id": user.id,
        "topic": data.topic.strip()[:MAX_TOPIC_CHARS],
        "difficulty": data.difficulty.strip()[:30],
        "questions": [clean_question(q) for q in data.questions],
    }
    created = db.rest("POST", "quizzes", user.token, params={"select": "id,created_at"},
                      body=row, returning=True)
    return created[0]


def list_quizzes(user):
    return db.rest("GET", "quizzes", user.token, params={
        "select": "id,topic,difficulty,created_at",
        "user_id": f"eq.{user.id}",
        "order": "created_at.desc",
        "limit": str(MAX_LIST_ITEMS),
    })


def get_quiz(user, quiz_id):
    rows = db.rest("GET", "quizzes", user.token, params={
        "select": "id,topic,difficulty,questions,created_at",
        "id": f"eq.{parse_id(quiz_id)}",
        "user_id": f"eq.{user.id}",
    })
    if not rows:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return rows[0]


def delete_quiz(user, quiz_id):
    rows = db.rest("DELETE", "quizzes", user.token, params={
        "id": f"eq.{parse_id(quiz_id)}",
        "user_id": f"eq.{user.id}",
        "select": "id",
    }, returning=True)
    if not rows:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return {"deleted": True}


# ---------- Результаты и история ----------

def clean_mistake(m):
    return {
        "question": m.question.strip()[:MAX_FIELD_CHARS],
        "options": [o.strip()[:MAX_OPTION_CHARS] for o in m.options[:6]],
        "chosen": m.chosen.strip()[:MAX_OPTION_CHARS],
        "correct": m.correct.strip()[:MAX_OPTION_CHARS],
        "explanation": m.explanation.strip()[:MAX_FIELD_CHARS],
    }


def save_result(user, data):
    if not (1 <= data.total <= MAX_SAVED_QUESTIONS) or not (0 <= data.score <= data.total):
        raise HTTPException(status_code=400, detail="Некорректный результат.")
    mistakes = [clean_mistake(m) for m in data.mistakes[:MAX_SAVED_QUESTIONS] if m.question.strip()]
    row = {
        "user_id": user.id,
        "quiz_id": parse_id(data.quiz_id) if data.quiz_id else None,
        "topic": data.topic.strip()[:MAX_TOPIC_CHARS],
        "score": data.score,
        "total": data.total,
        "mistakes": mistakes,
    }
    created = db.rest("POST", "quiz_results", user.token, params={"select": "id,created_at"},
                      body=row, returning=True)
    return created[0]


def list_history(user):
    return db.rest("GET", "quiz_results", user.token, params={
        "select": "id,quiz_id,topic,score,total,mistakes,created_at",
        "user_id": f"eq.{user.id}",
        "order": "created_at.desc",
        "limit": str(MAX_LIST_ITEMS),
    })


# ---------- Чаты ----------

CHAT_STYLES = ("tutor", "simple", "strict")


def create_chat(user, data):
    title = " ".join(data.title.split())[:100] or "Новый чат"
    row = {
        "user_id": user.id,
        "title": title,
        "style": data.style if data.style in CHAT_STYLES else "tutor",
    }
    created = db.rest("POST", "chat_sessions", user.token,
                      params={"select": "id,title,style,created_at"}, body=row, returning=True)
    return created[0]


def list_chats(user):
    return db.rest("GET", "chat_sessions", user.token, params={
        "select": "id,title,style,created_at",
        "user_id": f"eq.{user.id}",
        "order": "created_at.desc",
        "limit": str(MAX_LIST_ITEMS),
    })


def get_chat(user, session_id):
    session_id = parse_id(session_id)
    sessions = db.rest("GET", "chat_sessions", user.token, params={
        "select": "id,title,style,created_at",
        "id": f"eq.{session_id}",
        "user_id": f"eq.{user.id}",
    })
    if not sessions:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    messages = db.rest("GET", "chat_messages", user.token, params={
        "select": "role,content,created_at",
        "session_id": f"eq.{session_id}",
        "user_id": f"eq.{user.id}",
        "order": "created_at.asc",
        "limit": str(MAX_CHAT_MESSAGES),
    })
    return {**sessions[0], "messages": messages}


def save_messages(user, session_id, data):
    session_id = parse_id(session_id)
    rows = [
        {
            "session_id": session_id,
            "user_id": user.id,
            "role": m.role,
            "content": m.content.strip()[:MAX_MESSAGE_CHARS],
        }
        for m in data.messages[:10]
        if m.role in ("user", "assistant") and m.content.strip()
    ]
    if not rows:
        raise HTTPException(status_code=400, detail="Нет сообщений для сохранения.")
    # Чужая или несуществующая сессия: база (RLS) не даст вставить -> 403. Отвечаем 404.
    try:
        db.rest("POST", "chat_messages", user.token, body=rows)
    except db.DbError as e:
        if e.status_code == 403:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        raise
    return {"saved": len(rows)}


def delete_chat(user, session_id):
    rows = db.rest("DELETE", "chat_sessions", user.token, params={
        "id": f"eq.{parse_id(session_id)}",
        "user_id": f"eq.{user.id}",
        "select": "id",
    }, returning=True)
    if not rows:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return {"deleted": True}


# ---------- Удаление аккаунта ----------

def delete_account(user):
    """Удаляет все строки пользователя (с его же токеном, через RLS),
    затем саму учётную запись в Supabase Auth (нужен SUPABASE_SERVICE_KEY)."""
    for table in ("chat_messages", "chat_sessions", "quiz_results", "quizzes"):
        db.rest("DELETE", table, user.token, params={"user_id": f"eq.{user.id}"})
    # Счётчик за прошлые дни; сегодняшняя строка удалится вместе с учётной записью
    db.rest("DELETE", "ai_usage", user.token, params={"user_id": f"eq.{user.id}"})

    auth_deleted = db.admin_delete_user(user.id)
    if auth_deleted:
        print("Аккаунт удалён полностью")
    else:
        print("Данные аккаунта удалены, учётная запись осталась (нет SUPABASE_SERVICE_KEY)")
    return {"data_deleted": True, "auth_user_deleted": auth_deleted}
