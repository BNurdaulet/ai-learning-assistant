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
