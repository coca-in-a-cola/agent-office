"""Tests for the WebDev workstation, Task Bridge ingestion and the Workstation Monitor API."""

from __future__ import annotations

from contextlib import closing
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from agent_office.server import (
    DEFAULT_WORKSTATIONS,
    create_server,
    get_agent_monitor,
    get_office_state,
)
from agent_office.storage import (
    OfficeStorage,
    TaskBridgeReader,
    apply_bridge_projection,
    resolve_bridge_workstation,
)

# Column layout of task_bridge.storage `tasks` (read-only consumer contract).
BRIDGE_SCHEMA = """
CREATE TABLE tasks (
    id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    goal TEXT NOT NULL, repo TEXT NOT NULL, working_dir TEXT NOT NULL,
    complexity TEXT NOT NULL, acceptance_criteria TEXT NOT NULL, constraints TEXT NOT NULL,
    permissions TEXT NOT NULL, budget TEXT NOT NULL, callback TEXT, state TEXT NOT NULL,
    progress_summary TEXT DEFAULT '', run_ids TEXT DEFAULT '[]', artifacts TEXT DEFAULT '[]',
    git_sha TEXT, model_used TEXT, complexity_tier TEXT, tests_passed INTEGER,
    tests_failed INTEGER, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    started_at TEXT, completed_at TEXT, timeout_seconds INTEGER DEFAULT 3600,
    max_subagents INTEGER DEFAULT 2, heavy_task INTEGER DEFAULT 0, pid INTEGER, pgid INTEGER,
    exit_code INTEGER, requested_model TEXT, actual_model TEXT,
    degraded INTEGER NOT NULL DEFAULT 0, degraded_reason TEXT,
    "commit" INTEGER NOT NULL DEFAULT 0, test_cmd TEXT, allowed_dirty TEXT DEFAULT '[]',
    initial_git_sha TEXT, executor TEXT DEFAULT 'omo', project_id TEXT, accepted_at TEXT,
    delivered_at TEXT
);
"""


def _dead_pid() -> int:
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    return proc.pid


