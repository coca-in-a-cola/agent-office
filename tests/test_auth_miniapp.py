"""Unit tests for Telegram WebApp initData HMAC verification, SessionStore, and auth endpoints."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from agent_office.auth import SessionStore, telegram_role, validate_telegram_init_data
from agent_office.server import create_server
from agent_office.storage import OfficeStorage


def make_telegram_init_data(
    bot_token: str,
    user_data: dict[str, Any],
    auth_date: int | None = None,
    query_id: str = "AAHpGgAAAAAA...",
) -> str:
    """Helper to generate cryptographically valid Telegram WebApp initData."""
    if auth_date is None:
        auth_date = int(time.time())

    fields = {
        "auth_date": str(auth_date),
        "query_id": query_id,
        "user": json.dumps(user_data, separators=(",", ":")),
    }
    check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    calc_hash = hmac.new(secret, check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    fields["hash"] = calc_hash
    return urllib.parse.urlencode(fields)


class TestTelegramInitDataValidation(unittest.TestCase):
    bot_token = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"

    def test_valid_init_data_success(self):
        user = {"id": 1273224594, "first_name": "Дмитрий", "username": "coca-in-a-cola"}
        init_data = make_telegram_init_data(self.bot_token, user)
        res = validate_telegram_init_data(init_data, self.bot_token)
        self.assertIsNotNone(res)
        self.assertEqual(res["user"]["id"], 1273224594)
        self.assertEqual(res["user"]["username"], "coca-in-a-cola")

    def test_tampered_hash_fails(self):
        user = {"id": 1273224594, "first_name": "Дмитрий"}
        init_data = make_telegram_init_data(self.bot_token, user)
        # Tamper with the user ID in the query string
        tampered = init_data.replace("1273224594", "99999999")
        res = validate_telegram_init_data(tampered, self.bot_token)
        self.assertIsNone(res)

    def test_wrong_bot_token_fails(self):
        user = {"id": 1273224594, "first_name": "Дмитрий"}
        init_data = make_telegram_init_data(self.bot_token, user)
        res = validate_telegram_init_data(init_data, "987654321:DifferentToken")
        self.assertIsNone(res)

    def test_expired_auth_date_fails(self):
        user = {"id": 1273224594, "first_name": "Дмитрий"}
        old_time = int(time.time()) - 100000  # > 24 hours
        init_data = make_telegram_init_data(self.bot_token, user, auth_date=old_time)
        res = validate_telegram_init_data(init_data, self.bot_token, max_age_seconds=86400)
        self.assertIsNone(res)

    def test_role_mapping(self):
        dmitry_by_id = {"id": 1273224594, "first_name": "Дмитрий"}
        dmitry_by_username = {"id": 55555, "username": "coca-in-a-cola"}
        other_user = {"id": 999999, "username": "stranger"}
        self.assertEqual(telegram_role(dmitry_by_id), "managing_director")
        self.assertEqual(telegram_role(dmitry_by_username), "managing_director")
        self.assertEqual(telegram_role(other_user), "guest")


class TestSessionStore(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        db_path = Path(self.temp_dir.name) / "sessions.sqlite3"
        self.store = SessionStore(db_path)
        self.addCleanup(self.store.close)

    def test_session_lifecycle(self):
        session = self.store.create_session(
            user_id="1273224594", role="managing_director", name="Дмитрий", ttl_seconds=3600
        )
        token = session["token"]
        self.assertTrue(token)
        self.assertEqual(session["role"], "managing_director")

        fetched = self.store.get_session(token)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["user_id"], "1273224594")
        self.assertEqual(fetched["role"], "managing_director")

        # Revoke session
        self.store.revoke_session(token)
        self.assertIsNone(self.store.get_session(token))

    def test_session_expiration(self):
        session = self.store.create_session(
            user_id="test", role="guest", name="Test", ttl_seconds=1
        )
        token = session["token"]
        time.sleep(1.1)
        self.assertIsNone(self.store.get_session(token))


class TestAuthServerEndpoints(unittest.TestCase):
    bot_token = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.storage = OfficeStorage(db_path=self.root / "office.sqlite3")
        self.addCleanup(self.storage.close)
        static = self.root / "static"
        static.mkdir()
        (static / "index.html").write_text("<html>App</html>")

        self.session_store = SessionStore(self.root / "sessions.sqlite3")
        self.addCleanup(self.session_store.close)

        import threading
        self.server = create_server(
            host="127.0.0.1",
            port=0,
            storage=self.storage,
            static_dir=static,
            session_store=self.session_store,
            bot_token=self.bot_token,
            login_password="secret-admin-pass",
        )
        self.port = self.server.server_address[1]
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_telegram_auth_endpoint_and_cookie(self):
        user = {"id": 1273224594, "first_name": "Дмитрий", "username": "coca-in-a-cola"}
        init_data = make_telegram_init_data(self.bot_token, user)

        body = json.dumps({"initData": init_data}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/auth/telegram",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            set_cookie = resp.headers.get("Set-Cookie", "")

        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["user"]["role"], "managing_director")
        token = data["token"]
        self.assertIn("session=", set_cookie)
        self.assertIn("HttpOnly", set_cookie)

        # Test GET /api/auth/me with Cookie
        req_me = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/auth/me",
            headers={"Cookie": f"session={token}"},
            method="GET",
        )
        with urllib.request.urlopen(req_me) as resp:
            self.assertEqual(resp.status, 200)
            data_me = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data_me["user"]["role"], "managing_director")

        # Test logout
        req_logout = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/auth/logout",
            data=b"{}",
            headers={"Cookie": f"session={token}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req_logout) as resp:
            self.assertEqual(resp.status, 200)

        # Verify session is revoked
        req_me_after = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/auth/me",
            headers={"Cookie": f"session={token}"},
            method="GET",
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req_me_after)
        self.assertEqual(ctx.exception.code, 401)


if __name__ == "__main__":
    unittest.main()
