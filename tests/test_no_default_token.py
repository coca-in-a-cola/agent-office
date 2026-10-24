"""Local-only regressions for opt-in bearer authentication."""
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from agent_office.auth import SessionStore
from agent_office.server import create_server
from agent_office.storage import OfficeStorage


class NoDefaultTokenTests(unittest.TestCase):
    def start_server(self, environment_token=None, **kwargs):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        storage = OfficeStorage(db_path=root / "office.sqlite3")
        self.addCleanup(storage.close)
        sessions = SessionStore(":memory:")
        self.addCleanup(sessions.close)
        # Scope only this setting; never clear or dump the caller's environment.
        with patch.dict(os.environ):
            os.environ.pop("AGENT_OFFICE_AUTH_TOKEN", None)
            if environment_token is not None:
                os.environ["AGENT_OFFICE_AUTH_TOKEN"] = environment_token
            server = create_server(port=0, storage=storage, static_dir=root,
                                   session_store=sessions, **kwargs)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever,
                                  kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        return server

    def request_status(self, server, path, token=None, body=None):
        headers = {}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_address[1]}{path}",
            headers=headers, data=data)
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status
        except urllib.error.HTTPError as error:
            error.close()
            return error.code

    def test_missing_token_rejects_legacy_bearer_and_login(self):
        server = self.start_server(login_password="fixture-password")
        self.assertFalse(server.auth_token)
        self.assertEqual(self.request_status(server, "/api/state"), 401)
        self.assertEqual(self.request_status(
            server, "/api/state", token="trusted-local-token"), 401)
        self.assertEqual(self.request_status(
            server, "/api/auth/login", body={"token": "trusted-local-token"}), 401)
        self.assertEqual(self.request_status(
            server, "/api/auth/login", body={"password": "fixture-password"}), 200)

    def test_explicit_fixture_token_still_authorizes(self):
        server = self.start_server(auth_token="fixture-token")
        self.assertEqual(self.request_status(server, "/api/state", token="fixture-token"), 200)

    def test_environment_token_still_authorizes(self):
        server = self.start_server(environment_token="fixture-environment-token")
        self.assertEqual(self.request_status(
            server, "/api/state", token="fixture-environment-token"), 200)

    def test_empty_explicit_token_disables_environment_token(self):
        server = self.start_server(environment_token="fixture-environment-token", auth_token="")
        self.assertFalse(server.auth_token)
        self.assertEqual(self.request_status(
            server, "/api/state", token="fixture-environment-token"), 401)


if __name__ == "__main__":
    unittest.main()
