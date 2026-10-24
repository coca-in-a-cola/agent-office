"""Regression tests for API authentication boundaries, CSRF, and role grants."""
from __future__ import annotations

import json
import time
import unittest
import urllib.error
import urllib.request
from typing import Any

from tests.test_auth_miniapp import TestAuthServerEndpoints


class TestApiAuthBoundary(TestAuthServerEndpoints):
    """Verifies fail-closed authentication barrier, CSRF Origin checking, and RBAC on API endpoints."""

    def _request(
        self,
        path: str,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
    ) -> tuple[int, Any]:
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(content)
            except Exception:
                return resp.status, content

    def test_anonymous_api_endpoints_return_401(self):
        """Anonymous GET requests to state, grid, workflow templates, and editor drafts must yield 401."""
        endpoints = [
            "/api/state",
            "/api/office/grid",
            "/api/workflow/templates",
            "/api/editor/drafts",
        ]
        for ep in endpoints:
            with self.subTest(endpoint=ep):
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    self._request(ep, method="GET")
                self.assertEqual(ctx.exception.code, 401)

    def test_malformed_cookie_returns_401(self):
        """Requests with non-existent or malformed session cookies must yield 401."""
        bad_cookies = [
            "session=non_existent_token_12345",
            "session=",
            "other_cookie=value",
            "malformed;;;cookie",
        ]
        for cookie in bad_cookies:
            with self.subTest(cookie=cookie):
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    self._request(
                        "/api/state",
                        method="GET",
                        headers={"Cookie": cookie},
                    )
                self.assertEqual(ctx.exception.code, 401)

    def test_expired_session_returns_401(self):
        """Requests with an expired session token must be rejected with 401."""
        session = self.session_store.create_session(
            user_id="md_user",
            role="managing_director",
            name="MD",
            ttl_seconds=3600,
        )
        token = session["token"]

        # Directly expire the session in the session SQLite database
        with self.session_store._lock, self.session_store._db:
            self.session_store._db.execute(
                "UPDATE auth_sessions SET expires_at = ? WHERE token = ?",
                (time.time() - 60, token),
            )
            self.session_store._db.commit()

        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._request(
                "/api/state",
                method="GET",
                headers={"Cookie": f"session={token}"},
            )
        self.assertEqual(ctx.exception.code, 401)

    def test_guest_post_grid_returns_403_and_db_unchanged(self):
        """A guest role POST to /api/office/grid must yield 403 and leave grid data untouched."""
        guest_session = self.session_store.create_session(
            user_id="guest_user",
            role="guest",
            name="Guest User",
        )
        initial_grid = self.storage.get_campus_grid()

        payload = json.dumps({"furniture": [{"id": "unauthorized_desk"}]}).encode("utf-8")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._request(
                "/api/office/grid",
                method="POST",
                headers={
                    "Cookie": f"session={guest_session['token']}",
                    "Origin": f"http://127.0.0.1:{self.port}",
                    "Content-Type": "application/json",
                },
                data=payload,
            )
        self.assertEqual(ctx.exception.code, 403)
        self.assertEqual(self.storage.get_campus_grid(), initial_grid)

    def test_managing_director_post_grid_succeeds_with_empty_furniture(self):
        """Managing director POST to /api/office/grid with matching Origin succeeds with empty furniture."""
        md_session = self.session_store.create_session(
            user_id="1273224594",
            role="managing_director",
            name="Managing Director",
        )
        payload = json.dumps({"furniture": []}).encode("utf-8")
        status, data = self._request(
            "/api/office/grid",
            method="POST",
            headers={
                "Cookie": f"session={md_session['token']}",
                "Origin": f"http://127.0.0.1:{self.port}",
                "Content-Type": "application/json",
            },
            data=payload,
        )
        self.assertEqual(status, 200)
        self.assertEqual(data.get("status"), "ok")
        self.assertTrue(data.get("saved"))

        saved_grid = self.storage.get_campus_grid()
        self.assertIsNotNone(saved_grid)
        self.assertEqual(saved_grid.get("furniture"), [])

    def test_mismatched_origin_post_grid_returns_403(self):
        """POST with mismatched Origin header must be rejected with 403 CSRF error."""
        md_session = self.session_store.create_session(
            user_id="1273224594",
            role="managing_director",
            name="Managing Director",
        )
        payload = json.dumps({"furniture": []}).encode("utf-8")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._request(
                "/api/office/grid",
                method="POST",
                headers={
                    "Cookie": f"session={md_session['token']}",
                    "Origin": "http://evil-attacker.com",
                    "Content-Type": "application/json",
                },
                data=payload,
            )
        self.assertEqual(ctx.exception.code, 403)

    def test_health_and_spa_return_200(self):
        """Unauthenticated GET /api/health and SPA root / return HTTP 200."""
        status_health, data_health = self._request("/api/health", method="GET")
        self.assertEqual(status_health, 200)
        self.assertEqual(data_health.get("status"), "ok")

        status_spa, content_spa = self._request("/", method="GET")
        self.assertEqual(status_spa, 200)
        self.assertIn("App", content_spa)


if __name__ == "__main__":
    unittest.main()
