"""Защита публичных маршрутов для учеников (без входа): лимит запросов с одного IP
и ограничение размера тела запроса.

ВАЖНО (ограничения простого лимитера в памяти):
* Счётчики живут в памяти одного процесса. На Render они обнуляются при перезапуске
  и «засыпании» бесплатного сервиса, а если запущено несколько экземпляров (instances),
  у каждого свои счётчики. Это защита от случайного потока запросов, а не от
  распределённой атаки.
* IP берём из X-Forwarded-For (первый адрес — клиент, так передаёт прокси Render).
  Этот заголовок клиент может подделать, поэтому лимитер обходим. Главная защита
  всё равно в базе: лимит попыток на задание и проверка ответов в submit_attempt.
"""
import threading
import time
from collections import deque

from fastapi import HTTPException
from fastapi.responses import JSONResponse

BODY_TOO_LARGE = "body_too_large"


class RateLimiter:
    """Скользящее окно: не больше limit запросов за window секунд с одного ключа (IP)."""

    def __init__(self, limit, window=60.0, clock=time.monotonic, max_keys=10000):
        self.limit = limit
        self.window = window
        self.clock = clock
        self.max_keys = max_keys
        self._hits = {}  # ключ -> deque времён запросов
        self._lock = threading.Lock()  # обычные (не async) маршруты FastAPI идут в разных потоках

    def hit(self, key):
        """Засчитывает запрос. True — можно, False — лимит исчерпан."""
        now = self.clock()
        with self._lock:
            if key not in self._hits and len(self._hits) >= self.max_keys:
                self._forget_old(now)
            times = self._hits.setdefault(key, deque())
            while times and times[0] <= now - self.window:
                times.popleft()
            if len(times) >= self.limit:
                return False
            times.append(now)
            return True

    def _forget_old(self, now):
        """Чтобы память не росла бесконечно: убираем IP без запросов в текущем окне."""
        for key in [k for k, t in self._hits.items() if not t or t[-1] <= now - self.window]:
            del self._hits[key]
        if len(self._hits) >= self.max_keys:
            self._hits.clear()  # крайний случай: слишком много разных IP сразу


def client_ip(request):
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    if first:
        return first[:64]
    return request.client.host if request.client else "unknown"


class _TooLarge(HTTPException):
    def __init__(self):
        super().__init__(status_code=413, detail=BODY_TOO_LARGE)


class BodySizeLimit:
    """ASGI-прослойка: для путей с prefix тело запроса не больше max_bytes.
    Проверяет и заголовок Content-Length, и реально полученные байты (на случай chunked)."""

    def __init__(self, app, prefix, max_bytes):
        self.app = app
        self.prefix = prefix
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith(self.prefix):
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                if not value.isdigit() or int(value) > self.max_bytes:
                    await JSONResponse({"detail": BODY_TOO_LARGE}, status_code=413)(scope, receive, send)
                    return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # HTTPException FastAPI пропускает как есть и отвечает {"detail": "body_too_large"}
                    raise _TooLarge()
            return message

        await self.app(scope, limited_receive, send)
