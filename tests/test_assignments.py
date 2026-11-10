"""Тесты заданий для учеников: подсчёт баллов, проверка ответов, имя, CSV, лимитер, маршруты.

Supabase и ИИ подменены — настоящие внешние сервисы не вызываются.
Запуск из корня проекта:  python -m unittest discover tests
"""
import json
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Backend"))

# Настройки до импорта модулей сервера: фиктивный Supabase, без ключей ИИ
os.environ["SUPABASE_URL"] = "https://test.supabase.invalid"
os.environ["SUPABASE_ANON_KEY"] = "sb_publishable_test"
os.environ.setdefault("GEMINI_API_KEY", "test")

import httpx  # noqa: E402

import assignments  # noqa: E402
import student  # noqa: E402
import supabase_db  # noqa: E402
from errors import AppError  # noqa: E402
from ratelimit import RateLimiter  # noqa: E402

QUIZ = {
    "questions": [
        {"question": "2+2", "options": ["3", "4", "5", "6"], "correct_index": 1, "explanation": ""},
        {"question": "Столица Франции", "options": ["Париж", "Рим"], "correct_index": 0, "explanation": ""},
        {"question": "H2O", "options": ["вода", "соль", "сахар"], "correct_index": 0, "explanation": ""},
    ]
}
CARDS = {"cards": [{"front": "a", "back": "1"}, {"front": "b", "back": "2"}, {"front": "c", "back": "3"}]}
CODE = "abcdefghijklmnopQRSTUV"  # 22 символа, как у token_urlsafe(16)


class GradeTest(unittest.TestCase):
    def test_quiz_all_correct(self):
        r = student.grade("quiz", QUIZ, {"choices": [1, 0, 0]})
        self.assertEqual(r, {"score": 3, "total": 3, "completed": True})

    def test_quiz_some_wrong_and_skipped(self):
        r = student.grade("quiz", QUIZ, {"choices": [2, 0, None]})
        self.assertEqual(r, {"score": 1, "total": 3, "completed": False})

    def test_quiz_none_correct(self):
        r = student.grade("quiz", QUIZ, {"choices": [0, 1, 2]})
        self.assertEqual(r["score"], 0)

    def test_flashcards(self):
        r = student.grade("flashcards", CARDS, {"known": [0, 2], "repeat": [1]})
        self.assertEqual(r, {"score": 2, "total": 3, "completed": True})

    def test_summary(self):
        r = student.grade("summary", {"text": "x"}, {"read": True})
        self.assertEqual(r, {"score": None, "total": None, "completed": True})


class ValidateAnswersTest(unittest.TestCase):
    def bad(self, kind, payload, answers):
        with self.assertRaises(AppError) as ctx:
            student.validate_answers(kind, payload, answers)
        self.assertEqual(ctx.exception.code, "invalid_answers")

    def test_quiz_ok_and_extra_fields_dropped(self):
        clean = student.validate_answers("quiz", QUIZ, {"choices": [1, None, 2], "score": 999})
        self.assertEqual(clean, {"choices": [1, None, 2]})

    def test_quiz_wrong_length(self):
        self.bad("quiz", QUIZ, {"choices": [1, 0]})
        self.bad("quiz", QUIZ, {"choices": [1, 0, 0, 0]})

    def test_quiz_out_of_range(self):
        self.bad("quiz", QUIZ, {"choices": [1, 2, 0]})   # у второго вопроса только 2 варианта
        self.bad("quiz", QUIZ, {"choices": [-1, 0, 0]})

    def test_quiz_wrong_types(self):
        self.bad("quiz", QUIZ, {"choices": ["1", 0, 0]})
        self.bad("quiz", QUIZ, {"choices": [1.0, 0, 0]})
        self.bad("quiz", QUIZ, {"choices": [True, 0, 0]})  # bool — не номер варианта
        self.bad("quiz", QUIZ, {"choices": "1,0,0"})
        self.bad("quiz", QUIZ, {})
        self.bad("quiz", QUIZ, [1, 0, 0])

    def test_flashcards_ok(self):
        clean = student.validate_answers("flashcards", CARDS, {"known": [2], "repeat": [0, 1]})
        self.assertEqual(clean, {"known": [2], "repeat": [0, 1]})

    def test_flashcards_must_rate_each_card_once(self):
        self.bad("flashcards", CARDS, {"known": [0, 1], "repeat": []})        # не все
        self.bad("flashcards", CARDS, {"known": [0, 1, 1], "repeat": []})     # повтор
        self.bad("flashcards", CARDS, {"known": [0, 1], "repeat": [1]})       # в обоих списках
        self.bad("flashcards", CARDS, {"known": [0, 1, 3], "repeat": []})     # нет такой карточки
        self.bad("flashcards", CARDS, {"known": [0, 1, False], "repeat": []})
        self.bad("flashcards", CARDS, {"known": [0, 1, 2]})                   # нет repeat

    def test_summary(self):
        self.assertEqual(student.validate_answers("summary", {}, {"read": True}), {"read": True})
        self.bad("summary", {}, {"read": "true"})
        self.bad("summary", {}, {"read": 1})
        self.bad("summary", {}, {})

    def test_unknown_type(self):
        self.bad("essay", {}, {"read": True})


