"""Unit tests for Agent Office HTTP server, API endpoints, and state serialization."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

from agent_office.auth import SessionStore
from agent_office.events import Event
from agent_office.server import (
    DEFAULT_WORKSTATIONS,
    OfficeRequestHandler,
    create_server,
    get_office_state,
    normalize_status,
)
from agent_office.storage import OfficeStorage


class TestStateSerialization(unittest.TestCase):
    """Test get_office_state logic, normalization, and fail-open resilience."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = Path(self.temp_dir) / "test_office.sqlite3"
        self.storage = OfficeStorage(db_path=self.db_path)

    def tearDown(self) -> None:
        self.storage.close()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_empty_storage_fallback(self) -> None:
        """When database is empty, get_office_state returns standard workstation roster."""
        state = get_office_state(self.storage)
        self.assertEqual(state["status"], "ok")
        self.assertTrue(state["meta"]["is_fallback"])
        agent_ids = {a["id"].lower() for a in state["agents"]}
        for expected in ("tyler", "artist", "coder", "devops", "qa"):
            self.assertIn(expected, agent_ids)

        # Tyler should be first
        self.assertEqual(state["agents"][0]["id"].lower(), "tyler")

    def test_normalize_status(self) -> None:
        """Verify normalization of status strings into standard visual profile badges."""
        self.assertEqual(normalize_status("working"), "working")
        self.assertEqual(normalize_status("typing"), "working")
        self.assertEqual(normalize_status("coding"), "working")
        self.assertEqual(normalize_status("in-progress"), "working")
        self.assertEqual(normalize_status("researching"), "researching")
        self.assertEqual(normalize_status("planning"), "researching")
        self.assertEqual(normalize_status("review"), "review")
        self.assertEqual(normalize_status("reviewing"), "review")
        self.assertEqual(normalize_status("blocked"), "blocked")
        self.assertEqual(normalize_status("failed"), "blocked")
        self.assertEqual(normalize_status("awaiting_human"), "awaiting_human")
        self.assertEqual(normalize_status("human-input"), "awaiting_human")
        self.assertEqual(normalize_status("idle"), "idle")
        self.assertEqual(normalize_status("unknown_xyz"), "idle")
        self.assertEqual(normalize_status(None), "idle")

    def test_merges_stored_agents_with_workstations(self) -> None:
        """Stored agents update the default workstations and preserve custom attributes."""
        self.storage.register_or_update_agent(
            agent_id="coder",
            profile_name="Senior Coder",
            role="Lead Coder",
            status="working",
            current_model="anthropic/claude-3-7-sonnet",
        )
        self.storage.register_or_update_agent(
            agent_id="custom_bot",
            profile_name="Custom Bot",
            role="Specialist",
            status="researching",
            current_model="openai/o3-mini",
        )

        state = get_office_state(self.storage)
        self.assertFalse(state["meta"]["is_fallback"])

        coder = next(a for a in state["agents"] if a["id"] == "coder")
        self.assertEqual(coder["profile_name"], "Senior Coder")
        self.assertEqual(coder["status"], "working")
        self.assertEqual(coder["current_model"], "anthropic/claude-3-7-sonnet")

        custom = next(a for a in state["agents"] if a["id"] == "custom_bot")
        self.assertEqual(custom["profile_name"], "Custom Bot")
        self.assertEqual(custom["status"], "researching")

    def test_attaches_active_tasks_and_activity_logs(self) -> None:
        """Tasks and activity events are mapped to respective agents."""
        # Upsert a task assigned to Artist
        self.storage.upsert_task_snapshot(
            kanban_task_id="TASK-101",
            title="Design isometric office props",
            assignee="artist",
            status="in_progress",
        )

        # Record activity event for Artist
        event = Event(
            event_type="after_tool_call",
            session_id="ses_art_1",
            data={
                "agent_id": "artist",
                "tool_name": "blender_render",
                "status": "success",
            },
        )
        self.storage.ingest_event(event)

        state = get_office_state(self.storage)
        artist = next(a for a in state["agents"] if a["id"].lower() == "artist")

        self.assertIsNotNone(artist.get("active_task"))
        self.assertEqual(artist["active_task"]["kanban_task_id"], "TASK-101")
        self.assertIsNotNone(artist.get("last_tool_call"))
        self.assertEqual(artist["last_tool_call"]["tool_name"], "blender_render")

    def test_fail_open_on_storage_error(self) -> None:
        """When storage fails or connection is closed, get_office_state still returns fallback roster."""
        self.storage.close()
        state = get_office_state(self.storage)
        self.assertEqual(state["status"], "ok")
        self.assertTrue(len(state["agents"]) >= 5)


