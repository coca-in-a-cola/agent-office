"""Fail-closed SQLite repository for Workflow Core state.

Unlike agent_office.storage.OfficeStorage, nothing here swallows errors or
returns fallbacks: every mutation runs inside an explicit BEGIN IMMEDIATE
transaction that either commits completely or raises. SQL constraints and
triggers back up the engine's invariants (pinned versions, single active
attempt per run, immutable task correlation, append-only journal).
"""

from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterator, Mapping

from .definitions import WorkflowDefinition

RUN_STATUSES = ("running", "waiting_approval", "quota_wait", "inspecting",
                "cancelling", "blocked", "cancelled", "completed")
ATTEMPT_STATUSES = ("pending", "submitted", "succeeded", "defect", "timed_out",
                    "failed", "cancelled", "quota", "awaiting_approval")
ACTIVE_ATTEMPT_STATUSES = ("pending", "submitted")
INTENT_KINDS = ("submit", "cancel", "inspect")
INTENT_STATUSES = ("pending", "done", "void")
GATE_STATUSES = ("pending", "approved", "rejected", "revoked")


def _check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"CHECK ({column} IN ({quoted}))"


SCHEMA = f"""
CREATE TABLE IF NOT EXISTS workflow_definitions (
    definition_hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    canonical_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    UNIQUE (name, version)
);
CREATE TRIGGER IF NOT EXISTS workflow_definitions_no_update
    BEFORE UPDATE ON workflow_definitions
    BEGIN SELECT RAISE(ABORT, 'workflow definitions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_definitions_no_delete
    BEFORE DELETE ON workflow_definitions
    BEGIN SELECT RAISE(ABORT, 'workflow definitions are immutable'); END;

CREATE TABLE IF NOT EXISTS workflow_runs (
    run_id TEXT PRIMARY KEY,
    definition_hash TEXT NOT NULL REFERENCES workflow_definitions(definition_hash),
    status TEXT NOT NULL {_check("status", RUN_STATUSES)},
    current_node TEXT,
    source_sha TEXT,
    inputs_json TEXT NOT NULL,
    status_reason TEXT NOT NULL DEFAULT '',
    due_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TRIGGER IF NOT EXISTS workflow_runs_pinned
    BEFORE UPDATE OF definition_hash ON workflow_runs
    WHEN NEW.definition_hash IS NOT OLD.definition_hash
    BEGIN SELECT RAISE(ABORT, 'run is pinned to its definition version'); END;

CREATE TABLE IF NOT EXISTS node_attempts (
    attempt_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    node TEXT NOT NULL,
    iteration INTEGER NOT NULL CHECK (iteration >= 1),
    attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
    status TEXT NOT NULL {_check("status", ATTEMPT_STATUSES)},
    idempotency_key TEXT NOT NULL UNIQUE,
    task_id TEXT UNIQUE,
    stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
    evidence_json TEXT,
    producer TEXT,
    reason TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    submitted_at REAL,
    deadline_at REAL,
    finished_at REAL,
    UNIQUE (run_id, node, iteration, attempt_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS node_attempts_one_active
    ON node_attempts(run_id) WHERE status IN ('pending', 'submitted');
CREATE TRIGGER IF NOT EXISTS node_attempts_task_correlation_immutable
    BEFORE UPDATE OF task_id ON node_attempts
    WHEN OLD.task_id IS NOT NULL AND NEW.task_id IS NOT OLD.task_id
    BEGIN SELECT RAISE(ABORT, 'attempt task correlation is immutable'); END;

CREATE TABLE IF NOT EXISTS receipts (
    event_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES node_attempts(attempt_id),
    task_id TEXT,
    outcome TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('applied', 'duplicate')),
    received_at REAL NOT NULL
);
CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON receipts
    BEGIN SELECT RAISE(ABORT, 'receipts are append-only'); END;

CREATE TABLE IF NOT EXISTS transitions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    attempt_id TEXT REFERENCES node_attempts(attempt_id),
    event_id TEXT,
    from_node TEXT,
    outcome TEXT NOT NULL,
    target TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL
);
CREATE TRIGGER IF NOT EXISTS transitions_no_update BEFORE UPDATE ON transitions
    BEGIN SELECT RAISE(ABORT, 'transition journal is append-only'); END;
CREATE TRIGGER IF NOT EXISTS transitions_no_delete BEFORE DELETE ON transitions
    BEGIN SELECT RAISE(ABORT, 'transition journal is append-only'); END;

CREATE TABLE IF NOT EXISTS command_intents (
    intent_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    attempt_id TEXT NOT NULL REFERENCES node_attempts(attempt_id),
    kind TEXT NOT NULL {_check("kind", INTENT_KINDS)},
    status TEXT NOT NULL {_check("status", INTENT_STATUSES)},
    tries INTEGER NOT NULL DEFAULT 0,
    due_at REAL NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS command_intents_one_pending
    ON command_intents(attempt_id, kind) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS approval_gates (
    gate_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    node TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    scope TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    status TEXT NOT NULL {_check("status", GATE_STATUSES)},
    approver TEXT,
    decided_at REAL,
    expires_at REAL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS run_controls (
    run_id TEXT PRIMARY KEY REFERENCES workflow_runs(run_id),
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
    actor TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    updated_at REAL NOT NULL
);
"""


