from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

# Ensure workspace and Hermes runtime are in sys.path
_workspace_root = Path(__file__).resolve().parent.parent
if str(_workspace_root) not in sys.path:
    sys.path.insert(0, str(_workspace_root))

_hermes_agent_root = Path("/opt/agents/tyler/hermes-agent")
if _hermes_agent_root.is_dir() and str(_hermes_agent_root) not in sys.path:
    sys.path.insert(0, str(_hermes_agent_root))

try:
    import hermes_bootstrap  # noqa: F401
    from hermes_cli.plugins import PluginManager
    _HERMES_AVAILABLE = True
except Exception:
    _HERMES_AVAILABLE = False

from agent_office.events import get_default_dispatcher, reset_default_dispatcher
from agent_office.hooks import get_default_hook_manager
from agent_office.server import create_server
from agent_office.storage import get_default_sink, reset_default_storage


class TestLiveDogfooding(unittest.TestCase):
    """End-to-end dogfooding smoke tests for Agent Office under Hermes runtime."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "office.sqlite3"
        os.environ["AGENT_OFFICE_DB_PATH"] = str(self.db_path)

        self.storage = reset_default_storage(db_path=self.db_path)
        self.dispatcher = reset_default_dispatcher()
        self.sink = get_default_sink()
        self.sink.storage = self.storage
        self.sink.dispatcher = self.dispatcher
        self.sink.attach()
        get_default_hook_manager()._dispatcher = self.dispatcher

    def tearDown(self) -> None:
        if self.sink.is_attached:
            self.sink.detach()
        get_default_hook_manager()._dispatcher = None
        self.storage.close()
        self.temp_dir.cleanup()
        os.environ.pop("AGENT_OFFICE_DB_PATH", None)

    def test_mounting_symlinks_exist_and_resolve(self) -> None:
        system_plugin = Path("/home/tyler/.hermes/plugins/agent-office")
        profile_plugin = Path("/home/tyler/.hermes/profiles/tyler/plugins/agent-office")

        self.assertTrue(system_plugin.is_symlink())
        self.assertEqual(system_plugin.resolve(), _workspace_root)

        self.assertTrue(profile_plugin.is_symlink())
        self.assertEqual(profile_plugin.resolve(), _workspace_root)

    @unittest.skipUnless(_HERMES_AVAILABLE, "Hermes runtime not available in test environment")
    def test_plugin_loads_under_hermes_loader(self) -> None:
        mgr = PluginManager()
        manifests = mgr._scan_directory(Path("/home/tyler/.hermes/plugins"), source="user")
        plugin_names = [m.name for m in manifests]
        self.assertIn("agent-office", plugin_names)

        ao_manifest = next(m for m in manifests if m.name == "agent-office")
        mgr._load_plugin(ao_manifest)

        loaded = mgr._plugins.get("agent-office")
        self.assertIsNotNone(loaded)
        self.assertTrue(loaded.enabled)
        self.assertIsNone(loaded.error)

        expected_canonical_hooks = [
            "on_session_start",
            "on_session_end",
            "pre_llm_call",
            "post_llm_call",
            "pre_tool_call",
            "post_tool_call",
        ]
        for hook_name in expected_canonical_hooks:
            self.assertIn(hook_name, mgr._hooks)

    @unittest.skipUnless(_HERMES_AVAILABLE, "Hermes runtime not available in test environment")
    def test_simulated_turn_triggers_hooks_and_stores_in_sqlite(self) -> None:
        mgr = PluginManager()
        manifests = mgr._scan_directory(Path("/home/tyler/.hermes/plugins"), source="user")
        ao_manifest = next(m for m in manifests if m.name == "agent-office")
        mgr._load_plugin(ao_manifest)

        session_id = "ses_dogfood_turn"
        turn_id = "turn_101"
        agent_id = "coder"

        mgr.invoke_hook(
            "on_session_start",
            session_id=session_id,
            agent_id=agent_id,
            model="claude-sonnet-4-6",
        )
        mgr.invoke_hook(
            "pre_llm_call",
            session_id=session_id,
            turn_id=turn_id,
            user_message="Please refactor auth middleware",
        )
        mgr.invoke_hook(
            "pre_tool_call",
            session_id=session_id,
            turn_id=turn_id,
            tool_name="terminal",
            tool_input={"command": "npm test"},
        )
        mgr.invoke_hook(
            "post_tool_call",
            session_id=session_id,
            turn_id=turn_id,
            tool_name="terminal",
            tool_output="All tests passing (12 tests)",
            duration_ms=45.5,
            status="success",
        )
        mgr.invoke_hook(
            "post_llm_call",
            session_id=session_id,
            turn_id=turn_id,
            assistant_message="Refactoring completed and verified.",
        )
        mgr.invoke_hook(
            "on_session_end",
            session_id=session_id,
            turn_id=turn_id,
            completed=True,
        )

        self.assertTrue(self.db_path.exists())
        events = self.storage.list_activity_events(session_id=session_id)
        self.assertEqual(len(events), 6)

        event_types = {e["event_type"] for e in events}
        self.assertIn("before_tool_call", event_types)
        self.assertIn("after_tool_call", event_types)

        tool_event = next(e for e in events if e["event_type"] == "after_tool_call")
        self.assertEqual(tool_event["tool_name"], "terminal")
        self.assertEqual(tool_event["status"], "success")

    @unittest.skipUnless(_HERMES_AVAILABLE, "Hermes runtime not available in test environment")
    def test_api_server_state_reflects_events_and_agent_status(self) -> None:
        mgr = PluginManager()
        manifests = mgr._scan_directory(Path("/home/tyler/.hermes/plugins"), source="user")
        ao_manifest = next(m for m in manifests if m.name == "agent-office")
        mgr._load_plugin(ao_manifest)

        session_id = "ses_api_verification"
        agent_id = "coder"

        mgr.invoke_hook(
            "on_session_start",
            session_id=session_id,
            agent_id=agent_id,
            model="claude-sonnet-4-6",
        )
        mgr.invoke_hook(
            "pre_tool_call",
            session_id=session_id,
            tool_name="git_status",
            tool_input={"flags": "-s"},
        )
        mgr.invoke_hook(
            "post_tool_call",
            session_id=session_id,
            tool_name="git_status",
            tool_output="Clean tree",
            duration_ms=12.0,
            status="success",
        )

        server = create_server(storage=self.storage, host="127.0.0.1", port=0)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        port = server.server_port

        try:
            url = f"http://127.0.0.1:{port}/api/state"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=5) as response:
                self.assertEqual(response.status, 200)
                body = response.read().decode("utf-8")
                data = json.loads(body)

                self.assertEqual(data.get("status"), "ok")
                self.assertIn("agents", data)
                self.assertIn("recent_activities", data)

                activities = data.get("recent_activities", [])
                self.assertGreaterEqual(len(activities), 3)

                coder_agent = next((a for a in data["agents"] if a["id"] == agent_id), None)
                self.assertIsNotNone(coder_agent)
                self.assertEqual(coder_agent.get("current_model"), "claude-sonnet-4-6")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
