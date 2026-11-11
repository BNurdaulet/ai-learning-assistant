"""Тесты статистики фокуса: проверка данных, недельная сводка, маршруты /focus, удаление аккаунта.

Supabase подменён — настоящие внешние сервисы не вызываются.
Запуск из корня проекта:  python -m unittest discover tests
"""
import os
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ["SUPABASE_URL"] = "https://test.supabase.invalid"
os.environ["SUPABASE_ANON_KEY"] = "sb_publishable_test"
os.environ.setdefault("GEMINI_API_KEY", "test")

import focus  # noqa: E402
import supabase_db  # noqa: E402
import userdata  # noqa: E402
from auth import User, current_user  # noqa: E402
from errors import AppError  # noqa: E402
from test_assignments import FakeHttp  # noqa: E402

USER = User(id="11111111-1111-4111-8111-111111111111", token="user-token")
SESSION_ID = "00000000-0000-4000-8000-019a7b2c3d4e"


class ParseDayTest(unittest.TestCase):
    TODAY = date(2026, 11, 11)

    def test_ok_and_window(self):
        self.assertEqual(focus.parse_day("2026-11-11", self.TODAY), self.TODAY)
        self.assertEqual(focus.parse_day("2026-11-13", self.TODAY), date(2026, 11, 13))  # часовой пояс +14
        self.assertEqual(focus.parse_day("2026-11-09", self.TODAY), date(2026, 11, 9))

    def test_rejected(self):
        for bad in ["2026-11-14", "2026-11-08", "2025-11-11", "2026-13-01", "2026-02-30",
                    "11.11.2026", "", "2026-11-11T00:00", None, 20261111, "2026-1-11"]:
            with self.assertRaises(AppError, msg=repr(bad)) as ctx:
                focus.parse_day(bad, self.TODAY)
            self.assertEqual(ctx.exception.code, "invalid_day")


class SummarizeTest(unittest.TestCase):
    def test_seven_days_with_zero_fill_and_junk_ignored(self):
        today = date(2026, 11, 11)
        rows = [
            {"day": "2026-11-11", "minutes": 25},
            {"day": "2026-11-11", "minutes": 25},
            {"day": "2026-11-05", "minutes": 50},
            {"day": "2026-11-04", "minutes": 25},   # вне недели
            {"day": "2026-11-10", "minutes": "25"},  # не число
            {"minutes": 10},
        ]
        s = focus.summarize(rows, today)
        self.assertEqual([d["day"] for d in s["days"]],
                         [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)])
        self.assertEqual(s["days"][-1], {"day": "2026-11-11", "minutes": 50, "sessions": 2})
        self.assertEqual(s["days"][0], {"day": "2026-11-05", "minutes": 50, "sessions": 1})
        self.assertEqual(s["total_minutes"], 100)
        self.assertEqual(s["total_sessions"], 3)


class FocusRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import app as app_module
        cls.app = app_module.app
        cls.client = TestClient(app_module.app)

    def setUp(self):
        self.old_http = supabase_db.http
        self.app.dependency_overrides[current_user] = lambda: USER

    def tearDown(self):
        supabase_db.http = self.old_http
        self.app.dependency_overrides.clear()

    def fake(self, handler):
        supabase_db.http = FakeHttp(handler)
        return supabase_db.http

    def today(self):
        return focus.utc_today().isoformat()

    def test_save_is_idempotent_insert(self):
        http = self.fake(lambda method, url, kw: (201, []))
        r = self.client.post("/focus", json={"client_id": SESSION_ID, "day": self.today(), "minutes": 25})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"saved": True})
        call = http.calls[0]
        self.assertEqual(call.method, "POST")
        self.assertTrue(call.url.endswith("/rest/v1/focus_sessions"))
        self.assertEqual(call.params, {"on_conflict": "user_id,client_id"})
        self.assertEqual(call.headers["Prefer"], "resolution=ignore-duplicates")
        self.assertEqual(call.headers["Authorization"], "Bearer user-token")  # от имени пользователя (RLS)
        self.assertEqual(call.json, {"user_id": USER.id, "client_id": SESSION_ID,
                                     "day": self.today(), "minutes": 25})

    def test_save_validation_never_reaches_db(self):
        http = self.fake(lambda method, url, kw: (201, []))
        bad = [
            {"client_id": "not-a-uuid", "day": self.today(), "minutes": 25},
            {"client_id": SESSION_ID, "day": self.today(), "minutes": 0},
            {"client_id": SESSION_ID, "day": self.today(), "minutes": 121},
            {"client_id": SESSION_ID, "day": "1999-01-01", "minutes": 25},
        ]
        for body in bad:
            r = self.client.post("/focus", json=body)
            self.assertEqual(r.status_code, 400, body)
            self.assertIn(r.json()["detail"], ("invalid_focus_session", "invalid_day"))
        r = self.client.post("/focus", json={"client_id": SESSION_ID, "day": self.today()})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(http.calls, [])

    def test_stats(self):
        today = focus.utc_today()

        def handler(method, url, kw):
            return 200, [{"day": today.isoformat(), "minutes": 25}, {"day": today.isoformat(), "minutes": 30}]
        http = self.fake(handler)
        r = self.client.get("/focus/stats", params={"today": today.isoformat()})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data["days"]), 7)
        self.assertEqual(data["days"][-1], {"day": today.isoformat(), "minutes": 55, "sessions": 2})
        self.assertEqual(data["total_minutes"], 55)
        params = http.calls[0].params
        self.assertEqual(params["user_id"], f"eq.{USER.id}")
        start = (today - timedelta(days=6)).isoformat()
        self.assertEqual(params["and"], f"(day.gte.{start},day.lte.{today.isoformat()})")

    def test_stats_bad_day(self):
        self.fake(lambda method, url, kw: (200, []))
        r = self.client.get("/focus/stats", params={"today": "nope"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["detail"], "invalid_day")

    def test_table_missing_points_to_focus_sql(self):
        self.fake(lambda method, url, kw: (404, {"code": "PGRST205", "message": "missing"}))
        r = self.client.get("/focus/stats", params={"today": self.today()})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json(), {"detail": "db_not_configured", "params": {"script": "focus.sql"}})

    def test_requires_login(self):
        self.app.dependency_overrides.clear()
        r = self.client.get("/focus/stats", params={"today": self.today()})
        self.assertEqual(r.status_code, 401)


class DeleteAccountTest(unittest.TestCase):
    def setUp(self):
        self.old_http = supabase_db.http
        self.old_admin = supabase_db.admin_delete_user
        supabase_db.admin_delete_user = lambda user_id: False

    def tearDown(self):
        supabase_db.http = self.old_http
        supabase_db.admin_delete_user = self.old_admin

    def test_focus_sessions_deleted_and_missing_table_tolerated(self):
        def handler(method, url, kw):
            if url.endswith("/focus_sessions"):
                return 404, {"code": "PGRST205"}  # focus.sql ещё не запускали
            return 204, None
        supabase_db.http = FakeHttp(handler)
        result = userdata.delete_account(SimpleNamespace(id=USER.id, token=USER.token))
        self.assertTrue(result["data_deleted"])
        deleted = [c.url.rsplit("/", 1)[-1] for c in supabase_db.http.calls if c.method == "DELETE"]
        self.assertIn("focus_sessions", deleted)


if __name__ == "__main__":
    unittest.main()
