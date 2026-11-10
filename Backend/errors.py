"""Ошибки и пояснения для пользователя — кодами, а не текстом.

Сервер отвечает {"detail": "file_too_large", "params": {"max_mb": 10}},
а текст на нужном языке фронтенд берёт из словаря Frontend/i18n/<язык>.json
(ключи errors.<код> и notes.<код>).
"""


class AppError(Exception):
    """Ошибка, которую видит пользователь. code — ключ errors.<code> в словаре."""

    def __init__(self, status_code, code, **params):
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.params = params


def note(code, **params):
    """Пояснение к результату (например, «использованы страницы 3–10»): ключ notes.<code>."""
    return {"code": code, "params": params}
