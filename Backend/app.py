from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from auth import User, ai_limit, current_user
from chat import build_system, generate_reply
from config import (
    MAX_FIELD_CHARS,
    MAX_FLASHCARDS,
    MAX_HISTORY,
    MAX_MATERIAL_CHARS,
    MAX_MISTAKES,
    MAX_OPTION_CHARS,
    MAX_TOPIC_CHARS,
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
)
from files import FileError, extract_text
from flashcards import generate_flashcards
from quiz import generate_quiz
from review import review_mistakes
import userdata
from schemas import (
    ChatRequest,
    CreateChatRequest,
    FlashcardsRequest,
    QuizRequest,
    ReviewRequest,
    SaveQuizRequest,
    SaveResultRequest,
    SaveMessagesRequest,
    StudyRequest,
)
from study import KINDS, generate_study
from supabase_db import DbError

app = FastAPI(title="ИИ-помощник для обучения")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BUSY_MESSAGE = "Не удалось получить ответ ни от одного сервиса ИИ. Попробуйте позже."


@app.exception_handler(DbError)
def db_error(request: Request, e: DbError):
    return JSONResponse(status_code=e.status_code, content={"detail": e.detail})


@app.get("/health")
def status():
    return {"status": "Сервер работает"}


@app.get("/config")
def public_config():
    """Публичные настройки для браузера. Секретный ключ сюда не попадает никогда."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="Вход не настроен на сервере.")
    return {"supabase_url": SUPABASE_URL, "supabase_anon_key": SUPABASE_ANON_KEY}


@app.post("/extract")
async def extract(file: UploadFile = File(...), user: User = Depends(current_user)):
    data = await file.read()
    try:
        text, truncated, total = extract_text(file.filename, data)
    except FileError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return {"text": text, "truncated": truncated, "total_chars": total}


@app.post("/generate")
def generate(data: QuizRequest, user: User = Depends(ai_limit)):
    topic = data.topic.strip()
    material = data.material.strip()[:MAX_MATERIAL_CHARS]
    if not topic and not material:
        raise HTTPException(status_code=400, detail="Укажите тему или добавьте материал.")

    count = max(1, min(data.count, 20))
    questions = generate_quiz(topic, count, data.difficulty, material)
    if questions is None:
        raise HTTPException(status_code=503, detail=BUSY_MESSAGE)
    return {"questions": questions}


@app.post("/chat")
def chat(data: ChatRequest, user: User = Depends(ai_limit)):
    messages = [
        m for m in data.messages
        if m.role in ("user", "assistant") and m.content.strip()
    ][-MAX_HISTORY:]

    # Диалог для ИИ должен начинаться с сообщения пользователя
    while messages and messages[0].role != "user":
        messages.pop(0)
    if not messages or messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="Нужно сообщение пользователя.")

    system = build_system(data.style, data.material.strip()[:MAX_MATERIAL_CHARS])
    result = generate_reply(messages, system)
    if result is None:
        raise HTTPException(status_code=503, detail=BUSY_MESSAGE)

    reply, provider = result
    return {"reply": reply, "provider": provider}


def clean_source(topic, material, required=True):
    """Обрезает тему и материал. Если required и оба пустые — ошибка 400."""
    topic = topic.strip()[:MAX_TOPIC_CHARS]
    material = material.strip()[:MAX_MATERIAL_CHARS]
    if required and not topic and not material:
        raise HTTPException(status_code=400, detail="Укажите тему или добавьте материал.")
    return topic, material


@app.post("/review")
def review(data: ReviewRequest, user: User = Depends(ai_limit)):
    mistakes = []
    for m in data.mistakes:
        question = m.question.strip()[:MAX_FIELD_CHARS]
        if not question or not m.chosen.strip() or not m.correct.strip():
            continue
        mistakes.append(m.model_copy(update={
            "question": question,
            "options": [o.strip()[:MAX_OPTION_CHARS] for o in m.options[:6]],
            "chosen": m.chosen.strip()[:MAX_OPTION_CHARS],
            "correct": m.correct.strip()[:MAX_OPTION_CHARS],
            "explanation": m.explanation.strip()[:MAX_FIELD_CHARS],
        }))
    if not mistakes:
        raise HTTPException(status_code=400, detail="Нет ошибок для разбора.")
    mistakes = mistakes[:MAX_MISTAKES]

    topic, material = clean_source(data.topic, data.material, required=False)
    result = review_mistakes(mistakes, topic, material)
    if result is None:
        raise HTTPException(status_code=503, detail=BUSY_MESSAGE)
    return result


@app.post("/flashcards")
def flashcards(data: FlashcardsRequest, user: User = Depends(ai_limit)):
    topic, material = clean_source(data.topic, data.material)
    count = max(1, min(data.count, MAX_FLASHCARDS))
    cards = generate_flashcards(topic, count, material)
    if cards is None:
        raise HTTPException(status_code=503, detail=BUSY_MESSAGE)
    return {"cards": cards}


@app.post("/study")
def study(data: StudyRequest, user: User = Depends(ai_limit)):
    if data.kind not in KINDS:
        raise HTTPException(status_code=400, detail="Неизвестный тип: нужен «summary» или «plan».")
    topic, material = clean_source(data.topic, data.material)
    text = generate_study(data.kind, topic, material)
    if text is None:
        raise HTTPException(status_code=503, detail=BUSY_MESSAGE)
    return {"text": text}


# ---------- Данные пользователя: квизы ----------

@app.post("/quizzes")
def save_quiz(data: SaveQuizRequest, user: User = Depends(current_user)):
    return userdata.save_quiz(user, data)


@app.get("/quizzes")
def list_quizzes(user: User = Depends(current_user)):
    return {"quizzes": userdata.list_quizzes(user)}


@app.get("/quizzes/{quiz_id}")
def get_quiz(quiz_id: str, user: User = Depends(current_user)):
    return userdata.get_quiz(user, quiz_id)


@app.delete("/quizzes/{quiz_id}")
def delete_quiz(quiz_id: str, user: User = Depends(current_user)):
    return userdata.delete_quiz(user, quiz_id)


# ---------- Данные пользователя: результаты ----------

@app.post("/results")
def save_result(data: SaveResultRequest, user: User = Depends(current_user)):
    return userdata.save_result(user, data)


@app.get("/history")
def history(user: User = Depends(current_user)):
    return {"results": userdata.list_history(user)}


# ---------- Данные пользователя: чаты ----------

@app.post("/chats")
def create_chat(data: CreateChatRequest, user: User = Depends(current_user)):
    return userdata.create_chat(user, data)


@app.get("/chats")
def list_chats(user: User = Depends(current_user)):
    return {"chats": userdata.list_chats(user)}


@app.get("/chats/{session_id}")
def get_chat(session_id: str, user: User = Depends(current_user)):
    return userdata.get_chat(user, session_id)


@app.post("/chats/{session_id}/messages")
def save_messages(session_id: str, data: SaveMessagesRequest, user: User = Depends(current_user)):
    return userdata.save_messages(user, session_id, data)


@app.delete("/chats/{session_id}")
def delete_chat(session_id: str, user: User = Depends(current_user)):
    return userdata.delete_chat(user, session_id)


# ---------- Удаление аккаунта ----------

@app.delete("/account")
def delete_account(user: User = Depends(current_user)):
    return userdata.delete_account(user)


# Страницу из папки Frontend отдаёт тот же сервер. Эта строка должна быть в самом конце.
FRONTEND = Path(__file__).resolve().parent.parent / "Frontend"
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
