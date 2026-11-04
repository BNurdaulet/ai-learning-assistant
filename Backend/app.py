from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from chat import build_system, generate_reply
from config import MAX_HISTORY, MAX_MATERIAL_CHARS
from files import FileError, extract_text
from quiz import generate_quiz
from schemas import ChatRequest, QuizRequest

app = FastAPI(title="ИИ-помощник для обучения")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BUSY_MESSAGE = "Не удалось получить ответ ни от одного сервиса ИИ. Попробуйте позже."


@app.get("/health")
def status():
    return {"status": "Сервер работает"}


@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    data = await file.read()
    try:
        text, truncated, total = extract_text(file.filename, data)
    except FileError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return {"text": text, "truncated": truncated, "total_chars": total}


@app.post("/generate")
def generate(data: QuizRequest):
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
def chat(data: ChatRequest):
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


# Страницу из папки Frontend отдаёт тот же сервер. Эта строка должна быть в самом конце.
FRONTEND = Path(__file__).resolve().parent.parent / "Frontend"
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
