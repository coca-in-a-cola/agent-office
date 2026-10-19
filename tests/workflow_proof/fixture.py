"""Small compatibility fixture, NOT a deployed workflow runtime or executor."""

from __future__ import annotations

from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
import sqlite3
from typing import Iterator, NewType

from agent_office.storage import OfficeStorage

RunId = NewType("RunId", str)
AttemptId = NewType("AttemptId", str)
TaskId = NewType("TaskId", str)


@dataclass(frozen=True, slots=True)
class Node:
    name: str
    successor: str | None


@dataclass(frozen=True, slots=True)
class Completion:
    event_id: str
    attempt_id: AttemptId
    task_id: TaskId
    artifact: str


class CorrelationError(Exception):
    """Completion does not identify the persisted attempt/task pair."""


class FakeBridge:
    """Persistent fake transport; owns fake task identities, never executes jobs.

    UNIQUE key models Bridge's intended idempotency contract, not measured
    real-Bridge concurrent or remote-delivery behavior.
    """

    def __init__(self, connection: sqlite3.Connection) -> None:
        self.db = connection
        self.db.execute("CREATE TABLE IF NOT EXISTS tasks "
                        "(id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL)")

    def submit_task(self, idempotency_key: str) -> TaskId:
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO tasks(key) VALUES (?)",
                            (idempotency_key,))
            row = self.db.execute("SELECT id FROM tasks WHERE key=?",
                                  (idempotency_key,)).fetchone()
            assert row is not None
            return TaskId(f"bridge-{row[0]}")


class WorkflowFixture:
    """Mutates scratch workflow state through explicit fail-closed transactions.

    Only linear success edges are exercised. No workers, admission, clocks,
    approvals, publication, joins or retry scheduler live in this fixture.
    """

    def __init__(self, connection: sqlite3.Connection) -> None:
        self.db = connection
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS proof_versions (version INTEGER PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS proof_nodes (
                version INTEGER, name TEXT, successor TEXT,
                PRIMARY KEY(version, name));
            CREATE TRIGGER IF NOT EXISTS proof_immutable_update
                BEFORE UPDATE ON proof_nodes BEGIN
                SELECT RAISE(ABORT, 'immutable graph'); END;
            CREATE TRIGGER IF NOT EXISTS proof_immutable_insert
                BEFORE INSERT ON proof_nodes
                WHEN EXISTS(SELECT 1 FROM proof_versions WHERE version=NEW.version)
                BEGIN SELECT RAISE(ABORT, 'sealed graph'); END;
            CREATE TRIGGER IF NOT EXISTS proof_immutable_delete
                BEFORE DELETE ON proof_nodes BEGIN
                SELECT RAISE(ABORT, 'immutable graph'); END;
            CREATE TABLE IF NOT EXISTS proof_runs (
                id TEXT PRIMARY KEY,
                version INTEGER NOT NULL REFERENCES proof_versions(version));
            CREATE TABLE IF NOT EXISTS proof_attempts (
                id TEXT PRIMARY KEY, run_id TEXT REFERENCES proof_runs(id),
                node TEXT NOT NULL, task_id TEXT UNIQUE, artifact TEXT,
                completed INTEGER NOT NULL DEFAULT 0,
                UNIQUE(run_id, node));
            CREATE TABLE IF NOT EXISTS proof_receipts (
                event_id TEXT PRIMARY KEY,
                attempt_id TEXT UNIQUE REFERENCES proof_attempts(id));
        """)

    @contextmanager
    def transaction(self) -> Iterator[None]:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except (sqlite3.Error, CorrelationError):
            self.db.rollback()
            raise
        else:
            self.db.commit()

    def define(self, version: int, nodes: tuple[Node, ...]) -> None:
        with self.transaction():
            self.db.executemany("INSERT INTO proof_nodes VALUES (?, ?, ?)",
                                [(version, n.name, n.successor) for n in nodes])
            self.db.execute("INSERT INTO proof_versions VALUES (?)", (version,))

    def start(self, run_id: RunId, version: int) -> AttemptId:
        with self.transaction():
            self.db.execute("INSERT INTO proof_runs VALUES (?, ?)", (run_id, version))
            return self._attempt(run_id, "implementation")

    def _attempt(self, run_id: RunId, node: str) -> AttemptId:
        attempt = AttemptId(f"{run_id}/{node}/1")
        self.db.execute("INSERT INTO proof_attempts(id, run_id, node) VALUES (?, ?, ?)",
                        (attempt, run_id, node))
        return attempt

    def submit(self, attempt: AttemptId, bridge: FakeBridge) -> TaskId:
        row = self.db.execute("SELECT task_id FROM proof_attempts WHERE id=?",
                              (attempt,)).fetchone()
        assert row is not None
        if row[0] is not None:
            return TaskId(row[0])
        # External call cannot share this transaction. Lost acknowledgement is
        # reconciled by resubmitting the SAME persisted attempt identity.
        task_id = bridge.submit_task(str(attempt))
        with self.transaction():
            self.db.execute("UPDATE proof_attempts SET task_id=? WHERE id=?",
                            (task_id, attempt))
        return task_id

    def complete(self, event: Completion) -> AttemptId | None:
        with self.transaction():
            row = self.db.execute("""
                SELECT a.run_id, a.node, a.task_id, a.completed, r.version
                FROM proof_attempts a JOIN proof_runs r ON r.id=a.run_id
                WHERE a.id=?
            """, (event.attempt_id,)).fetchone()
            if row is None or row[2] != event.task_id:
                raise CorrelationError(event.attempt_id, event.task_id)
            if row[3]:
                return None
            self.db.execute("INSERT INTO proof_receipts VALUES (?, ?)",
                            (event.event_id, event.attempt_id))
            self.db.execute("""UPDATE proof_attempts SET completed=1, artifact=?
                               WHERE id=?""", (event.artifact, event.attempt_id))
            edge = self.db.execute("""SELECT successor FROM proof_nodes
                                      WHERE version=? AND name=?""",
                                   (row[4], row[1])).fetchone()
            assert edge is not None
            if edge[0] is None:
                return None
            return self._attempt(RunId(row[0]), edge[0])


@contextmanager
def sandbox(root: Path) -> Iterator[tuple[WorkflowFixture, FakeBridge]]:
    """Explicit temp paths only; do not resolve any production defaults."""
    with closing(OfficeStorage(db_path=root / "office.sqlite3")) as office:
        with closing(sqlite3.connect(root / "fake-bridge.sqlite3")) as bridge_db:
            yield WorkflowFixture(office.get_connection()), FakeBridge(bridge_db)
