"""Fail-closed SQLite repository for Workflow Core state.

Unlike agent_office.storage.OfficeStorage, nothing here swallows errors or
returns fallbacks: every mutation runs inside an explicit BEGIN IMMEDIATE
transaction that either commits completely or raises. SQL constraints and
triggers back up the engine's invariants (pinned versions, single active
attempt per run, immutable task correlation, append-only journal).
"""

from __future__ import annotations

from contextlib import contextmanager
import dataclasses
import hashlib
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
APPROVAL_STATUSES = ("active", "revoked", "expired", "consumed")
SIDE_EFFECT_STATES = ("prepared", "in_flight", "confirmed", "failed_no_effect", "reconciliation_required")


@dataclasses.dataclass(frozen=True, slots=True)
class EvidenceRef:
    evidence_id: str
    run_id: str
    attempt_id: str
    bridge_task_id: str | None
    producer: str
    role: str
    input_sha: str
    output_digests: Mapping[str, str]
    criteria: tuple[str, ...]
    reviewer: str | None
    created_at: float
    fingerprint_hash: str

    def to_json(self) -> dict[str, Any]:
        return {
            "evidence_id": self.evidence_id,
            "run_id": self.run_id,
            "attempt_id": self.attempt_id,
            "bridge_task_id": self.bridge_task_id,
            "producer": self.producer,
            "role": self.role,
            "input_sha": self.input_sha,
            "output_digests": dict(self.output_digests),
            "criteria": list(self.criteria),
            "reviewer": self.reviewer,
            "created_at": self.created_at,
            "fingerprint_hash": self.fingerprint_hash,
        }