class BridgeFixture:
    """Fake Task Bridge home: tasks.db plus per-task artifact directories."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.db_path = root / "tasks.db"
        self.artifacts_dir = root / "artifacts"
        self.artifacts_dir.mkdir(parents=True)
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.executescript(BRIDGE_SCHEMA)
        self.reader = TaskBridgeReader(self.db_path, self.artifacts_dir)

    def add(self, task_id: str, title: str, state: str, *, goal: str = "",
            minutes_ago: int = 1, pid: int | None = None, model: str = "claude-opus-5-5",
            executor: str = "claude", stdout: str | None = None, stderr: str | None = None,
            completed: bool = False, project_id: str | None = None) -> Path:
        task_dir = self.artifacts_dir / task_id
        task_dir.mkdir()
        artifacts = []
        for name, text in (("stdout.log", stdout), ("stderr.log", stderr)):
            if text is not None:
                (task_dir / name).write_text(text, encoding="utf-8")
                artifacts.append(str(task_dir / name))
        started = datetime.utcnow() - timedelta(minutes=minutes_ago)
        done = started + timedelta(seconds=90) if completed else None
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.execute(
                "INSERT INTO tasks (id, idempotency_key, title, goal, repo, working_dir,"
                " complexity, acceptance_criteria, constraints, permissions, budget, state,"
                " artifacts, created_at, updated_at, started_at, completed_at, pid,"
                " actual_model, executor, project_id, exit_code)"
                " VALUES (?, ?, ?, ?, '', ?, 'medium', '[]', '[]', '[]', '{}', ?, ?, ?, ?, ?,"
                " ?, ?, ?, ?, ?, ?)",
                (task_id, f"key-{task_id}", title, goal, str(self.root / "nowhere"), state,
                 json.dumps(artifacts), started.isoformat(), (done or started).isoformat(),
                 started.isoformat(), done.isoformat() if done else None, pid, model,
                 executor, project_id, 0 if completed else None))
        return task_dir


def _workstation(agent_id: str) -> dict:
    return next(ws for ws in DEFAULT_WORKSTATIONS if ws["id"] == agent_id)


class TestWorkstationRoster(unittest.TestCase):
    """WebDev joins the office and Coder specialises in Godot."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.mkdtemp()
        self.storage = OfficeStorage(db_path=Path(self.temp_dir) / "office.sqlite3")

    def tearDown(self) -> None:
        self.storage.close()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_webdev_workstation_properties(self) -> None:
        ws = _workstation("webdev")
        self.assertEqual(ws["profile_name"], "WebDev")
        self.assertEqual(ws["role"], "Web Engineer")
        self.assertEqual(ws["status"], "idle")
        self.assertEqual(ws["current_model"], "anthropic/claude-3-5-sonnet")
        self.assertEqual(ws["capabilities"], ["react", "typescript", "tailwind", "vite",
                                              "web_apis", "browser_testing", "performance"])
        self.assertEqual(ws["metadata"], {"desk": "frontend", "position": [2, 0],
                                          "avatar": "webdev"})

    def test_coder_specialises_in_godot(self) -> None:
        ws = _workstation("coder")
        self.assertEqual(ws["role"], "Game Developer (Godot)")
        self.assertEqual(ws["capabilities"], ["godot4", "gdscript", "c_sharp", "shaders",
                                              "physics", "rendering"])

    def test_webdev_listed_in_office_state(self) -> None:
        state = get_office_state(self.storage)
        agent_ids = [a["id"] for a in state["agents"]]
        self.assertIn("webdev", agent_ids)
        self.assertEqual(len(set(agent_ids)), len(agent_ids))
        positions = [tuple(ws["metadata"]["position"]) for ws in DEFAULT_WORKSTATIONS]
        self.assertEqual(len(set(positions)), len(positions), "desks must not overlap")


class TestBridgeWorkstationResolution(unittest.TestCase):
    """Bridge tasks are routed to desks by tag, execution model, then keywords."""

    def test_explicit_tags_win(self) -> None:
        self.assertEqual(resolve_bridge_workstation({"title": "[webdev] polish tests"}), "webdev")
        self.assertEqual(resolve_bridge_workstation(
            {"title": "Fix things", "goal": "workstation: devops\nTouch the React app"}), "devops")
        self.assertEqual(resolve_bridge_workstation({"title": "x", "project_id": "qa"}), "qa")
        self.assertEqual(resolve_bridge_workstation({"title": "[godot] fix jump"}), "coder")

    def test_execution_model_routes_generators_to_artist(self) -> None:
        self.assertEqual(resolve_bridge_workstation(
            {"title": "Office chair", "model": "tripo/hunyuan3d-2.0"}), "artist")

    def test_keywords_split_godot_and_web(self) -> None:
        self.assertEqual(resolve_bridge_workstation(
            {"title": "Player jump physics in GDScript"}), "coder")
        self.assertEqual(resolve_bridge_workstation(
            {"title": "React roster drawer with Tailwind"}), "webdev")

    def test_unclassified_tasks_go_to_director(self) -> None:
        self.assertEqual(resolve_bridge_workstation({"title": "Misc chores"}), "tyler")


