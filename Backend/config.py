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

client = genai.Client(
    api_key=GEMINI_API_KEY,
    http_options=types.HttpOptions(timeout=60000),
)