@dataclasses.dataclass(frozen=True, slots=True)
class ApprovalRecord:
    approval_id: str
    run_id: str
    version: int
    target: str
    digest: str
    params: Mapping[str, Any]
    intent_hash: str
    approver: str
    granted_scope: str
    expiry_at: float
    status: str
    created_at: float
    updated_at: float

    def to_json(self) -> dict[str, Any]:
        return {
            "approval_id": self.approval_id,
            "run_id": self.run_id,
            "version": self.version,
            "target": self.target,
            "digest": self.digest,
            "params": dict(self.params),
            "intent_hash": self.intent_hash,
            "approver": self.approver,
            "granted_scope": self.granted_scope,
            "expiry_at": self.expiry_at,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclasses.dataclass(frozen=True, slots=True)
class SideEffectRecord:
    effect_id: str
    run_id: str
    attempt_id: str
    approval_id: str | None
    target: str
    action_key: str
    digest: str
    state: str
    error_message: str
    created_at: float
    updated_at: float

    def to_json(self) -> dict[str, Any]:
        return {
            "effect_id": self.effect_id,
            "run_id": self.run_id,
            "attempt_id": self.attempt_id,
            "approval_id": self.approval_id,
            "target": self.target,
            "action_key": self.action_key,
            "digest": self.digest,
            "state": self.state,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def compute_evidence_fingerprint(
    run_id: str,
    attempt_id: str,
    bridge_task_id: str | None,
    producer: str,
    role: str,
    input_sha: str,
    output_digests: Mapping[str, str],
    criteria: tuple[str, ...] | list[str],
    reviewer: str | None,
    created_at: float,
) -> str:
    canonical_payload = {
        "attempt_id": attempt_id,
        "bridge_task_id": bridge_task_id or "",
        "created_at": round(float(created_at), 6),
        "criteria": sorted(str(c) for c in criteria),
        "input_sha": str(input_sha),
        "output_digests": {str(k): str(v) for k, v in sorted(output_digests.items())},
        "producer": str(producer),
        "reviewer": str(reviewer) if reviewer else None,
        "role": str(role),
        "run_id": str(run_id),
    }
    raw = json.dumps(canonical_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def compute_intent_hash(
    run_id: str,
    version: int,
    target: str,
    digest: str,
    params: Mapping[str, Any],
) -> str:
    canonical_payload = {
        "digest": str(digest),
        "params": json.loads(json.dumps(dict(params), sort_keys=True)),
        "run_id": str(run_id),
        "target": str(target),
        "version": int(version),
    }
    raw = json.dumps(canonical_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()


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

CREATE TABLE IF NOT EXISTS evidence_records (
    evidence_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    attempt_id TEXT NOT NULL REFERENCES node_attempts(attempt_id),
    bridge_task_id TEXT,
    producer TEXT NOT NULL,
    role TEXT NOT NULL,
    input_sha TEXT NOT NULL,
    output_digests_json TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    reviewer TEXT,
    fingerprint_hash TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TRIGGER IF NOT EXISTS evidence_records_no_update
    BEFORE UPDATE ON evidence_records
    BEGIN SELECT RAISE(ABORT, 'evidence records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS evidence_records_no_delete
    BEFORE DELETE ON evidence_records
    BEGIN SELECT RAISE(ABORT, 'evidence records are immutable'); END;

CREATE TABLE IF NOT EXISTS approval_records (
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    version INTEGER NOT NULL,
    target TEXT NOT NULL,
    digest TEXT NOT NULL,
    params_json TEXT NOT NULL,
    intent_hash TEXT NOT NULL,
    approver TEXT NOT NULL,
    granted_scope TEXT NOT NULL,
    expiry_at REAL NOT NULL,
    status TEXT NOT NULL {_check("status", APPROVAL_STATUSES)},
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS side_effect_records (
    effect_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    attempt_id TEXT NOT NULL REFERENCES node_attempts(attempt_id),
    approval_id TEXT REFERENCES approval_records(approval_id),
    target TEXT NOT NULL,
    action_key TEXT NOT NULL,
    digest TEXT NOT NULL,
    state TEXT NOT NULL {_check("state", SIDE_EFFECT_STATES)},
    error_message TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
"""


class RepositoryError(RuntimeError):
    """Repository misuse (nested transaction, missing row, tampered data)."""


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def _normalize_definition_content(data: Mapping[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if k not in ("version", "definition_hash")}


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

    def register_canonical_definition(self, definition: WorkflowDefinition, now: float) -> str:
        self._require_tx()
        candidate_data = definition.to_json()
        candidate_norm = _normalize_definition_content(candidate_data)

        rows = self.db.execute(
            "SELECT definition_hash, version, canonical_json FROM workflow_definitions"
            " WHERE name=? ORDER BY version DESC",
            (definition.name,)).fetchall()

        for row in rows:
            stored_data = json.loads(row["canonical_json"])
            if _normalize_definition_content(stored_data) == candidate_norm:
                return str(row["definition_hash"])

        existing_versions = {int(r["version"]) for r in rows}
        if definition.version in existing_versions:
            next_version = max(existing_versions) + 1
        else:
            next_version = definition.version

        target_def = (
            dataclasses.replace(definition, version=next_version)
            if next_version != definition.version
            else definition
        )
        digest = target_def.definition_hash

        existing = self.db.execute(
            "SELECT 1 FROM workflow_definitions WHERE definition_hash=?",
            (digest,)).fetchone()
        if existing is not None:
            return digest

        try:
            self.db.execute(
                "INSERT INTO workflow_definitions VALUES (?, ?, ?, ?, ?)",
                (digest, target_def.name, target_def.version,
                 target_def.canonical_json(), now))
            return digest
        except sqlite3.IntegrityError:
            rows = self.db.execute(
                "SELECT definition_hash, version, canonical_json FROM workflow_definitions"
                " WHERE name=? ORDER BY version DESC",
                (definition.name,)).fetchall()
            for row in rows:
                stored_data = json.loads(row["canonical_json"])
                if _normalize_definition_content(stored_data) == candidate_norm:
                    return str(row["definition_hash"])
            return self.register_canonical_definition(definition, now)

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

    def insert_evidence(
        self,
        run_id: str,
        attempt_id: str,
        bridge_task_id: str | None,
        producer: str,
        role: str,
        input_sha: str,
        output_digests: Mapping[str, str],
        criteria: tuple[str, ...] | list[str],
        reviewer: str | None,
        now: float,
        evidence_id: str | None = None,
    ) -> EvidenceRef:
        self._require_tx()
        if reviewer is not None and reviewer.strip() and reviewer.strip() == producer.strip():
            raise RepositoryError("reviewer must be distinct from producer for independent acceptance")

        fingerprint = compute_evidence_fingerprint(
            run_id=run_id,
            attempt_id=attempt_id,
            bridge_task_id=bridge_task_id,
            producer=producer,
            role=role,
            input_sha=input_sha,
            output_digests=output_digests,
            criteria=criteria,
            reviewer=reviewer,
            created_at=now,
        )
        eid = evidence_id or f"ev-{fingerprint.split(':')[-1][:16]}"
        self.db.execute(
            "INSERT INTO evidence_records(evidence_id, run_id, attempt_id, bridge_task_id,"
            " producer, role, input_sha, output_digests_json, criteria_json, reviewer,"
            " fingerprint_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (eid, run_id, attempt_id, bridge_task_id, producer, role, input_sha,
             json.dumps(dict(output_digests), sort_keys=True),
             json.dumps(list(criteria)), reviewer, fingerprint, now),
        )
        return EvidenceRef(
            evidence_id=eid,
            run_id=run_id,
            attempt_id=attempt_id,
            bridge_task_id=bridge_task_id,
            producer=producer,
            role=role,
            input_sha=input_sha,
            output_digests=dict(output_digests),
            criteria=tuple(criteria),
            reviewer=reviewer,
            created_at=now,
            fingerprint_hash=fingerprint,
        )

    def get_evidence(self, evidence_id: str) -> EvidenceRef:
        row = _row(self.db.execute("SELECT * FROM evidence_records WHERE evidence_id=?",
                                   (evidence_id,)).fetchone())
        if row is None:
            raise RepositoryError(f"unknown evidence {evidence_id}")
        return self._evidence_from_row(row)

    def evidence_for_attempt(self, attempt_id: str) -> list[EvidenceRef]:
        return [self._evidence_from_row(dict(r)) for r in self.db.execute(
            "SELECT * FROM evidence_records WHERE attempt_id=? ORDER BY created_at, evidence_id",
            (attempt_id,))]

    def evidence_for_run(self, run_id: str) -> list[EvidenceRef]:
        return [self._evidence_from_row(dict(r)) for r in self.db.execute(
            "SELECT * FROM evidence_records WHERE run_id=? ORDER BY created_at, evidence_id",
            (run_id,))]

    @staticmethod
    def _evidence_from_row(row: Mapping[str, Any]) -> EvidenceRef:
        return EvidenceRef(
            evidence_id=str(row["evidence_id"]),
            run_id=str(row["run_id"]),
            attempt_id=str(row["attempt_id"]),
            bridge_task_id=row["bridge_task_id"],
            producer=str(row["producer"]),
            role=str(row["role"]),
            input_sha=str(row["input_sha"]),
            output_digests=json.loads(row["output_digests_json"] or "{}"),
            criteria=tuple(json.loads(row["criteria_json"] or "[]")),
            reviewer=row["reviewer"],
            created_at=float(row["created_at"]),
            fingerprint_hash=str(row["fingerprint_hash"]),
        )

    def insert_approval_record(
        self,
        approval_id: str,
        run_id: str,
        version: int,
        target: str,
        digest: str,
        params: Mapping[str, Any],
        approver: str,
        granted_scope: str,
        expiry_at: float,
        now: float,
        status: str = "active",
    ) -> ApprovalRecord:
        self._require_tx()
        intent_hash = compute_intent_hash(
            run_id=run_id,
            version=version,
            target=target,
            digest=digest,
            params=params,
        )
        self.db.execute(
            "INSERT INTO approval_records(approval_id, run_id, version, target, digest,"
            " params_json, intent_hash, approver, granted_scope, expiry_at, status,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (approval_id, run_id, version, target, digest,
             json.dumps(dict(params), sort_keys=True),
             intent_hash, approver, granted_scope, expiry_at, status, now, now),
        )
        return ApprovalRecord(
            approval_id=approval_id,
            run_id=run_id,
            version=version,
            target=target,
            digest=digest,
            params=dict(params),
            intent_hash=intent_hash,
            approver=approver,
            granted_scope=granted_scope,
            expiry_at=expiry_at,
            status=status,
            created_at=now,
            updated_at=now,
        )

    def get_approval_record(self, approval_id: str) -> ApprovalRecord:
        row = _row(self.db.execute("SELECT * FROM approval_records WHERE approval_id=?",
                                   (approval_id,)).fetchone())
        if row is None:
            raise RepositoryError(f"unknown approval record {approval_id}")
        return self._approval_from_row(row)

    def approval_records_for_run(self, run_id: str) -> list[ApprovalRecord]:
        return [self._approval_from_row(dict(r)) for r in self.db.execute(
            "SELECT * FROM approval_records WHERE run_id=? ORDER BY created_at, approval_id",
            (run_id,))]

    def update_approval_status(self, approval_id: str, status: str, now: float) -> None:
        self._require_tx()
        if status not in APPROVAL_STATUSES:
            raise RepositoryError(f"invalid approval status {status}")
        cur = self.db.execute(
            "UPDATE approval_records SET status=?, updated_at=? WHERE approval_id=?",
            (status, now, approval_id))
        if cur.rowcount != 1:
            raise RepositoryError(f"unknown approval record {approval_id}")

    def revoke_approval(self, approval_id: str, now: float) -> None:
        self.update_approval_status(approval_id, "revoked", now)

    def active_approval_for_target(
        self,
        run_id: str,
        target: str,
        digest: str,
        now: float,
        version: int | None = None,
    ) -> ApprovalRecord | None:
        self._require_tx()
        rows = [dict(r) for r in self.db.execute(
            "SELECT * FROM approval_records WHERE run_id=? AND target=? ORDER BY created_at DESC",
            (run_id, target))]
        for r in rows:
            if r["status"] == "active":
                if now > float(r["expiry_at"]):
                    self.db.execute(
                        "UPDATE approval_records SET status='expired', updated_at=? WHERE approval_id=?",
                        (now, r["approval_id"]))
                    continue
                if version is not None and int(r["version"]) != version:
                    continue
                if r["digest"] != digest:
                    continue
                params = json.loads(r["params_json"] or "{}")
                expected_hash = compute_intent_hash(
                    run_id=r["run_id"],
                    version=int(r["version"]),
                    target=r["target"],
                    digest=digest,
                    params=params,
                )
                if r["intent_hash"] != expected_hash:
                    continue
                return self._approval_from_row(r)
        return None

    @staticmethod
    def _approval_from_row(row: Mapping[str, Any]) -> ApprovalRecord:
        return ApprovalRecord(
            approval_id=str(row["approval_id"]),
            run_id=str(row["run_id"]),
            version=int(row["version"]),
            target=str(row["target"]),
            digest=str(row["digest"]),
            params=json.loads(row["params_json"] or "{}"),
            intent_hash=str(row["intent_hash"]),
            approver=str(row["approver"]),
            granted_scope=str(row["granted_scope"]),
            expiry_at=float(row["expiry_at"]),
            status=str(row["status"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    def prepare_side_effect(
        self,
        effect_id: str,
        run_id: str,
        attempt_id: str,
        approval_id: str | None,
        target: str,
        action_key: str,
        digest: str,
        now: float,
    ) -> SideEffectRecord:
        self._require_tx()
        self.db.execute(
            "INSERT INTO side_effect_records(effect_id, run_id, attempt_id, approval_id,"
            " target, action_key, digest, state, error_message, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', '', ?, ?)",
            (effect_id, run_id, attempt_id, approval_id, target, action_key, digest, now, now),
        )
        return SideEffectRecord(
            effect_id=effect_id,
            run_id=run_id,
            attempt_id=attempt_id,
            approval_id=approval_id,
            target=target,
            action_key=action_key,
            digest=digest,
            state="prepared",
            error_message="",
            created_at=now,
            updated_at=now,
        )

    def transition_side_effect(
        self,
        effect_id: str,
        to_state: str,
        now: float,
        error_message: str = "",
        graph_version: int | None = None,
        scope: str | None = None,
    ) -> SideEffectRecord:
        self._require_tx()
        if to_state not in SIDE_EFFECT_STATES:
            raise RepositoryError(f"unknown side-effect state {to_state}")
        rec = self.get_side_effect(effect_id)
        current = rec.state
        allowed = {
            "prepared": ("in_flight",),
            "in_flight": ("confirmed", "failed_no_effect", "reconciliation_required"),
        }
        if to_state not in allowed.get(current, ()):
            raise RepositoryError(
                f"invalid side-effect transition: {current} -> {to_state}"
            )

        if to_state == "in_flight":
            if rec.approval_id:
                approval = self.get_approval_record(rec.approval_id)
                if approval.status != "active":
                    raise RepositoryError(
                        f"cannot transition side-effect to in_flight: approval {approval.approval_id} is {approval.status}"
                    )
                if now > approval.expiry_at:
                    self.update_approval_status(approval.approval_id, "expired", now)
                    raise RepositoryError(
                        f"cannot transition side-effect to in_flight: approval {approval.approval_id} has expired"
                    )
                if approval.run_id != rec.run_id:
                    raise RepositoryError(
                        f"cannot transition side-effect to in_flight: run_id mismatch ({approval.run_id} != {rec.run_id})"
                    )
                if approval.target != rec.target:
                    raise RepositoryError(
                        f"cannot transition side-effect to in_flight: target mismatch ({approval.target} != {rec.target})"
                    )
                if graph_version is not None and approval.version != graph_version:
                    raise RepositoryError(
                        f"cannot transition side-effect to in_flight: graph_version mismatch ({approval.version} != {graph_version})"
                    )
                if approval.digest != rec.digest:
                    raise RepositoryError(
                        f"cannot transition side-effect to in_flight: digest mismatch ({approval.digest} != {rec.digest})"
                    )
                expected_hash = compute_intent_hash(
                    run_id=approval.run_id,
                    version=approval.version,
                    target=approval.target,
                    digest=rec.digest,
                    params=approval.params,
                )
                if approval.intent_hash != expected_hash:
                    raise RepositoryError(
                        "cannot transition side-effect to in_flight: approval intent hash invalid"
                    )
                if scope is not None and approval.granted_scope != scope and not approval.granted_scope.startswith(f"{scope}:"):
                    raise RepositoryError(
                        f"cannot transition side-effect to in_flight: scope mismatch ({approval.granted_scope} != {scope})"
                    )
            elif rec.target == "publication":
                raise RepositoryError(
                    f"cannot transition side-effect {effect_id} to in_flight: missing required approval for {rec.target}"
                )

        cur = self.db.execute(
            "UPDATE side_effect_records SET state=?, error_message=?, updated_at=? WHERE effect_id=?",
            (to_state, error_message, now, effect_id),
        )
        if cur.rowcount != 1:
            raise RepositoryError(f"unknown side-effect record {effect_id}")

        return SideEffectRecord(
            effect_id=rec.effect_id,
            run_id=rec.run_id,
            attempt_id=rec.attempt_id,
            approval_id=rec.approval_id,
            target=rec.target,
            action_key=rec.action_key,
            digest=rec.digest,
            state=to_state,
            error_message=error_message,
            created_at=rec.created_at,
            updated_at=now,
        )

    def get_side_effect(self, effect_id: str) -> SideEffectRecord:
        row = _row(self.db.execute("SELECT * FROM side_effect_records WHERE effect_id=?",
                                   (effect_id,)).fetchone())
        if row is None:
            raise RepositoryError(f"unknown side effect {effect_id}")
        return self._side_effect_from_row(row)

    def side_effects_for_run(self, run_id: str) -> list[SideEffectRecord]:
        return [self._side_effect_from_row(dict(r)) for r in self.db.execute(
            "SELECT * FROM side_effect_records WHERE run_id=? ORDER BY created_at, effect_id",
            (run_id,))]

    @staticmethod
    def _side_effect_from_row(row: Mapping[str, Any]) -> SideEffectRecord:
        return SideEffectRecord(
            effect_id=str(row["effect_id"]),
            run_id=str(row["run_id"]),
            attempt_id=str(row["attempt_id"]),
            approval_id=row["approval_id"],
            target=str(row["target"]),
            action_key=str(row["action_key"]),
            digest=str(row["digest"]),
            state=str(row["state"]),
            error_message=str(row["error_message"] or ""),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )


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