class TestBridgeIngestion(unittest.TestCase):
    """Running Task Bridge tasks light up their workstation in /api/state."""

    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())
        self.storage = OfficeStorage(db_path=self.temp_dir / "office.sqlite3")
        self.bridge = BridgeFixture(self.temp_dir / "bridge")

    def tearDown(self) -> None:
        self.storage.close()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _agent(self, state: dict, agent_id: str) -> dict:
        return next(a for a in state["agents"] if a["id"] == agent_id)

    def test_running_task_marks_workstation_working(self) -> None:
        self.bridge.add("tb-web-1", "[webdev] Workstation Monitor UI", "running",
                        pid=os.getpid())
        self.bridge.add("tb-godot-1", "Godot shader pass", "succeeded", completed=True,
                        minutes_ago=30)
        state = get_office_state(self.storage, bridge=self.bridge.reader)

        webdev = self._agent(state, "webdev")
        self.assertEqual(webdev["status"], "working")
        self.assertEqual(webdev["active_task_id"], "tb-web-1")
        self.assertEqual(webdev["current_task"], "[webdev] Workstation Monitor UI")
        self.assertEqual(webdev["bridge_task"]["executor"], "claude")
        self.assertTrue(webdev["bridge_task"]["is_live"])

        coder = self._agent(state, "coder")
        self.assertEqual(coder["status"], "idle")
        self.assertIsNone(coder["active_task_id"])
        self.assertEqual([t["task_id"] for t in coder["bridge_tasks"]], ["tb-godot-1"])
        self.assertAlmostEqual(coder["bridge_tasks"][0]["duration_seconds"], 90.0, places=3)

        self.assertEqual(state["meta"]["bridge_ingestion"], "ok")
        self.assertEqual(state["meta"]["bridge_tasks"], 2)
        self.assertEqual(state["meta"]["bridge_active_tasks"], 1)

    def test_dead_worker_is_not_live(self) -> None:
        self.bridge.add("tb-web-2", "[webdev] stale", "running", pid=_dead_pid())
        task = self.bridge.reader.get_task("tb-web-2")
        self.assertFalse(task["is_live"])

    def test_missing_bridge_db_fails_open(self) -> None:
        reader = TaskBridgeReader(self.temp_dir / "missing.db", self.temp_dir)
        state = get_office_state(self.storage, bridge=reader)
        self.assertEqual(state["meta"]["bridge_ingestion"], "error")
        self.assertEqual(self._agent(state, "webdev")["status"], "idle")

    def test_workflow_assignment_keeps_precedence(self) -> None:
        agent_map = {
            "webdev": {"id": "webdev", "status": "review", "active_task_id": "wf-task",
                       "workflow_assignment": {"task_id": "wf-task"},
                       "workflow_assignments": [{"task_id": "wf-task"}]},
            "qa": {"id": "qa", "status": "idle"},
        }
        tasks = [
            {"task_id": "wf-task", "title": "node attempt", "state": "running",
             "workstation": "qa"},
            {"task_id": "tb-x", "title": "direct", "state": "running", "workstation": "webdev"},
        ]
        active = apply_bridge_projection(agent_map, tasks)
        self.assertEqual(active, 0)
        self.assertEqual(agent_map["webdev"]["status"], "review")
        self.assertEqual(agent_map["webdev"]["active_task_id"], "wf-task")
        self.assertEqual(agent_map["qa"]["status"], "idle")
        self.assertIsNone(agent_map["qa"]["bridge_task"])


