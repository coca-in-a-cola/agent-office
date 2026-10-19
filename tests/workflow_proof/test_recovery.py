"""Run: python -m unittest discover -s tests/workflow_proof -t . -v."""

from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from .fixture import (
    Completion, CorrelationError, Node, RunId, TaskId, sandbox,
)


class RecoveryProof(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        with sandbox(self.root) as (core, bridge):
            core.define(1, (Node("implementation", "acceptance"),
                            Node("acceptance", None)))
            self.attempt = core.start(RunId("release-1"), 1)
            self.task = core.submit(self.attempt, bridge)
        self.event = Completion("event-1", self.attempt, self.task, "sha256:fixture")

    def test_version_pinning_when_new_graph_is_defined(self) -> None:
        # Given an existing v1 run and a different v2 release path.
        with sandbox(self.root) as (core, bridge):
            core.define(2, (Node("implementation", "different-check"),
                            Node("different-check", None)))
            # When the v1 task completes after the editor publishes v2.
            successor = core.complete(self.event)
            # Then its successor remains pinned to v1.
            self.assertEqual(successor, "release-1/acceptance/1")

    def test_version_redefinition_when_graph_exists(self) -> None:
        with sandbox(self.root) as (core, bridge):
            # Given v1, when its definition is replaced, then fail closed.
            with self.assertRaises(sqlite3.IntegrityError):
                core.define(1, (Node("implementation", "publish"),))

    def test_update_when_graph_exists_is_rejected(self) -> None:
        with sandbox(self.root) as (core, bridge):
            # Given v1, when mutated directly, then SQL enforces immutability.
            with self.assertRaises(sqlite3.IntegrityError):
                core.db.execute("UPDATE proof_nodes SET successor='publish'")

    def test_append_when_version_is_sealed_is_rejected(self) -> None:
        with sandbox(self.root) as (core, bridge):
            # Given a sealed graph, when a node is appended, then reject it.
            with self.assertRaises(sqlite3.IntegrityError):
                core.db.execute("INSERT INTO proof_nodes VALUES (1, 'publish', NULL)")

    def test_start_when_version_is_unknown_is_rejected(self) -> None:
        with sandbox(self.root) as (core, bridge):
            # Given no v99 graph, when a run pins v99, then reject it.
            with self.assertRaises(sqlite3.IntegrityError):
                core.start(RunId("unknown-version"), 99)

    def test_correlation_when_unrelated_task_completes(self) -> None:
        with sandbox(self.root) as (core, bridge):
            wrong = Completion("event-1", self.attempt, TaskId("other"), "bad")
            # When a foreign Bridge task claims this attempt, then reject it.
            with self.assertRaises(CorrelationError):
                core.complete(wrong)
            self.assertEqual(core.db.execute(
                "SELECT count(*) FROM proof_receipts").fetchone()[0], 0)

    def test_duplicate_when_event_reappears_after_reopen(self) -> None:
        with sandbox(self.root) as (core, bridge):
            successor = core.complete(self.event)
            assert successor is not None
            core.submit(successor, bridge)
        # When the same completion arrives after both connections reopen.
        with sandbox(self.root) as (core, bridge):
            self.assertIsNone(core.complete(self.event))
            # Then neither a second successor nor a second job exists.
            self.assertEqual(core.db.execute(
                "SELECT count(*) FROM proof_attempts").fetchone()[0], 2)
            self.assertEqual(bridge.db.execute(
                "SELECT count(*) FROM tasks").fetchone()[0], 2)

    def test_semantic_duplicate_when_delivery_id_changes(self) -> None:
        with sandbox(self.root) as (core, bridge):
            core.complete(self.event)
            redelivery = Completion("new-envelope", self.attempt, self.task, "same")
            # When a completed attempt receives a new envelope, then no transition.
            self.assertIsNone(core.complete(redelivery))
            self.assertEqual(core.db.execute(
                "SELECT count(*) FROM proof_receipts").fetchone()[0], 1)

    def test_atomicity_when_successor_creation_fails(self) -> None:
        with sandbox(self.root) as (core, bridge):
            core.db.executescript("""
                CREATE TRIGGER reject_successor BEFORE INSERT ON proof_attempts
                WHEN NEW.node='acceptance' BEGIN
                SELECT RAISE(ABORT, 'injected storage failure'); END;
            """)
            # When persistence fails mid-transition, then receipt and result roll back.
            with self.assertRaises(sqlite3.IntegrityError):
                core.complete(self.event)
            self.assertEqual(core.db.execute(
                "SELECT completed, artifact FROM proof_attempts").fetchone()[:], (0, None))
            self.assertEqual(core.db.execute(
                "SELECT count(*) FROM proof_receipts").fetchone()[0], 0)

    def test_reconcile_when_submit_acknowledgement_is_lost(self) -> None:
        with sandbox(self.root) as (core, bridge):
            successor = core.complete(self.event)
            assert successor is not None
            # Given fake Bridge accepted, but Core never recorded the response.
            accepted = bridge.submit_task(str(successor))
        with sandbox(self.root) as (core, bridge):
            # When Core retries the same attempt, then fake transport reconciles it.
            self.assertEqual(core.submit(successor, bridge), accepted)
            self.assertEqual(bridge.db.execute(
                "SELECT count(*) FROM tasks").fetchone()[0], 2)

    def test_persistence_when_distinct_python_processes_exit(self) -> None:
        # Given persisted correlation; each subprocess gets fresh Python memory.
        script = """
from pathlib import Path
import sys
sys.path.insert(0, str(Path.cwd() / 'tests'))
from workflow_proof.fixture import sandbox, Completion, AttemptId
with sandbox(Path(sys.argv[1])) as (core, bridge):
    task = core.submit(AttemptId('release-1/implementation/1'), bridge)
    nxt = core.complete(Completion('process-event', AttemptId('release-1/implementation/1'), task, 'sha256:child'))
    if nxt is not None:
        core.submit(nxt, bridge)
"""
        # When one process commits and exits, another redelivers the event.
        for _ in range(2):
            result = subprocess.run([sys.executable, "-c", script, str(self.root)],
                                    capture_output=True, text=True, timeout=15, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
        # Then artifact, correlation, receipt, and one successor survive both exits.
        with sandbox(self.root) as (core, bridge):
            row = core.db.execute("SELECT task_id, artifact FROM proof_attempts "
                                  "WHERE id=?", (self.attempt,)).fetchone()
            self.assertEqual(row[:], (self.task, "sha256:child"))
            self.assertEqual(core.db.execute(
                "SELECT count(*) FROM proof_receipts").fetchone()[0], 1)
            self.assertEqual(bridge.db.execute(
                "SELECT count(*) FROM tasks").fetchone()[0], 2)
