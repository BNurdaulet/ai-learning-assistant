from pathlib import Path

from fastapi import Depends, FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from auth import User, ai_limit, current_user
from chat import build_document_system, build_system, generate_reply
from errors import AppError
from config import (
    CHAT_TOP_CHUNKS,
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
from files import extract_text
import vision
from flashcards import generate_flashcards
import documents
import mapreduce
import retrieval
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

app = FastAPI(title="ИИ-помощник для обучения")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ошибки уходят кодом: {"detail": "file_too_large", "params": {...}}.
# Текст на языке пользователя фронтенд берёт из словаря (Frontend/i18n, ключи errors.<код>).
BUSY = "ai_busy"


@app.exception_handler(AppError)
def app_error(request: Request, e: AppError):
    return JSONResponse(status_code=e.status_code, content={"detail": e.code, "params": e.params})


@app.get("/health")
def status():
    return {"status": "Сервер работает"}


@app.get("/config")
def public_config():
    """Публичные настройки для браузера. Секретный ключ сюда не попадает никогда."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise AppError(503, "auth_not_configured")
    return {"supabase_url": SUPABASE_URL, "supabase_anon_key": SUPABASE_ANON_KEY}


@app.post("/extract")
async def extract(file: UploadFile = File(...), user: User = Depends(current_user)):
    data = await file.read()
    text, truncated, total = extract_text(file.filename, data)
    return {"text": text, "truncated": truncated, "total_chars": total}


@app.post("/photo")
def photo(files: list[UploadFile] = File(...), user: User = Depends(ai_limit)):
    """Распознаёт текст с фотографий и возвращает его как материал."""
    images = vision.check_photos([(f.filename or "photo", f.file.read()) for f in files])
    text = vision.photos_to_text(images)
    if text is None:
        raise AppError(503, BUSY)
    if not text:
        raise AppError(422, "photo_no_text")
    return {"text": text[:MAX_MATERIAL_CHARS], "truncated": len(text) > MAX_MATERIAL_CHARS}


def document_material(user, data, k=retrieval.CHUNKS_PER_CALL):
    """Текст документа для квиза: выбранная область, не длиннее MAX_CONTEXT_CHARS.
    Возвращает (тема для промпта, текст, пояснение, источники)."""
    doc = documents.get_ready_document(user, data.document_id)
    topic = data.topic.strip()[:MAX_TOPIC_CHARS]
    picked = retrieval.select_for_scope(user, doc, data.scope, topic, data.page_from, data.page_to, k)
    paged = retrieval.is_paged(doc)
    material, used = retrieval.build_context(picked["chunks"], paged)
    sources = retrieval.page_sources(used) if paged else []
    return picked["topic"], material, picked["note"], sources


@app.post("/generate")
def generate(data: QuizRequest, user: User = Depends(ai_limit)):
    if data.document_id:
        count = max(1, min(data.count, 20))
        topic, material, note, sources = document_material(user, data)
        questions = generate_quiz(topic, count, data.difficulty.strip()[:30], material, data.lang)
        if questions is None:
            raise AppError(503, BUSY)
        return {"questions": questions, "note": note, "sources": sources}

    topic = data.topic.strip()
    material = data.material.strip()[:MAX_MATERIAL_CHARS]
    if not topic and not material:
        raise AppError(400, "topic_or_material_required")

    count = max(1, min(data.count, 20))
    questions = generate_quiz(topic, count, data.difficulty, material, data.lang)
    if questions is None:
        raise AppError(503, BUSY)
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
        raise AppError(400, "user_message_required")

    if data.document_id:
        return chat_with_document(data, messages, user)

    system = build_system(data.style, data.material.strip()[:MAX_MATERIAL_CHARS], data.lang)
    result = generate_reply(messages, system)
    if result is None:
        raise AppError(503, BUSY)

    reply, provider = result
    return {"reply": reply, "provider": provider}


def chat_with_document(data, messages, user):
    """Чат по большому документу: ищем части по вопросу и отвечаем со ссылками на страницы."""
    doc = documents.get_ready_document(user, data.document_id)
    # Ищем по последнему вопросу и предыдущему вопросу пользователя:
    # так работают уточнения вроде «а подробнее про второе?»
    questions = [m.content for m in messages if m.role == "user"][-2:]
    query = " ".join(reversed(questions))
    hits = retrieval.search(user, doc["id"], query, CHAT_TOP_CHUNKS)
    paged = retrieval.is_paged(doc)
    context, used = retrieval.build_context(hits, paged)

    result = generate_reply(messages, build_document_system(data.style, context, paged, data.lang))
    if result is None:
        raise AppError(503, BUSY)
    reply, provider = result
    return {
        "reply": reply,
        "provider": provider,
        "sources": retrieval.page_sources(used) if paged else [],
        "found": bool(used),
    }


def clean_source(topic, material, required=True):
    """Обрезает тему и материал. Если required и оба пустые — ошибка 400."""
    topic = topic.strip()[:MAX_TOPIC_CHARS]
    material = material.strip()[:MAX_MATERIAL_CHARS]
    if required and not topic and not material:
        raise AppError(400, "topic_or_material_required")
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
        raise AppError(400, "no_mistakes")
    mistakes = mistakes[:MAX_MISTAKES]

    topic, material = clean_source(data.topic, data.material, required=False)
    if data.document_id:
        # Ищем в документе части про вопросы, в которых ошибся ученик
        doc = documents.get_ready_document(user, data.document_id)
        query = " ".join(f"{m.question} {m.correct}" for m in mistakes)
        hits = retrieval.search(user, doc["id"], query, CHAT_TOP_CHUNKS)
        material, _ = retrieval.build_context(hits, retrieval.is_paged(doc))
    result = review_mistakes(mistakes, topic, material, data.lang)
    if result is None:
        raise AppError(503, BUSY)
    return result


def document_digest(user, data):
    """Материал из большого документа (map-reduce, см. mapreduce.py)."""
    digest = mapreduce.document_material(user, data)
    if digest is None:
        raise AppError(503, BUSY)
    return digest


@app.post("/flashcards")
def flashcards(data: FlashcardsRequest, user: User = Depends(ai_limit)):
    count = max(1, min(data.count, MAX_FLASHCARDS))
    if data.document_id:
        digest = document_digest(user, data)
        cards = generate_flashcards(digest["topic"], count, digest["material"], data.lang)
        if cards is None:
            raise AppError(503, BUSY)
        return {"cards": cards, "note": digest["note"], "sources": digest["sources"]}

    topic, material = clean_source(data.topic, data.material)
    cards = generate_flashcards(topic, count, material, data.lang)
    if cards is None:
        raise AppError(503, BUSY)
    return {"cards": cards}


@app.post("/study")
def study(data: StudyRequest, user: User = Depends(ai_limit)):
    if data.kind not in KINDS:
        raise AppError(400, "unknown_study_kind")
    if data.document_id:
        digest = document_digest(user, data)
        text = generate_study(data.kind, digest["topic"], digest["material"], data.lang)
        if text is None:
            raise AppError(503, BUSY)
        return {"text": text, "note": digest["note"], "sources": digest["sources"]}

    topic, material = clean_source(data.topic, data.material)
    text = generate_study(data.kind, topic, material, data.lang)
    if text is None:
        raise AppError(503, BUSY)
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


# ---------- Большие документы ----------

@app.post("/documents")
def upload_document(file: UploadFile = File(...), user: User = Depends(current_user)):
    # Обычная (не async) функция: FastAPI запустит её в отдельном потоке,
    # и долгое чтение большого PDF не остановит остальные запросы.
    return documents.upload_document(user, file.filename, file.file)


@app.get("/documents")
def list_documents(user: User = Depends(current_user)):
    return {"documents": documents.list_documents(user)}


@app.get("/documents/{document_id}")
def get_document(document_id: str, user: User = Depends(current_user)):
    return documents.get_document(user, document_id)


@app.delete("/documents/{document_id}")
def delete_document(document_id: str, user: User = Depends(current_user)):
    return documents.delete_document(user, document_id)


# ---------- Удаление аккаунта ----------

@app.delete("/account")
def delete_account(user: User = Depends(current_user)):
    return userdata.delete_account(user)


# Страницу из папки Frontend отдаёт тот же сервер. Эта строка должна быть в самом конце.
FRONTEND = Path(__file__).resolve().parent.parent / "Frontend"
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
