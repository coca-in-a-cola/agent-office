"""Unit tests verifying Agent Office SQLite storage, migrations, state projections, and fail-open resilience."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

from agent_office.events import Event, EventDispatcher, EventType
from agent_office.storage import (
    DEFAULT_DB_REL_PATH,
    ENV_DB_PATH_VAR,
    EventSink,
    Migration,
    OfficeStorage,
    get_default_db_path,
    get_default_sink,
    get_default_storage,
    reset_default_storage,
)


class TestDatabasePathAndIsolation(unittest.TestCase):
    """Test database path resolution, isolation, and configuration overrides."""

    def test_default_path_resolution(self) -> None:
        expected = Path.home() / DEFAULT_DB_REL_PATH
        self.assertEqual(get_default_db_path(), expected)

    def test_env_path_override(self) -> None:
        custom_path = "/tmp/custom-agent-office/office.sqlite3"
        with patch.dict(os.environ, {ENV_DB_PATH_VAR: custom_path}):
            self.assertEqual(get_default_db_path(), Path(custom_path))

    def test_constructor_path_override_memory(self) -> None:
        storage = OfficeStorage(db_path=":memory:")
        self.assertTrue(storage.is_memory)
        self.assertEqual(str(storage.db_path), ":memory:")
        storage.close()

    def test_isolated_temp_file_database(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_file = Path(tmpdir) / "sub" / "isolated_office.sqlite3"
            storage = OfficeStorage(db_path=db_file)
            self.assertTrue(db_file.exists())
            self.assertFalse(storage.is_memory)

            # Ensure internal Hermes database files are never touched
            self.assertFalse((Path(tmpdir) / "sessions.db").exists())
            self.assertFalse((Path(tmpdir) / "kanban.db").exists())
            self.assertFalse((Path(tmpdir) / "memory.db").exists())
            storage.close()


class TestMigrationsEngine(unittest.TestCase):
    """Test schema initialization and migration version tracking."""

    def setUp(self) -> None:
        self.storage = OfficeStorage(db_path=":memory:")

    def tearDown(self) -> None:
        self.storage.close()

    def test_initial_schema_applied(self) -> None:
        applied = self.storage.get_applied_migrations()
        self.assertEqual(len(applied), 1)
        self.assertEqual(applied[0]["version"], 1)
        self.assertIn("Initial schema", applied[0]["description"])

        conn = self.storage.get_connection()
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC;"
        )
        tables = [row["name"] for row in cur.fetchall()]
        self.assertIn("agents", tables)
        self.assertIn("activity_events", tables)
        self.assertIn("task_snapshots", tables)
        self.assertIn("schema_migrations", tables)

    def test_migrate_is_idempotent(self) -> None:
        # Calling migrate again should not fail or re-apply
        res = self.storage.migrate()
        self.assertTrue(res)
        applied = self.storage.get_applied_migrations()
        self.assertEqual(len(applied), 1)

    def test_incremental_migration(self) -> None:
        # Register a fake migration 2 and migrate
        from agent_office.storage import MIGRATIONS

        test_migration = Migration(
            version=2,
            description="Add test column",
            up_sql="ALTER TABLE agents ADD COLUMN test_flag INTEGER DEFAULT 0;",
        )
        MIGRATIONS.append(test_migration)
        try:
            self.storage.migrate()
            applied = self.storage.get_applied_migrations()
            self.assertEqual(len(applied), 2)
            self.assertEqual(applied[1]["version"], 2)

            # Verify column exists
            conn = self.storage.get_connection()
            cur = conn.execute("PRAGMA table_info(agents);")
            col_names = [row["name"] for row in cur.fetchall()]
            self.assertIn("test_flag", col_names)
        finally:
            MIGRATIONS.remove(test_migration)


class TestAgentStateUpdater(unittest.TestCase):
    """Test agent registration, updates, status changes, and queries."""

    def setUp(self) -> None:
        self.storage = OfficeStorage(db_path=":memory:")

    def tearDown(self) -> None:
        self.storage.close()

    def test_register_and_get_agent(self) -> None:
        agent = self.storage.register_or_update_agent(
            agent_id="agent_hermes_01",
            profile_name="Hermes Lead",
            role="lead",
            status="busy",
            current_model="claude-sonnet-4-6",
            capabilities=["tools", "coding", "web"],
            metadata={"department": "engineering", "level": 3},
        )
        self.assertIsNotNone(agent)
        self.assertEqual(agent["id"], "agent_hermes_01")
        self.assertEqual(agent["profile_name"], "Hermes Lead")
        self.assertEqual(agent["role"], "lead")
        self.assertEqual(agent["status"], "busy")
        self.assertEqual(agent["current_model"], "claude-sonnet-4-6")
        self.assertEqual(agent["capabilities"], ["tools", "coding", "web"])
        self.assertEqual(agent["metadata"]["department"], "engineering")

        fetched = self.storage.get_agent("agent_hermes_01")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["id"], "agent_hermes_01")

    def test_update_existing_agent_partial(self) -> None:
        self.storage.register_or_update_agent(
            agent_id="agent_02",
            profile_name="Junior Dev",
            role="coder",
            status="idle",
            current_model="gpt-4o",
        )

        # Update status and model only
        updated = self.storage.register_or_update_agent(
            agent_id="agent_02",
            status="active",
            current_model="gpt-5",
        )
        self.assertEqual(updated["profile_name"], "Junior Dev")  # Preserved
        self.assertEqual(updated["role"], "coder")  # Preserved
        self.assertEqual(updated["status"], "active")
        self.assertEqual(updated["current_model"], "gpt-5")

    def test_update_status(self) -> None:
        self.storage.register_or_update_agent(
            agent_id="agent_03",
            profile_name="Tester",
            status="idle",
        )
        success = self.storage.update_status(
            agent_id="agent_03",
            status="executing_tool",
            current_model="claude-haiku-3-5",
        )
        self.assertTrue(success)

        agent = self.storage.get_agent("agent_03")
        self.assertEqual(agent["status"], "executing_tool")
        self.assertEqual(agent["current_model"], "claude-haiku-3-5")

    def test_list_agents_filtering(self) -> None:
        self.storage.register_or_update_agent("a1", role="dev", status="busy")
        self.storage.register_or_update_agent("a2", role="dev", status="idle")
        self.storage.register_or_update_agent("a3", role="qa", status="idle")

        devs = self.storage.list_agents(role="dev")
        self.assertEqual(len(devs), 2)

        idle_agents = self.storage.list_agents(status="idle")
        self.assertEqual(len(idle_agents), 2)

        idle_devs = self.storage.list_agents(role="dev", status="idle")
        self.assertEqual(len(idle_devs), 1)
        self.assertEqual(idle_devs[0]["id"], "a2")


class TestTaskSnapshotProjection(unittest.TestCase):
    """Test task snapshot upserts, queries for active tasks, and recent task projections."""

    def setUp(self) -> None:
        self.storage = OfficeStorage(db_path=":memory:")

    def tearDown(self) -> None:
        self.storage.close()

    def test_upsert_and_get_task_snapshot(self) -> None:
        task = self.storage.upsert_task_snapshot(
            kanban_task_id="task_4d663b54",
            board_slug="office_board",
            title="Implement SQLite Storage",
            status="in_progress",
            assignee="Tyler",
            priority="high",
            raw_snapshot={"columns": ["todo", "in_progress", "done"], "tags": ["sqlite", "ao-02"]},
        )
        self.assertIsNotNone(task)
        self.assertEqual(task["kanban_task_id"], "task_4d663b54")
        self.assertEqual(task["title"], "Implement SQLite Storage")
        self.assertEqual(task["status"], "in_progress")
        self.assertEqual(task["assignee"], "Tyler")
        self.assertEqual(task["priority"], "high")
        self.assertEqual(task["raw_snapshot"]["tags"], ["sqlite", "ao-02"])

        # Fetch by id or kanban_task_id
        fetched = self.storage.get_task_snapshot("task_4d663b54")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["title"], "Implement SQLite Storage")

    def test_upsert_updates_existing_task(self) -> None:
        self.storage.upsert_task_snapshot(
            kanban_task_id="t_1",
            board_slug="board_a",
            title="Initial Title",
            status="todo",
            assignee="Alice",
        )
        # Update status and title
        updated = self.storage.upsert_task_snapshot(
            kanban_task_id="t_1",
            title="Updated Title",
            status="completed",
        )
        self.assertEqual(updated["title"], "Updated Title")
        self.assertEqual(updated["status"], "completed")
        self.assertEqual(updated["assignee"], "Alice")  # Retained
        self.assertEqual(updated["board_slug"], "board_a")  # Retained

    def test_query_active_tasks(self) -> None:
        self.storage.upsert_task_snapshot("t_todo", title="T1", status="todo", board_slug="b1")
        self.storage.upsert_task_snapshot("t_prog", title="T2", status="in_progress", board_slug="b1")
        self.storage.upsert_task_snapshot("t_done", title="T3", status="done", board_slug="b1")
        self.storage.upsert_task_snapshot("t_arch", title="T4", status="archived", board_slug="b1")
        self.storage.upsert_task_snapshot("t_other", title="T5", status="in_progress", board_slug="b2")

        active_b1 = self.storage.query_active_tasks(board_slug="b1")
        self.assertEqual(len(active_b1), 2)
        active_statuses = {t["status"] for t in active_b1}
        self.assertEqual(active_statuses, {"todo", "in_progress"})

    def test_list_recent_tasks(self) -> None:
        t0 = time.time()
        self.storage.upsert_task_snapshot("t1", title="First", updated_at=t0)
        self.storage.upsert_task_snapshot("t2", title="Second", updated_at=t0 + 10)
        self.storage.upsert_task_snapshot("t3", title="Third", updated_at=t0 + 20)

        recent = self.storage.list_recent_tasks(limit=2)
        self.assertEqual(len(recent), 2)
        self.assertEqual(recent[0]["kanban_task_id"], "t3")
        self.assertEqual(recent[1]["kanban_task_id"], "t2")


class TestEventPersistenceAndEventSink(unittest.TestCase):
    """Test Event persistence and automated ingestion via EventSink connected to EventDispatcher."""

    def setUp(self) -> None:
        self.storage = OfficeStorage(db_path=":memory:")
        self.dispatcher = EventDispatcher()
        self.sink = EventSink(storage=self.storage, dispatcher=self.dispatcher, auto_attach=True)

    def tearDown(self) -> None:
        self.sink.detach()
        self.storage.close()

    def test_event_ingest_from_event_model(self) -> None:
        event = Event(
            event_type=EventType.AFTER_TOOL_CALL.value,
            session_id="ses_abc",
            data={
                "agent_id": "hermes_01",
                "tool_name": "bash",
                "args": {"command": "git status"},
                "result": "On branch develop\nnothing to commit",
                "duration_ms": 35.5,
                "status": "success",
            },
        )
        success = self.storage.ingest_event(event)
        self.assertTrue(success)

        row = self.storage.get_activity_event(event.event_id)
        self.assertIsNotNone(row)
        self.assertEqual(row["session_id"], "ses_abc")
        self.assertEqual(row["event_type"], "after_tool_call")
        self.assertEqual(row["agent_id"], "hermes_01")
        self.assertEqual(row["tool_name"], "bash")
        self.assertIn("git status", row["tool_input_preview"])
        self.assertIn("On branch develop", row["tool_output_preview"])
        self.assertEqual(row["latency_ms"], 35.5)
        self.assertEqual(row["status"], "success")

    def test_tool_preview_truncation(self) -> None:
        huge_payload = "X" * 1200
        event = Event(
            event_type="before_tool_call",
            data={"tool_name": "write_file", "input": huge_payload},
        )
        self.storage.ingest_event(event)

        row = self.storage.get_activity_event(event.event_id)
        self.assertIsNotNone(row)
        self.assertLessEqual(len(row["tool_input_preview"]), 500)
        self.assertTrue(row["tool_input_preview"].endswith("..."))

    def test_automatic_persistence_via_event_dispatcher(self) -> None:
        # Dispatch event through EventDispatcher; EventSink should ingest automatically
        event1 = Event(
            event_type="session_start",
            session_id="ses_live_1",
            data={"agent_id": "agent_alpha", "model": "sonnet"},
        )
        event2 = Event(
            event_type="before_tool_call",
            session_id="ses_live_1",
            data={"agent_id": "agent_alpha", "tool_name": "calculator", "args": {"expr": "2+2"}},
        )

        self.dispatcher.dispatch(event1)
        self.dispatcher.dispatch(event2)

        events = self.storage.list_activity_events(session_id="ses_live_1")
        self.assertEqual(len(events), 2)
        event_types = {e["event_type"] for e in events}
        self.assertEqual(event_types, {"session_start", "before_tool_call"})

    def test_event_sink_detach(self) -> None:
        self.sink.detach()
        self.assertFalse(self.sink.is_attached)

        self.dispatcher.dispatch(Event(event_type="test_after_detach"))
        events = self.storage.list_activity_events()
        self.assertEqual(len(events), 0)

        # Re-attach
        self.sink.attach()
        self.assertTrue(self.sink.is_attached)
        self.dispatcher.dispatch(Event(event_type="test_after_reattach"))
        events = self.storage.list_activity_events()
        self.assertEqual(len(events), 1)


class TestFailOpenAndConcurrency(unittest.TestCase):
    """Test Fail-Open resilience under error conditions and concurrent thread execution."""

    def test_fail_open_on_closed_connection(self) -> None:
        storage = OfficeStorage(db_path=":memory:")
        storage.close()

        # Database is closed; all operations MUST NOT raise exceptions
        agent_res = storage.register_or_update_agent("agent_fail")
        self.assertIsNone(agent_res)

        status_res = storage.update_status("agent_fail", "active")
        self.assertFalse(status_res)

        task_res = storage.upsert_task_snapshot("t_fail")
        self.assertIsNone(task_res)

        event_res = storage.record_activity_event("ev_fail")
        self.assertFalse(event_res)

        query_res = storage.list_agents()
        self.assertEqual(query_res, [])

        active_tasks = storage.query_active_tasks()
        self.assertEqual(active_tasks, [])

    def test_fail_open_on_sqlite_error_simulation(self) -> None:
        storage = OfficeStorage(db_path=":memory:")
        # Mock connection execute to raise OperationalError
        mock_conn = MagicMock()
        mock_conn.execute.side_effect = Exception("Disk I/O error or lock timeout")
        storage._conn = mock_conn

        # All operations must return fallback without raising
        self.assertFalse(storage.record_activity_event("ev_err"))
        self.assertIsNone(storage.register_or_update_agent("agent_err"))
        self.assertIsNone(storage.upsert_task_snapshot("task_err"))
        self.assertEqual(storage.query_active_tasks(), [])

    def test_concurrent_multithreaded_writes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "concurrent.sqlite3"
            storage = OfficeStorage(db_path=db_path)
            dispatcher = EventDispatcher()
            sink = EventSink(storage=storage, dispatcher=dispatcher)

            errors: list[Exception] = []
            num_threads = 10
            ops_per_thread = 20

            def worker(thread_idx: int) -> None:
                try:
                    for i in range(ops_per_thread):
                        # 1. Update agent
                        storage.register_or_update_agent(
                            agent_id=f"agent_t{thread_idx}",
                            profile_name=f"Worker {thread_idx}",
                            status="working",
                        )
                        # 2. Upsert task
                        storage.upsert_task_snapshot(
                            kanban_task_id=f"task_t{thread_idx}_{i}",
                            title=f"Task {thread_idx}-{i}",
                            status="in_progress",
                        )
                        # 3. Dispatch event via sink
                        dispatcher.dispatch(
                            Event(
                                event_type="after_tool_call",
                                session_id=f"ses_t{thread_idx}",
                                data={
                                    "agent_id": f"agent_t{thread_idx}",
                                    "tool_name": "worker_tool",
                                    "duration_ms": 10.0,
                                },
                            )
                        )
                except Exception as exc:
                    errors.append(exc)

            threads = [threading.Thread(target=worker, args=(i,)) for i in range(num_threads)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            sink.detach()
            storage.close()

            # Ensure zero crashes / unhandled exceptions across all threads
            self.assertEqual(len(errors), 0)


if __name__ == "__main__":
    unittest.main()
