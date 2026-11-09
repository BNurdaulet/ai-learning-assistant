# ИИ-помощник для обучения

Веб-приложение на FastAPI: генерирует квизы по теме или загруженному материалу
(PDF, TXT, MD) и работает как чат-репетитор с памятью разговора.
Основной сервис ИИ: Google Gemini. Если у него закончился лимит, запрос
автоматически переходит к Groq.

## Возможности
- Квиз по теме или по загруженному материалу, с пояснениями к ответам
- Чат-репетитор с выбором стиля (репетитор, простыми словами, строгий)
- Загрузка PDF, TXT и MD
- Автоматическое переключение между сервисами ИИ

## Запуск на своём компьютере

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # затем впишите в .env свои ключи
cd Backend
uvicorn app:app --reload
```

Откройте http://127.0.0.1:8000

## Ключи API
- Gemini: Google AI Studio
- Groq: console.groq.com

Ключи хранятся в файле `.env` (он не загружается в репозиторий).
На хостинге (например, Render) ключи задаются в переменных окружения.

## Публикация на Render
- New → Web Service, выберите репозиторий
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app:app --app-dir Backend --host 0.0.0.0 --port $PORT`
- Environment Variables: `GEMINI_API_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`

## Структура
- `Backend/` — сервер и логика ИИ (app, config, schemas, providers, quiz, chat, files)
- `Frontend/` — страница (index.html, css/, js/)


# AI Asisstant

## Team Members
- Student 1: Bakhytzhan Nurdaulet
- Student 2: Kalyshbek Nuray 

## Problem
Students need a simple way to prepare for quizzez
## Target Users
University and high school students
## Features Implemented
- View saved chats
- Generate quizzez
- Explain mistakes
## Technologies
- Python 3
- Visual Studio Code
- HTML, JS, CSS
- SQL
## How to Run
https://ai-learning-assistant-wo31.onrender.com
## Current Limitations
Data is lost when the program closes.

## Planned Improvements
- ADD SQL
- Add design
- Add more features