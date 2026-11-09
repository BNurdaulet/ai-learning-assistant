from pydantic import BaseModel


class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class Quiz(BaseModel):
    questions: list[QuizQuestion]


class QuizRequest(BaseModel):
    topic: str = ""
    count: int
    difficulty: str
    material: str = ""


class ChatMessage(BaseModel):
    role: str  # "user" или "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    material: str = ""
    style: str = "tutor"


# --- Разбор ошибок ---

class Mistake(BaseModel):
    question: str
    options: list[str] = []
    chosen: str          # что выбрал пользователь
    correct: str         # правильный вариант
    explanation: str = ""


class ReviewRequest(BaseModel):
    mistakes: list[Mistake]
    topic: str = ""
    material: str = ""


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


class FlashcardsRequest(BaseModel):
    topic: str = ""
    material: str = ""
    count: int = 10


# --- Конспект и план ---

class StudyRequest(BaseModel):
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
