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
- **Аккаунты**: регистрация и вход по email и паролю (Supabase Auth), сброс пароля по почте
- **Мои квизы**: сохранение квизов, открыть или удалить сохранённый квиз
- **История**: результаты всех пройденных квизов с ошибками и повторным разбором
- **Сохранённые чаты**: список чатов, «Новый чат», открыть или удалить
- **Дневной лимит**: не больше 50 запросов к ИИ в сутки на пользователя (`DAILY_AI_LIMIT` в `config.py`)
- **Удаление аккаунта** со всеми данными; страница `privacy.html` с политикой конфиденциальности
- **Большие документы** (учебник до 400 страниц): кнопка «Загрузить большой файл».
  Документ хранится в аккаунте частями по ~1500 символов, ИИ получает только нужные части:
  - чат ищет части по вопросу и ссылается на страницы — «(стр. 12)», под ответом «Источники: стр. 12–13»;
  - квиз, карточки и конспект — по всему документу (равномерная выборка), по страницам «с … по …»
    или по теме из поля «Тема» (поиск в документе);
  - конспект, план и карточки по большому документу делаются в два этапа (map-reduce):
    заметки по разделам, потом итог. Если использована только выборка, под результатом
    написано, например, «использована выборка — 63 из 340 частей»;
  - «Мои документы»: выбрать активный документ или удалить его

## API
| Метод | Путь | Что делает |
|---|---|---|
| POST | `/generate` | квиз по теме или материалу |
| POST | `/chat` | ответ чат-репетитора |
| POST | `/extract` | текст из PDF/TXT/MD |
| POST | `/review` | разбор ошибок: `{"mistakes": [{question, options, chosen, correct, explanation}], topic, material}` |
| POST | `/flashcards` | карточки: `{topic, material, count}` → `{"cards": [{front, back}]}` |
| POST | `/study` | `{kind: "summary" \| "plan", topic, material}` → `{"text": "markdown"}` |
| GET | `/config` | публичные настройки Supabase для браузера (без входа) |
| POST / GET | `/quizzes` | сохранить квиз / список своих квизов |
| GET / DELETE | `/quizzes/{id}` | открыть / удалить квиз |
| POST | `/results` | сохранить результат квиза |
| GET | `/history` | история результатов |
| POST / GET | `/chats` | создать чат / список чатов |
| GET / DELETE | `/chats/{id}` | открыть чат с сообщениями / удалить |
| POST | `/chats/{id}/messages` | сохранить сообщения |
| DELETE | `/account` | удалить все данные и учётную запись |
| POST | `/documents` | загрузить большой файл (multipart, поле `file`) → `{id, title, pages, chunk_count, warning?}` |
| GET | `/documents` | список своих документов |
| GET / DELETE | `/documents/{id}` | сведения о документе / удалить документ со всеми частями |

**Работа по документу.** В `/chat`, `/generate`, `/review`, `/flashcards`, `/study` можно передать
необязательный `document_id` — тогда вместо `material` используется документ.
Для `/generate`, `/flashcards`, `/study` есть ещё `scope`: `"all"` (весь документ),
`"pages"` (вместе с `page_from`, `page_to`) или `"topic"` (поиск по полю `topic`).
Ответ дополнительно содержит `sources` — страницы, по которым он составлен
(`[{page_start, page_end}]`), и `note` — пояснение (например, про выборку).
В `/chat` ещё `found: false`, если в документе ничего не нашлось.
Без `document_id` все маршруты работают как раньше.

Все маршруты, кроме `/health` и `/config`, требуют входа: заголовок
`Authorization: Bearer <access_token>` (его добавляет `apiFetch` в `common.js`).
Маршруты с ИИ (`/generate`, `/chat`, `/review`, `/flashcards`, `/study`) считаются в дневной лимит.

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

## Настройка Supabase (вход и база данных)

