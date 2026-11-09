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
- **Разбор ошибок**: после квиза кнопка «Разобрать ошибки» объясняет, почему ответ
  неверен и что повторить, и даёт по 2 похожих вопроса на каждую ошибку (до 10 ошибок)
- **Режим задания**: квиз без подсказок, ответы открываются кнопкой «Показать ответы»;
  страницу можно распечатать (Cmd/Ctrl+P) — кнопки и поля на печати скрыты
- **Карточки**: карточки для запоминания (1–30), переворот кликом, «Назад», «Вперёд», «Перемешать»
- **Конспект**: краткий конспект или план изучения с оценкой времени и вопросами
  для самопроверки, кнопка «Скопировать»

## API
| Метод | Путь | Что делает |
|---|---|---|
| POST | `/generate` | квиз по теме или материалу |
| POST | `/chat` | ответ чат-репетитора |
| POST | `/extract` | текст из PDF/TXT/MD |
| POST | `/review` | разбор ошибок: `{"mistakes": [{question, options, chosen, correct, explanation}], topic, material}` |
| POST | `/flashcards` | карточки: `{topic, material, count}` → `{"cards": [{front, back}]}` |
| POST | `/study` | `{kind: "summary" \| "plan", topic, material}` → `{"text": "markdown"}` |

Ошибки возвращаются как `{"detail": "сообщение на русском"}`.

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
- `Backend/` — сервер и логика ИИ
  - `app.py` — только маршруты (адреса API)
  - `config.py` — ключи, модели и лимиты
  - `schemas.py` — форматы запросов и ответов (pydantic)
  - `providers.py` — запрос к Groq и проверка ошибки лимита
  - `ai.py` — общий помощник: Gemini → Groq с повторами (для новых функций)
  - `quiz.py`, `chat.py`, `files.py` — квиз, чат, чтение файлов
  - `review.py` — разбор ошибок
  - `flashcards.py` — карточки
  - `study.py` — конспект и план изучения
- `Frontend/` — страница (index.html, css/, js/)
  - `js/common.js`, `js/render.js` — общие функции и Markdown/формулы (подключаются первыми)
  - `js/quiz.js` — квиз и режим задания (`renderQuiz` можно переиспользовать)
  - `js/review.js` — разбор ошибок, `js/flashcards.js` — карточки, `js/study.js` — конспект


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
- Explain mistakes (mistake review with practice questions)
- Assignment mode (answers hidden, printable)
- Flashcards
- Summary and study plan
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