class RepositoryError(RuntimeError):
    """Repository misuse (nested transaction, missing row, tampered data)."""


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


class WorkflowRepository:
    """Owns its own connection; never shares Office fail-open write paths."""

    def __init__(self, db_path: str | Path, check_same_thread: bool = True) -> None:
        self.db_path = Path(db_path)
        # check_same_thread=False only for callers that serialise access
        # themselves (the HTTP service holds one lock around every call).
        self.db = sqlite3.connect(self.db_path, timeout=30.0, isolation_level=None,
                                  check_same_thread=check_same_thread)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.execute("PRAGMA busy_timeout = 30000")
        self.db.execute("PRAGMA synchronous = FULL")
        self._in_tx = False
        with self.transaction():
            for statement in _split_sql(SCHEMA):
                self.db.execute(statement)

    def close(self) -> None:
        self.db.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        if self._in_tx:
            raise RepositoryError("nested workflow transactions are not allowed")
        self.db.execute("BEGIN IMMEDIATE")
        self._in_tx = True
        try:
            yield self.db
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        else:
            self.db.execute("COMMIT")
        finally:
            self._in_tx = False

    def _require_tx(self) -> None:
        if not self._in_tx:
            raise RepositoryError("workflow mutation outside a transaction")

    # -- definitions -----------------------------------------------------
    def register_definition(self, definition: WorkflowDefinition, now: float) -> str:
        self._require_tx()
        digest = definition.definition_hash
        existing = self.db.execute(
            "SELECT 1 FROM workflow_definitions WHERE definition_hash=?",
            (digest,)).fetchone()
        if existing is None:
            self.db.execute(
                "INSERT INTO workflow_definitions VALUES (?, ?, ?, ?, ?)",
                (digest, definition.name, definition.version,
                 definition.canonical_json(), now))
        return digest

    def load_definition(self, definition_hash: str) -> WorkflowDefinition:
        row = self.db.execute(
            "SELECT canonical_json FROM workflow_definitions WHERE definition_hash=?",
            (definition_hash,)).fetchone()
        if row is None:
            raise RepositoryError(f"unknown definition {definition_hash}")
        definition = WorkflowDefinition.from_canonical_json(row["canonical_json"])
        if definition.definition_hash != definition_hash:
            raise RepositoryError(f"definition {definition_hash} failed hash check")
        return definition

    def list_definitions(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT definition_hash, name, version, created_at FROM workflow_definitions"
            " ORDER BY name, version")]

    # -- runs ------------------------------------------------------------
    def insert_run(self, run_id: str, definition_hash: str,
                   inputs: Mapping[str, Any], now: float) -> None:
        self._require_tx()
        self.db.execute(
            "INSERT INTO workflow_runs(run_id, definition_hash, status, inputs_json,"
            " created_at, updated_at) VALUES (?, ?, 'running', ?, ?, ?)",
            (run_id, definition_hash, json.dumps(dict(inputs), sort_keys=True),
             now, now))

    def get_run(self, run_id: str) -> dict[str, Any]:
        row = _row(self.db.execute("SELECT * FROM workflow_runs WHERE run_id=?",
                                   (run_id,)).fetchone())
        if row is None:
            raise RepositoryError(f"unknown run {run_id}")
        return row

    def update_run(self, run_id: str, now: float, **fields: Any) -> None:
        self._require_tx()
        fields["updated_at"] = now
        assignments = ", ".join(f"{k}=?" for k in fields)
        cur = self.db.execute(f"UPDATE workflow_runs SET {assignments} WHERE run_id=?",
                              (*fields.values(), run_id))
        if cur.rowcount != 1:
            raise RepositoryError(f"unknown run {run_id}")

    def runs_with_status(self, status: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM workflow_runs WHERE status=? ORDER BY created_at, run_id",
            (status,))]

    def list_runs(self, limit: int = 200) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM workflow_runs ORDER BY created_at DESC, run_id LIMIT ?",
            (limit,))]

    # -- operator controls -------------------------------------------------
    def set_paused(self, run_id: str, paused: bool, actor: str, reason: str,
                   now: float) -> None:
        self._require_tx()
        self.db.execute(
            "INSERT INTO run_controls(run_id, paused, actor, reason, updated_at)"
            " VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET"
            " paused=excluded.paused, actor=excluded.actor, reason=excluded.reason,"
            " updated_at=excluded.updated_at",
            (run_id, int(paused), actor, reason, now))

    def get_control(self, run_id: str) -> dict[str, Any] | None:
        return _row(self.db.execute("SELECT * FROM run_controls WHERE run_id=?",
                                    (run_id,)).fetchone())

    def paused_run_ids(self) -> frozenset[str]:
        return frozenset(r["run_id"] for r in self.db.execute(
            "SELECT run_id FROM run_controls WHERE paused=1"))

    # -- attempts --------------------------------------------------------
    def insert_attempt(self, attempt_id: str, run_id: str, node: str,
                       iteration: int, attempt_no: int, status: str,
                       now: float) -> None:
        self._require_tx()
        self.db.execute(
            "INSERT INTO node_attempts(attempt_id, run_id, node, iteration, attempt_no,"
            " status, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (attempt_id, run_id, node, iteration, attempt_no, status,
             f"agent-office-workflow:{attempt_id}", now))

    def get_attempt(self, attempt_id: str) -> dict[str, Any]:
        row = _row(self.db.execute("SELECT * FROM node_attempts WHERE attempt_id=?",
                                   (attempt_id,)).fetchone())
        if row is None:
            raise RepositoryError(f"unknown attempt {attempt_id}")
        return row

    def update_attempt(self, attempt_id: str, **fields: Any) -> None:
        self._require_tx()
        assignments = ", ".join(f"{k}=?" for k in fields)
        cur = self.db.execute(
            f"UPDATE node_attempts SET {assignments} WHERE attempt_id=?",
            (*fields.values(), attempt_id))
        if cur.rowcount != 1:
            raise RepositoryError(f"unknown attempt {attempt_id}")

    def attempts(self, run_id: str, node: str | None = None,
                 iteration: int | None = None) -> list[dict[str, Any]]:
        sql, args = "SELECT * FROM node_attempts WHERE run_id=?", [run_id]
        if node is not None:
            sql, args = sql + " AND node=?", args + [node]
        if iteration is not None:
            sql, args = sql + " AND iteration=?", args + [iteration]
        return [dict(r) for r in self.db.execute(
            sql + " ORDER BY created_at, node, iteration, attempt_no", args)]

    def active_attempt(self, run_id: str) -> dict[str, Any] | None:
        return _row(self.db.execute(
            "SELECT * FROM node_attempts WHERE run_id=? AND status IN"
            " ('pending', 'submitted')", (run_id,)).fetchone())

    def submitted_attempts(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM node_attempts WHERE status='submitted'"
            " AND task_id IS NOT NULL ORDER BY created_at, attempt_id")]

    def attempt_for_task(self, task_id: str) -> dict[str, Any] | None:
        return _row(self.db.execute("SELECT * FROM node_attempts WHERE task_id=?",
                                    (task_id,)).fetchone())

    def latest_success(self, run_id: str, node: str) -> dict[str, Any] | None:
        return _row(self.db.execute(
            "SELECT * FROM node_attempts WHERE run_id=? AND node=? AND"
            " status='succeeded' AND stale=0 ORDER BY iteration DESC, attempt_no DESC"
            " LIMIT 1", (run_id, node)).fetchone())

    def mark_stale(self, run_id: str, nodes: frozenset[str]) -> int:
        self._require_tx()
        if not nodes:
            return 0
        marks = ", ".join("?" for _ in nodes)
        cur = self.db.execute(
            f"UPDATE node_attempts SET stale=1 WHERE run_id=? AND stale=0"
            f" AND node IN ({marks})", (run_id, *sorted(nodes)))
        return cur.rowcount

    # -- receipts / journal ----------------------------------------------
    def has_receipt(self, event_id: str) -> bool:
        return self.db.execute("SELECT 1 FROM receipts WHERE event_id=?",
                               (event_id,)).fetchone() is not None

    def insert_receipt(self, event_id: str, attempt_id: str, task_id: str | None,
                       outcome: str, disposition: str, now: float) -> None:
        self._require_tx()
        self.db.execute("INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?)",
                        (event_id, attempt_id, task_id, outcome, disposition, now))

    def receipts(self, attempt_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM receipts WHERE attempt_id=? ORDER BY received_at, event_id",
            (attempt_id,))]

    def append_transition(self, run_id: str, attempt_id: str | None,
                          event_id: str | None, from_node: str | None,
                          outcome: str, target: str, reason: str,
                          now: float) -> None:
        self._require_tx()
        self.db.execute(
            "INSERT INTO transitions(run_id, attempt_id, event_id, from_node, outcome,"
            " target, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (run_id, attempt_id, event_id, from_node, outcome, target, reason, now))

    def transitions(self, run_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM transitions WHERE run_id=? ORDER BY seq", (run_id,))]

    # -- command intents (outbox to Bridge) ------------------------------
    def insert_intent(self, run_id: str, attempt_id: str, kind: str,
                      now: float) -> None:
        self._require_tx()
        self.db.execute(
            "INSERT INTO command_intents(run_id, attempt_id, kind, status, due_at,"
            " created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
            (run_id, attempt_id, kind, now, now, now))

    def due_intents(self, now: float) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM command_intents WHERE status='pending' AND due_at<=?"
            " ORDER BY due_at, intent_id", (now,))]

    def intents(self, run_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM command_intents WHERE run_id=? ORDER BY intent_id",
            (run_id,))]

    def update_intent(self, intent_id: int, now: float, **fields: Any) -> None:
        self._require_tx()
        fields["updated_at"] = now
        assignments = ", ".join(f"{k}=?" for k in fields)
        cur = self.db.execute(
            f"UPDATE command_intents SET {assignments} WHERE intent_id=?",
            (*fields.values(), intent_id))
        if cur.rowcount != 1:
            raise RepositoryError(f"unknown intent {intent_id}")

    def void_pending_intents(self, attempt_id: str, kind: str, now: float) -> None:
        self._require_tx()
        self.db.execute(
            "UPDATE command_intents SET status='void', updated_at=? WHERE"
            " attempt_id=? AND kind=? AND status='pending'", (now, attempt_id, kind))

    # -- approval gates --------------------------------------------------
    def insert_gate(self, gate_id: str, run_id: str, node: str, iteration: int,
                    scope: str, evidence_digest: str, expires_at: float | None,
                    now: float) -> None:
        self._require_tx()
        self.db.execute(
            "INSERT INTO approval_gates(gate_id, run_id, node, iteration, scope,"
            " evidence_digest, status, expires_at, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            (gate_id, run_id, node, iteration, scope, evidence_digest,
             expires_at, now))

    def get_gate(self, gate_id: str) -> dict[str, Any]:
        row = _row(self.db.execute("SELECT * FROM approval_gates WHERE gate_id=?",
                                   (gate_id,)).fetchone())
        if row is None:
            raise RepositoryError(f"unknown gate {gate_id}")
        return row

    def gates(self, run_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM approval_gates WHERE run_id=? ORDER BY created_at, gate_id",
            (run_id,))]

    def update_gate(self, gate_id: str, **fields: Any) -> None:
        self._require_tx()
        assignments = ", ".join(f"{k}=?" for k in fields)
        cur = self.db.execute(
            f"UPDATE approval_gates SET {assignments} WHERE gate_id=?",
            (*fields.values(), gate_id))
        if cur.rowcount != 1:
            raise RepositoryError(f"unknown gate {gate_id}")


def _split_sql(script: str) -> list[str]:
    """Split SCHEMA into statements, keeping trigger bodies intact."""
    statements, buffer = [], ""
    for line in script.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            if buffer.strip():
                statements.append(buffer.strip())
            buffer = ""
    if buffer.strip():
        raise RepositoryError("incomplete schema statement")
    return statements