class NameTest(unittest.TestCase):
    def test_trim_and_collapse(self):
        self.assertEqual(student.clean_name("  Аня   К.  "), "Аня К.")

    def test_limit_40(self):
        self.assertEqual(len(student.clean_name("я" * 100)), 40)

    def test_control_chars_removed(self):
        self.assertEqual(student.clean_name("Ан\x00я\n\tБ"), "Ан я Б")

    def test_empty_rejected(self):
        for raw in ("", "   ", "\n\t", None, 5):
            with self.assertRaises(AppError):
                student.clean_name(raw)


class CsvTest(unittest.TestCase):
    def test_formula_injection_escaped(self):
        for value in ("=1+2", "+7", "-1", "@SUM(A1)", "\tx", "\rx", '=HYPERLINK("http://x")'):
            self.assertEqual(assignments.csv_safe(value), "'" + value)

    def test_normal_text_unchanged(self):
        for value in ("Аня", "1+1", "a=b", "", "Ann-Marie"):
            self.assertEqual(assignments.csv_safe(value), value)
        self.assertEqual(assignments.csv_safe(None), "")

    def test_results_csv(self):
        attempts = [
            {"student_name": "=cmd", "score": 2, "total": 3, "completed": True,
             "duration_seconds": 75, "created_at": "2026-11-10T14:05:00+00:00", "answers": {}},
            {"student_name": "Боря", "score": 0, "total": 3, "completed": False,
             "duration_seconds": None, "created_at": "2026-11-10T15:00:00+00:00", "answers": {}},
        ]
        text = assignments.results_csv("quiz", attempts, "ru")
        self.assertTrue(text.startswith("﻿"))
        lines = text[1:].splitlines()
        self.assertEqual(lines[0].split(",")[0], "Имя")
        self.assertEqual(lines[1], "'=cmd,выполнено,2,3,67,,,2026-11-10 14:05,75")
        self.assertEqual(lines[2], "Боря,не все ответы,0,3,0,,,2026-11-10 15:00,")

    def test_csv_headers_translated(self):
        for lang, first in (("ru", "Имя"), ("kk", "Аты"), ("en", "Name"), ("xx", "Имя")):
            header = assignments.results_csv("quiz", [], lang)[1:].splitlines()[0]
            self.assertEqual(header.split(",")[0], first)

    def test_flashcards_csv_counts(self):
        attempts = [{"student_name": "A", "score": 2, "total": 3, "completed": True,
                     "created_at": "2026-11-10T14:05:00Z", "answers": {"known": [0, 1], "repeat": [2]}}]
        line = assignments.results_csv("flashcards", attempts, "en")[1:].splitlines()[1]
        self.assertEqual(line, "A,completed,,,,2,1,2026-11-10 14:05,")