class TestServerEndpoints(unittest.TestCase):
    """Test live HTTP server endpoints using Python urllib."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = Path(cls.temp_dir) / "server_test.sqlite3"
        cls.storage = OfficeStorage(db_path=cls.db_path)
        cls.session_store = SessionStore(Path(cls.temp_dir) / "sessions.sqlite3")
        cls.session = cls.session_store.create_session(user_id="md_test", role="managing_director", name="MD")

        # Create static test directory
        cls.static_dir = Path(cls.temp_dir) / "static"
        cls.static_dir.mkdir(parents=True, exist_ok=True)
        (cls.static_dir / "index.html").write_text("<!DOCTYPE html><html><body>Test SPA</body></html>")
        (cls.static_dir / "bundle.js").write_text("console.log('bundle');")

        # Create server with port 0 (dynamic port)
        cls.server = create_server(
            host="127.0.0.1",
            port=0,
            storage=cls.storage,
            session_store=cls.session_store,
            static_dir=cls.static_dir,
        )
        cls.port = cls.server.server_address[1]
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.05)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.storage.close()
        cls.session_store.close()
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def test_api_state_endpoint(self) -> None:
        """GET /api/state returns 200 and valid JSON with CORS headers."""
        url = f"http://127.0.0.1:{self.port}/api/state"
        req = urllib.request.Request(
            url,
            headers={"Cookie": f"session={self.session['token']}"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn("application/json", resp.headers.get("Content-Type", ""))
            self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["status"], "ok")
            self.assertIsInstance(data["agents"], list)
            self.assertTrue(len(data["agents"]) >= 5)

    def test_api_health_endpoint(self) -> None:
        """GET /api/health returns 200 and status ok."""
        url = f"http://127.0.0.1:{self.port}/api/health"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["status"], "ok")

    def test_options_preflight(self) -> None:
        """OPTIONS preflight returns 204 No Content with CORS headers."""
        url = f"http://127.0.0.1:{self.port}/api/state"
        req = urllib.request.Request(url, method="OPTIONS")
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 204)
            self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")
            self.assertIn("GET", resp.headers.get("Access-Control-Allow-Methods", ""))

    def test_serve_static_asset(self) -> None:
        """GET /bundle.js serves the actual static javascript asset."""
        url = f"http://127.0.0.1:{self.port}/bundle.js"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode("utf-8")
            self.assertEqual(content, "console.log('bundle');")

    def test_spa_fallback_to_index(self) -> None:
        """GET /roster or other non-file path falls back to index.html."""
        url = f"http://127.0.0.1:{self.port}/roster"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode("utf-8")
            self.assertIn("Test SPA", content)

    def test_path_traversal_prevention(self) -> None:
        """Paths attempting directory traversal are blocked."""
        url = f"http://127.0.0.1:{self.port}/../secret.txt"
        req = urllib.request.Request(url)
        # Python urllib or server either cleans path or returns 403/404
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                # If cleaned to index, it's safe
                self.assertIn(resp.status, (200, 403, 404))
        except urllib.error.HTTPError as err:
            self.assertIn(err.code, (403, 404))


class TestEmbeddedDashboardFallback(unittest.TestCase):
    """Test fallback when static directory has no index.html."""

    def test_embedded_dashboard_served(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            server = create_server(
                host="127.0.0.1",
                port=0,
                storage=OfficeStorage(":memory:"),
                static_dir=Path(temp_dir) / "nonexistent",
            )
            port = server.server_address[1]
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            time.sleep(0.05)

            url = f"http://127.0.0.1:{port}/"
            with urllib.request.urlopen(url, timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                body = resp.read().decode("utf-8")
                self.assertIn("Agent Office", body)
                self.assertIn("iso-office", body)

            server.shutdown()
            server.server_close()
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
