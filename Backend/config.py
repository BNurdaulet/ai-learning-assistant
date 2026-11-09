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

MAX_SAVED_QUESTIONS = 30             # сколько вопросов можно сохранить в одном квизе
MAX_LIST_ITEMS = 100                 # сколько элементов отдаём в списках (квизы, история, чаты)
MAX_MESSAGE_CHARS = 20000            # длина одного сообщения чата в базе
MAX_CHAT_MESSAGES = 500              # сколько сообщений загружаем из одной сессии
DAILY_AI_LIMIT = 50                  # сколько запросов к ИИ в сутки можно одному пользователю

# Supabase (вход и хранение данных). URL и anon/publishable-ключ публичные.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
# Секретный ключ: только на сервере и только для удаления пользователя. Необязательный.
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

client = genai.Client(
    api_key=GEMINI_API_KEY,
    http_options=types.HttpOptions(timeout=60000),
)