class TestWorkstationMonitorApi(unittest.TestCase):
    """GET /api/agents/{id}/monitor and GET /api/tasks/{id}/log over HTTP."""

    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())
        self.storage = OfficeStorage(db_path=self.temp_dir / "office.sqlite3")
        self.bridge = BridgeFixture(self.temp_dir / "bridge")
        self.stdout = "".join(f"line {i}\n" for i in range(150))
        self.bridge.add("tb-live", "[webdev] Monitor", "running", pid=os.getpid(),
                        stdout=self.stdout, stderr="warn: slow build\n")
        self.bridge.add("tb-done", "Godot export", "failed", completed=True, minutes_ago=20,
                        stdout="done\n", stderr="")
        self.server = create_server(port=0, storage=self.storage,
                                    static_dir=self.temp_dir / "static",
                                    bridge=self.bridge.reader)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.storage.close()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def get(self, path: str) -> tuple[int, dict]:
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as res:
                return res.status, json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read().decode("utf-8"))

    def test_monitor_streams_active_bridge_task(self) -> None:
        status, data = self.get("/api/agents/webdev/monitor")
        self.assertEqual(status, 200)
        self.assertEqual(data["agent"]["id"], "webdev")
        self.assertEqual(data["agent"]["status"], "working")
        self.assertEqual(data["agent"]["current_model"], "anthropic/claude-3-5-sonnet")
        self.assertEqual(data["source"], "task_bridge")
        self.assertTrue(data["is_active"])
        self.assertTrue(data["is_live"])
        self.assertEqual(data["task"]["task_id"], "tb-live")
        self.assertEqual(len(data["stdout_tail"]), 100)
        self.assertEqual(data["stdout_tail"][0], "line 50")
        self.assertEqual(data["stdout_tail"][-1], "line 149")
        self.assertEqual(data["stderr_tail"], ["warn: slow build"])

    def test_monitor_tail_parameter(self) -> None:
        status, data = self.get("/api/agents/webdev/monitor?tail=5")
        self.assertEqual(status, 200)
        self.assertEqual(data["stdout_tail"], [f"line {i}" for i in range(145, 150)])
        status, _ = self.get("/api/agents/webdev/monitor?tail=abc")
        self.assertEqual(status, 400)

    def test_monitor_falls_back_to_recent_task(self) -> None:
        status, data = self.get("/api/agents/coder/monitor")
        self.assertEqual(status, 200)
        self.assertEqual(data["agent"]["status"], "idle")
        self.assertEqual(data["source"], "task_bridge")
        self.assertFalse(data["is_active"])
        self.assertFalse(data["is_live"])
        self.assertEqual(data["task"]["task_id"], "tb-done")
        self.assertEqual(data["stdout_tail"], ["done"])

    def test_monitor_idle_and_activity_sources(self) -> None:
        status, data = self.get("/api/agents/devops/monitor")
        self.assertEqual(status, 200)
        self.assertEqual(data["source"], "idle")
        self.assertIsNone(data["task"])
        self.assertFalse(data["is_live"])

        self.storage.record_activity_event(event_id="ev1", agent_id="devops",
                                           event_type="tool_call", tool_name="bash",
                                           tool_input_preview="docker compose up",
                                           status="success", timestamp=1_700_000_000.0)
        data = get_agent_monitor("devops", self.storage)
        self.assertEqual(data["source"], "activity")
        self.assertEqual(len(data["activity"]), 1)
        self.assertIn("tool_call bash [success] docker compose up", data["activity"][0])

    def test_monitor_unknown_agent(self) -> None:
        status, data = self.get("/api/agents/nobody/monitor")
        self.assertEqual(status, 404)
        self.assertEqual(data["status"], "error")

    def test_task_log_drilldown(self) -> None:
        status, data = self.get("/api/tasks/tb-live/log")
        self.assertEqual(status, 200)
        self.assertEqual(data["task"]["title"], "[webdev] Monitor")
        self.assertEqual(data["task"]["state"], "running")
        self.assertEqual(data["task"]["executor"], "claude")
        self.assertEqual(data["task"]["model"], "claude-opus-5-5")
        self.assertGreater(data["task"]["duration_seconds"], 0)
        self.assertTrue(data["is_live"])
        self.assertEqual(data["stdout"]["text"], self.stdout)
        self.assertFalse(data["stdout"]["truncated"])
        self.assertEqual(data["stderr"]["text"], "warn: slow build\n")
        names = sorted(a["name"] for a in data["artifacts"])
        self.assertEqual(names, ["stderr.log", "stdout.log"])
        self.assertTrue(all(a["exists"] for a in data["artifacts"]))

    def test_task_log_unknown_task(self) -> None:
        status, data = self.get("/api/tasks/missing/log")
        self.assertEqual(status, 404)
        self.assertEqual(data["status"], "error")

    def test_task_log_without_bridge(self) -> None:
        server = create_server(port=0, storage=self.storage, static_dir=self.temp_dir / "s2")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_address[1]}/api/tasks/tb-live/log"
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(url, timeout=5)
            self.assertEqual(ctx.exception.code, 503)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
