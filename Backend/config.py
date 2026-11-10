import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()  # читает ключи из файла .env, если он есть

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "NO_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

MAX_MATERIAL_CHARS = 15000           # сколько символов материала отправляем ИИ
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # максимальный размер файла: 10 МБ
MAX_HISTORY = 20                     # сколько последних сообщений чата помним
MAX_TOPIC_CHARS = 200                # длина темы для новых функций
MAX_MISTAKES = 10                    # сколько ошибок отправляем на разбор
MAX_FIELD_CHARS = 1000               # длина вопроса / пояснения в разборе ошибок
MAX_OPTION_CHARS = 300               # длина одного варианта ответа
MAX_FLASHCARDS = 30                  # максимум карточек
MAX_PHOTOS = 5                       # сколько фото можно распознать за один раз
MAX_PHOTO_BYTES = 10 * 1024 * 1024   # размер одного фото: 10 МБ

MAX_SAVED_QUESTIONS = 30             # сколько вопросов можно сохранить в одном квизе
MAX_LIST_ITEMS = 100                 # сколько элементов отдаём в списках (квизы, история, чаты)
MAX_MESSAGE_CHARS = 20000            # длина одного сообщения чата в базе
MAX_CHAT_MESSAGES = 500              # сколько сообщений загружаем из одной сессии
DAILY_AI_LIMIT = 50                  # сколько запросов к ИИ в сутки можно одному пользователю

# Большие документы (хранятся в Supabase частями, см. supabase/documents.sql)
MAX_DOC_UPLOAD_BYTES = 20 * 1024 * 1024  # размер файла для «Загрузить большой файл»: 20 МБ
MAX_PAGES = 400                      # страниц в одном PDF
MAX_DOC_CHARS = 1_500_000            # символов текста в одном документе
MAX_DOCUMENTS = 10                   # документов у одного пользователя
MAX_TOTAL_DOC_CHARS = 3_000_000      # символов во всех документах пользователя
CHUNK_SIZE = 1500                    # длина одной части (символов)
CHUNK_OVERLAP = 200                  # сколько символов соседние части повторяют друг у друга
MAX_CONTEXT_CHARS = 15000            # сколько текста документа отправляем ИИ за один запрос
CHAT_TOP_CHUNKS = 5                  # сколько найденных частей получает чат
MAX_MAPREDUCE_CALLS = 8              # максимум вызовов ИИ на один конспект/план/карточки по документу

# Supabase (вход и хранение данных). URL и anon/publishable-ключ публичные.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
# Секретный ключ: только на сервере и только для удаления пользователя. Необязательный.
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

client = genai.Client(
    api_key=GEMINI_API_KEY,
    http_options=types.HttpOptions(timeout=60000),
)