1. **Проект.** Зарегистрируйтесь на supabase.com → New project. Запомните пароль базы
   (он приложению не нужен). Регион лучше выбрать близкий к серверу Render.
2. **Вход по email.** Authentication → Sign In / Providers → Email: включено,
   «Confirm email» включено (пользователь подтверждает адрес по ссылке из письма).
   Встроенная почта Supabase отправляет лишь несколько писем в час — для настоящих
   пользователей подключите свой SMTP (Authentication → Emails → SMTP Settings).
3. **Адреса (URL Configuration).** Authentication → URL Configuration:
   - Site URL: адрес сайта на Render, например `https://ai-learning-assistant-wo31.onrender.com`
   - Redirect URLs: добавьте `https://ai-learning-assistant-wo31.onrender.com/**`
     и для локального запуска `http://127.0.0.1:8000/**`
   Без этого ссылки из писем (подтверждение, сброс пароля) не вернут на сайт.
4. **Ключи подписи (рекомендуется).** Project Settings → JWT Keys: если проект ещё на
   старом общем секрете, нажмите «Migrate JWT secret» и переключитесь на новый асимметричный ключ.
   Тогда сервер проверяет токены сам, без запроса к Supabase. Со старым секретом
   приложение тоже работает (проверяет токен через Supabase Auth).
5. **Таблицы.** SQL Editor → New query → вставьте весь файл `supabase/schema.sql` → Run.
   Скрипт создаёт таблицы, индексы, правила RLS и функцию для дневного лимита.
   Его можно запускать повторно.
   **Затем** так же запустите `supabase/documents.sql` (большие документы): таблицы
   `documents` и `chunks`, поисковый индекс, правила RLS и функцию поиска `search_chunks`.
   Он тоже безопасен при повторном запуске. Пока он не запущен, всё остальное работает,
   а «Мои документы» покажут ошибку «выполните supabase/documents.sql».
6. **Ключи.** Project Settings → API Keys:
   - publishable key (`sb_publishable_...`, или старый `anon`) → `SUPABASE_ANON_KEY`
   - secret key (`sb_secret_...`, или старый `service_role`) → `SUPABASE_SERVICE_KEY`
     (**необязательно**; нужен только чтобы «Удалить аккаунт» удалял и саму учётную запись;
     без него удаляются все данные, а email остаётся в Authentication → Users)
   - Project URL (`https://<ref>.supabase.co`) → `SUPABASE_URL`
7. **Переменные окружения.**
   - Локально: впишите `SUPABASE_URL`, `SUPABASE_ANON_KEY` и, при желании,
     `SUPABASE_SERVICE_KEY` в `.env` (пример — в `.env.example`).
   - На Render: Dashboard → ваш сервис → Environment → Add Environment Variable,
     те же три переменные. После сохранения Render перезапустит сервис.

Секретный ключ никогда не отправляется в браузер: `/config` отдаёт только URL и publishable-ключ.
Обычные чтение и запись в базу идут с токеном самого пользователя, поэтому RLS
не даёт увидеть чужие данные.

## Большие документы: лимиты и устройство

Лимиты (в `Backend/config.py`):

| Константа | Значение | Что ограничивает |
|---|---|---|
| `MAX_DOC_UPLOAD_BYTES` | 20 МБ | размер файла для «Загрузить большой файл» (старая загрузка в поле «Материал» — по-прежнему 10 МБ) |
| `MAX_PAGES` | 400 | страниц в одном PDF |
| `MAX_DOC_CHARS` | 1 500 000 | символов текста в одном документе |
| `MAX_DOCUMENTS` | 10 | документов у пользователя (то же число проверяет и триггер в `documents.sql`) |
| `MAX_TOTAL_DOC_CHARS` | 3 000 000 | символов во всех документах пользователя |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 1500 / 200 | длина части и перекрытие соседних частей |
| `MAX_CONTEXT_CHARS` | 15 000 | текста документа в одном запросе к ИИ |
| `CHAT_TOP_CHUNKS` | 5 | сколько найденных частей получает чат |
| `MAX_MAPREDUCE_CALLS` | 8 | запросов к ИИ на один конспект/план/карточки по документу |

