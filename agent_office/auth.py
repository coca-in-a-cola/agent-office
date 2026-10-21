"""Telegram WebApp verification and thread-safe, server-owned sessions."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qsl

SESSION_ROLES = {"owner", "managing_director", "operator", "guest"}


def validate_telegram_init_data(
    init_data: str, bot_token: str, max_age_seconds: int = 86400,
) -> Optional[dict[str, Any]]:
    """Return signed fields (with a decoded user) or None; never trust initDataUnsafe."""
    if not isinstance(init_data, str) or not bot_token or max_age_seconds < 0:
        return None
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
        fields = dict(pairs)
        if len(fields) != len(pairs):
            return None  # Reject ambiguous duplicate fields, including hash/user.
        received_hash = fields.pop("hash")
        if len(received_hash) != 64 or any(c not in "0123456789abcdef" for c in received_hash):
            return None
        check_string = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
        secret = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        expected = hmac.new(secret, check_string.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, received_hash):
            return None
        age = time.time() - int(fields["auth_date"])
        if age < 0 or age > max_age_seconds:
            return None
        user = json.loads(fields["user"])
        if not isinstance(user, dict) or type(user.get("id")) is not int or user["id"] <= 0:
            return None
        return {**fields, "user": user}
    except (KeyError, ValueError, TypeError, UnicodeError):
        return None


def telegram_role(user: dict[str, Any]) -> str:
    """Only Telegram-signed identity can invoke this privileged mapping."""
    if user.get("id") == 1273224594 or user.get("username") == "coca-in-a-cola":
        return "managing_director"
    return "guest"


class SessionStore:
    """SQLite sessions; defaults to memory, optionally survives server restarts."""

    def __init__(self, db_path: str | Path = ":memory:") -> None:
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(db_path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._db:
            self._db.execute("""CREATE TABLE IF NOT EXISTS auth_sessions (
                token TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL,
                name TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL
            )""")
            self._db.execute("CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at)")

    def create_session(
        self, user_id: str | int, role: str = "guest", name: str = "",
        ttl_seconds: int = 86400,
    ) -> dict[str, Any]:
        if role not in SESSION_ROLES or ttl_seconds <= 0:
            raise ValueError("invalid session role or lifetime")
        now = time.time()
        session = dict(token=secrets.token_urlsafe(32), user_id=str(user_id), role=role,
                       name=name, created_at=now, expires_at=now + ttl_seconds)
        with self._lock, self._db:
            self.cleanup_expired()
            self._db.execute("INSERT INTO auth_sessions VALUES (:token, :user_id, :role, :name, :created_at, :expires_at)", session)
        return session

    def get_session(self, token: str) -> Optional[dict[str, Any]]:
        with self._lock, self._db:
            row = self._db.execute("SELECT * FROM auth_sessions WHERE token = ?", (token,)).fetchone()
            if row is None:
                return None
            if row["expires_at"] <= time.time():
                self._db.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
                return None
            return dict(row)

    def revoke_session(self, token: str) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))

    def cleanup_expired(self) -> int:
        with self._lock, self._db:
            return self._db.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (time.time(),)).rowcount

    def close(self) -> None:
        with self._lock:
            self._db.close()
