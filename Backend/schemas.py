from typing import Any

from pydantic import BaseModel, Field


class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class Quiz(BaseModel):
    questions: list[QuizQuestion]


class Lang(BaseModel):
    """Язык интерфейса (ru, kk, en): на нём ИИ пишет ответ. Неизвестный код = ru (см. ai.clean_lang)."""
    lang: str = "ru"


class DocumentScope(Lang):
    """Необязательная работа по загруженному документу (вместо поля material).
    scope: "all" — весь документ, "pages" — страницы page_from–page_to, "topic" — поиск по теме."""
    document_id: str | None = None
    scope: str = "all"
    page_from: int | None = None
    page_to: int | None = None


class QuizRequest(DocumentScope):
    topic: str = ""
    count: int
    difficulty: str
    material: str = ""


class ChatMessage(BaseModel):
    role: str  # "user" или "assistant"
    content: str


class ChatRequest(Lang):
    messages: list[ChatMessage]
    material: str = ""
    style: str = "tutor"
    document_id: str | None = None  # если указан, ответ ищется в документе


# --- Разбор ошибок ---

class Mistake(BaseModel):
    question: str
    options: list[str] = []
    chosen: str          # что выбрал пользователь
    correct: str         # правильный вариант
    explanation: str = ""


class ReviewRequest(Lang):
    mistakes: list[Mistake]
    topic: str = ""
    material: str = ""
    document_id: str | None = None


class MistakeReview(BaseModel):
    why_wrong: str                 # почему выбранный ответ неверен
    concept: str                   # что повторить
    practice: list[QuizQuestion]   # новые похожие вопросы


class ReviewResult(BaseModel):
    items: list[MistakeReview]
    topics: list[str]


# --- Карточки ---

class Flashcard(BaseModel):
    front: str
    back: str


class Flashcards(BaseModel):
    cards: list[Flashcard]


class FlashcardsRequest(DocumentScope):
    topic: str = ""
    material: str = ""
    count: int = 10


# --- Конспект и план ---

class StudyRequest(DocumentScope):
    kind: str  # "summary" или "plan"
    topic: str = ""
    material: str = ""


# --- Данные пользователя (Supabase) ---

class SaveQuizRequest(BaseModel):
    topic: str = ""
    difficulty: str = ""
    questions: list[QuizQuestion]


class SaveResultRequest(BaseModel):
    quiz_id: str | None = None   # если квиз сохранён
    topic: str = ""
    score: int
    total: int
    mistakes: list[Mistake] = []


class CreateChatRequest(BaseModel):
    title: str = ""
    style: str = "tutor"


class SaveMessagesRequest(BaseModel):
    messages: list[ChatMessage]


# --- Задания для учеников ---

class CreateAssignmentRequest(BaseModel):
    """Учитель публикует задание. Заполняется поле по типу:
    quiz -> questions, flashcards -> cards, summary -> text."""
    type: str                      # "quiz", "flashcards" или "summary"
    title: str = ""
    content_lang: str = ""         # на каком языке ИИ составил содержимое: ru, kk, en или пусто
    difficulty: str = ""
    questions: list[QuizQuestion] = []
    cards: list[Flashcard] = []
    text: str = ""


class UpdateAssignmentRequest(BaseModel):
    is_open: bool


class SubmitAttemptRequest(BaseModel):
    """Ученик сдаёт задание. answers проверяются вручную по сохранённому заданию (student.py):
    квиз {"choices": [...]}, карточки {"known": [...], "repeat": [...]}, конспект {"read": true}."""
    name: str = Field(max_length=200)  # длиннее — точно не имя; обрезаем до 40 в student.py
    answers: dict[str, Any]
    duration_seconds: int | None = None