- Сканированный PDF (без текстового слоя) не принимается — нужно сначала распознать текст (OCR).
  Если сканами оказались только некоторые страницы, они пропускаются, и об этом пишется после загрузки.
- Поиск — полнотекстовый, встроенный в Postgres (русская морфология: «клетки» находит «клетка»).
  Он бесплатный и не требует ключей, но ищет по словам, а не по смыслу: перефразированный вопрос
  или вопрос на другом языке может не найтись. Тогда помощник честно говорит, что в документе ответа нет.
- Конспект/план/карточки по документу считаются в дневном лимите как **один** запрос,
  хотя внутри может быть до 8 обращений к ИИ.
- В базе 3 млн символов одного пользователя занимают примерно 10–15 МБ (с поисковым индексом).
  Бесплатный Supabase даёт 500 МБ.

## Тесты

```bash
python -m unittest discover tests     # нарезка документа на части (без сети и базы)
```

## Публикация на Render
- New → Web Service, выберите репозиторий
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app:app --app-dir Backend --host 0.0.0.0 --port $PORT`
- Environment Variables: `GEMINI_API_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`,
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (необязательно)

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
  - `auth.py` — проверка входа (токен Supabase) и дневной лимит запросов к ИИ
  - `supabase_db.py` — запросы к Supabase по HTTP (таблицы, проверка токена, удаление пользователя)
  - `userdata.py` — квизы, результаты, чаты и удаление аккаунта (с проверкой входных данных)
  - `chunking.py` — нарезка текста документа на части с номерами страниц
  - `documents.py` — загрузка большого документа, квоты, список и удаление
  - `retrieval.py` — выбор частей для ИИ: поиск, выборка по документу/страницам, метки «[стр. N]»
  - `mapreduce.py` — конспект/план/карточки по большому документу (заметки по разделам → итог)
- `supabase/schema.sql` — таблицы, индексы и правила доступа (RLS); запускается вручную в Supabase
- `supabase/documents.sql` — таблицы документов и функция поиска; запускается вручную после `schema.sql`
- `tests/test_chunking.py` — тесты нарезки
- `Frontend/` — страница (index.html, css/, js/)
  - `js/common.js`, `js/render.js` — общие функции и Markdown/формулы (подключаются первыми)
  - `js/quiz.js` — квиз и режим задания (`renderQuiz` можно переиспользовать)
  - `js/review.js` — разбор ошибок, `js/flashcards.js` — карточки, `js/study.js` — конспект
  - `js/auth.js` — вход, регистрация, сброс пароля (supabase-js)
  - `js/library.js` — «Мои квизы», `js/history.js` — «История», `js/account.js` — удаление аккаунта
  - `js/documents.js` — большие документы: загрузка с прогрессом, «Мои документы», выбор части документа
  - `privacy.html` — политика конфиденциальности


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
- Accounts (email + password via Supabase), saved quizzes, results history, saved chats
- Daily AI request limit per user, account deletion, privacy page
- Large documents (textbooks up to 400 pages): chunking, full-text search with page citations,
  quizzes by pages or topic, map-reduce summaries
## Technologies
- Python 3
- Visual Studio Code
- HTML, JS, CSS
- SQL
## How to Run
https://ai-learning-assistant-wo31.onrender.com
## Current Limitations
- The free Supabase email service sends only a few emails per hour (custom SMTP is needed for many users).
- Each user can make 50 AI requests per day (free API limits).
- Document search is keyword-based (Postgres full-text), not semantic: paraphrased questions may not match.
- Scanned PDFs without a text layer are not supported (no OCR).

## Planned Improvements
- Add design
- Add more features