class RateLimiterTest(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.limiter = RateLimiter(3, window=60, clock=lambda: self.now)

    def test_limit_and_window(self):
        self.assertEqual([self.limiter.hit("ip") for _ in range(4)], [True, True, True, False])
        self.now += 30
        self.assertFalse(self.limiter.hit("ip"))
        self.now += 31  # первые запросы вышли из окна
        self.assertTrue(self.limiter.hit("ip"))

    def test_keys_are_separate(self):
        for _ in range(3):
            self.limiter.hit("a")
        self.assertFalse(self.limiter.hit("a"))
        self.assertTrue(self.limiter.hit("b"))

    def test_memory_bounded(self):
        limiter = RateLimiter(1, window=60, clock=lambda: self.now, max_keys=5)
        for i in range(5):
            limiter.hit(f"ip{i}")
        self.now += 61
        limiter.hit("new")
        self.assertLessEqual(len(limiter._hits), 5)


class FakeHttp:
    """Подмена httpx.Client: записывает запросы и отвечает заранее заданными ответами."""

    def __init__(self, handler):
        self.handler = handler
        self.calls = []

    def _respond(self, method, url, **kw):
        self.calls.append(SimpleNamespace(method=method, url=url, **kw))
        status, body = self.handler(method, url, kw)
        # Как PostgREST: функция, вернувшая null, отвечает телом "null"; 204 — пустым телом
        content = b"" if status == 204 else json.dumps(body).encode()
        return httpx.Response(status, content=content, request=httpx.Request(method, url))

    def request(self, method, url, **kw):
        return self._respond(method, url, **kw)

    def post(self, url, **kw):
        return self._respond("POST", url, **kw)

    def get(self, url, **kw):
        return self._respond("GET", url, **kw)


class StudentRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import app as app_module
        cls.app_module = app_module
        cls.client = TestClient(app_module.app)

    def setUp(self):
        self.old_http = supabase_db.http
        self.old_min = student.MIN_UNAVAILABLE_SECONDS
        student.MIN_UNAVAILABLE_SECONDS = 0  # тесты не ждут
        self.app_module.READ_LIMITER._hits.clear()
        self.app_module.SUBMIT_LIMITER._hits.clear()

    def tearDown(self):
        supabase_db.http = self.old_http
        student.MIN_UNAVAILABLE_SECONDS = self.old_min

    def fake(self, handler):
        supabase_db.http = FakeHttp(handler)
        return supabase_db.http

    def quiz_db(self, submit_result=None):
        def handler(method, url, kw):
            if url.endswith("/rpc/get_assignment_by_code"):
                if kw["json"]["p_code"] == CODE:
                    return 200, {"type": "quiz", "title": "Тест", "payload": QUIZ}
                return 200, None
            if url.endswith("/rpc/submit_attempt"):
                return 200, submit_result or {"score": 2, "total": 3, "completed": True}
            return 500, None
        return self.fake(handler)

    def test_get_assignment(self):
        http = self.quiz_db()
        r = self.client.get(f"/api/a/{CODE}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["type"], "quiz")
        self.assertEqual(len(r.json()["questions"]), 3)
        self.assertIn("noindex", r.headers["x-robots-tag"])
        # Только публичный ключ, без токена пользователя и без секретного ключа
        self.assertEqual(http.calls[0].headers, {"apikey": "sb_publishable_test"})

    def test_bad_codes_look_the_same(self):
        http = self.quiz_db()
        missing = self.client.get("/api/a/" + "x" * 22)
        malformed = self.client.get("/api/a/short")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json(), malformed.json())
        self.assertEqual(missing.json()["detail"], "assignment_unavailable")
        self.assertEqual(len(http.calls), 1)  # кривой код даже не идёт в базу

    def test_submit_sends_clean_data(self):
        http = self.quiz_db()
        r = self.client.post(f"/api/a/{CODE}/submit", json={
            "name": "  Аня  ", "answers": {"choices": [1, 0, 1], "score": 3}, "duration_seconds": 999999,
        })
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"score": 2, "total": 3, "completed": True})
        args = http.calls[-1].json
        self.assertEqual(args["p_name"], "Аня")
        self.assertEqual(args["p_answers"], {"choices": [1, 0, 1]})  # присланный score отброшен
        self.assertEqual(args["p_duration"], 86400)

    def test_submit_invalid_answers_not_sent_to_db(self):
        http = self.quiz_db()
        r = self.client.post(f"/api/a/{CODE}/submit", json={"name": "Аня", "answers": {"choices": [9, 0, 0]}})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["detail"], "invalid_answers")
        self.assertFalse(any(c.url.endswith("submit_attempt") for c in http.calls))

    def test_db_errors_mapped(self):
        def handler(method, url, kw):
            if url.endswith("get_assignment_by_code"):
                return 200, {"type": "summary", "title": "", "payload": {"text": "t"}}
            return 400, {"code": "P0001", "message": "attempts_limit"}
        self.fake(handler)
        r = self.client.post(f"/api/a/{CODE}/submit", json={"name": "A", "answers": {"read": True}})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"], "attempts_limit")

    def test_body_too_large(self):
        self.quiz_db()
        r = self.client.post(f"/api/a/{CODE}/submit", content=b"x" * 70000,
                             headers={"Content-Type": "application/json"})
        self.assertEqual(r.status_code, 413)

    def test_rate_limit(self):
        self.quiz_db()
        limiter = self.app_module.READ_LIMITER
        old = limiter.limit
        limiter.limit = 2
        try:
            codes = [self.client.get(f"/api/a/{CODE}").status_code for _ in range(3)]
        finally:
            limiter.limit = old
        self.assertEqual(codes, [200, 200, 429])

    def test_student_page_served(self):
        r = self.client.get(f"/a/{CODE}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("noindex", r.headers["x-robots-tag"])

    def test_teacher_routes_need_login(self):
        self.assertEqual(self.client.get("/assignments").status_code, 401)
        self.assertEqual(self.client.delete("/attempts/x").status_code, 401)


class TeacherTest(unittest.TestCase):
    def setUp(self):
        self.old_http = supabase_db.http
        self.user = SimpleNamespace(id="11111111-1111-1111-1111-111111111111", token="teacher-token")

    def tearDown(self):
        supabase_db.http = self.old_http

    def test_create_quiz_assignment(self):
        sent = {}

        def handler(method, url, kw):
            sent.update(kw["json"])
            return 201, [{"id": "a1", "code": kw["json"]["code"], "type": "quiz", "title": "T",
                          "is_open": True, "created_at": "2026-11-10T00:00:00Z"}]
        supabase_db.http = FakeHttp(handler)
        data = SimpleNamespace(type="quiz", title="  Тема  1 ", difficulty="средняя", content_lang="kk",
                               questions=[SimpleNamespace(**q, ) for q in QUIZ["questions"]], cards=[], text="")
        result = assignments.create_assignment(self.user, data)
        self.assertGreaterEqual(len(sent["code"]), 16)
        self.assertRegex(sent["code"], r"^[A-Za-z0-9_-]+$")
        self.assertEqual(sent["title"], "Тема 1")
        self.assertEqual(len(sent["payload"]["questions"]), 3)
        self.assertEqual(result["attempt_count"], 0)
        self.assertEqual(sent["content_lang"], "kk")

    def test_unknown_content_lang_dropped(self):
        sent = {}

        def handler(method, url, kw):
            sent.update(kw["json"])
            return 201, [{"id": "a1"}]
        supabase_db.http = FakeHttp(handler)
        data = SimpleNamespace(type="summary", title="", difficulty="", content_lang="fr; drop table",
                               questions=[], cards=[], text="Текст")
        assignments.create_assignment(self.user, data)
        self.assertEqual(sent["content_lang"], "")
        self.assertEqual(sent["payload"], {"text": "Текст"})

    def test_codes_are_unique(self):
        self.assertEqual(len({assignments.new_code() for _ in range(1000)}), 1000)

    def test_empty_and_unknown_type(self):
        for data, code in (
            (SimpleNamespace(type="quiz", questions=[], cards=[], text="", difficulty=""), "assignment_empty"),
            (SimpleNamespace(type="summary", questions=[], cards=[], text="  ", difficulty=""), "assignment_empty"),
            (SimpleNamespace(type="essay", questions=[], cards=[], text="x", difficulty=""), "invalid_assignment_type"),
        ):
            with self.assertRaises(AppError) as ctx:
                assignments.clean_payload(data)
            self.assertEqual(ctx.exception.code, code)

    def test_cleanup_uses_cutoff(self):
        http = FakeHttp(lambda m, u, kw: (204, None))
        supabase_db.http = http
        assignments.cleanup_old_attempts(self.user, now=datetime(2026, 11, 10, tzinfo=timezone.utc))
        call = http.calls[0]
        self.assertEqual(call.method, "DELETE")
        self.assertTrue(call.url.endswith("/attempts"))
        self.assertEqual(call.params, {"created_at": "lt.2026-05-14T00:00:00Z"})
        self.assertEqual(call.headers["Authorization"], "Bearer teacher-token")

    def test_list_counts(self):
        def handler(method, url, kw):
            if method == "DELETE":
                return 204, None
            return 200, [{"id": "a", "attempts": [{"count": 4}]}, {"id": "b", "attempts": []}]
        supabase_db.http = FakeHttp(handler)
        rows = assignments.list_assignments(self.user)
        self.assertEqual([r["attempt_count"] for r in rows], [4, 0])


if __name__ == "__main__":
    unittest.main()
