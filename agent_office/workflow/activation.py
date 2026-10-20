"""Durable activation receipts and idempotent Bridge submission/reconciliation boundary.

Implements AO-NE-05 activation01:
1. Durable per-run activation receipts with pinned input snapshots.
2. Invariant enforcement: definition_hash and input snapshots are strictly immutable.
3. Idempotent Bridge submission/reconciliation boundary:
   - Reconcile before submit prevents duplicate task creation on crash/lost-ack.
   - Idempotency key derived deterministically from attempt identity.
   - Pinned graph version and input snapshot context passed to Bridge.
4. Single authority for workflow-owned successor tasks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import sqlite3
import time
from typing import Any, Callable, Mapping

from .bridge_port import BridgePort, SubmitRequest
from .definitions import Outcome
from .engine import TaskEvent, WorkflowEngine
from .storage import RepositoryError, WorkflowRepository, _split_sql


class ActivationError(Exception):
    """Base error for activation operations."""


class PinnedInvariantError(ActivationError):
    """Violation of immutable pinned graph definition or inputs snapshot."""


class DuplicateActivationError(ActivationError):
    """Activation already exists and duplicate submission is rejected."""


ACTIVATION_SCHEMA = """
CREATE TABLE IF NOT EXISTS activation_receipts (
    activation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    node TEXT NOT NULL,
    iteration INTEGER NOT NULL CHECK (iteration >= 1),
    attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
    definition_hash TEXT NOT NULL REFERENCES workflow_definitions(definition_hash),
    input_snapshot_json TEXT NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    task_id TEXT UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('activated', 'submitted', 'duplicate', 'failed')),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE (run_id, node, iteration, attempt_no)
);

CREATE TRIGGER IF NOT EXISTS activation_receipts_pinned
    BEFORE UPDATE OF definition_hash, input_snapshot_json, idempotency_key ON activation_receipts
    WHEN NEW.definition_hash IS NOT OLD.definition_hash
         OR NEW.input_snapshot_json IS NOT OLD.input_snapshot_json
         OR NEW.idempotency_key IS NOT OLD.idempotency_key
    BEGIN SELECT RAISE(ABORT, 'activation receipt inputs and definition are immutable'); END;

CREATE TRIGGER IF NOT EXISTS activation_receipts_task_id_pinned
    BEFORE UPDATE OF task_id ON activation_receipts
    WHEN OLD.task_id IS NOT NULL AND NEW.task_id IS NOT OLD.task_id
    BEGIN SELECT RAISE(ABORT, 'activation receipt task correlation is immutable'); END;
"""


@dataclass(frozen=True, slots=True)
class ActivationReceipt:
    activation_id: str
    run_id: str
    node: str
    iteration: int
    attempt_no: int
    definition_hash: str
    input_snapshot: Mapping[str, Any]
    idempotency_key: str
    task_id: str | None
    status: str
    created_at: float
    updated_at: float


class ActivationBoundary:
    """Boundary coordinating durable activation receipts and idempotent Bridge tasks."""

    def __init__(
        self,
        repo: WorkflowRepository,
        engine: WorkflowEngine,
        bridge: BridgePort,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.repo = repo
        self.engine = engine
        self.bridge = bridge
        self.clock = clock
        self._init_schema()

    def _init_schema(self) -> None:
        with self.repo.transaction():
            for stmt in _split_sql(ACTIVATION_SCHEMA):
                self.repo.db.execute(stmt)

    def record_activation(
        self,
        run_id: str,
        node: str,
        iteration: int = 1,
        attempt_no: int = 1,
        definition_hash: str | None = None,
    ) -> ActivationReceipt:
        """Create or retrieve a durable activation receipt with pinned input snapshot."""
        now = self.clock()
        run = self.repo.get_run(run_id)
        pinned_def_hash = run["definition_hash"]

        if definition_hash is not None and definition_hash != pinned_def_hash:
            raise PinnedInvariantError(
                f"Requested definition {definition_hash} does not match pinned {pinned_def_hash}"
            )

        activation_id = f"act:{run_id}:{node}:{iteration}:{attempt_no}"
        idempotency_key = f"agent-office-workflow:{run_id}/{node}/{iteration}/{attempt_no}"

        with self.repo.transaction():
            row = self.repo.db.execute(
                "SELECT * FROM activation_receipts WHERE run_id=? AND node=? AND iteration=? AND attempt_no=?",
                (run_id, node, iteration, attempt_no),
            ).fetchone()

            if row is not None:
                return ActivationReceipt(
                    activation_id=row["activation_id"],
                    run_id=row["run_id"],
                    node=row["node"],
                    iteration=row["iteration"],
                    attempt_no=row["attempt_no"],
                    definition_hash=row["definition_hash"],
                    input_snapshot=json.loads(row["input_snapshot_json"]),
                    idempotency_key=row["idempotency_key"],
                    task_id=row["task_id"],
                    status="duplicate",
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                )

            inputs_snapshot = json.loads(run["inputs_json"])
            snapshot_json = json.dumps(inputs_snapshot, sort_keys=True)

            self.repo.db.execute(
                """
                INSERT INTO activation_receipts (
                    activation_id, run_id, node, iteration, attempt_no,
                    definition_hash, input_snapshot_json, idempotency_key,
                    task_id, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'activated', ?, ?)
                """,
                (
                    activation_id,
                    run_id,
                    node,
                    iteration,
                    attempt_no,
                    pinned_def_hash,
                    snapshot_json,
                    idempotency_key,
                    now,
                    now,
                ),
            )

            return ActivationReceipt(
                activation_id=activation_id,
                run_id=run_id,
                node=node,
                iteration=iteration,
                attempt_no=attempt_no,
                definition_hash=pinned_def_hash,
                input_snapshot=inputs_snapshot,
                idempotency_key=idempotency_key,
                task_id=None,
                status="activated",
                created_at=now,
                updated_at=now,
            )

    def get_activation(self, activation_id: str) -> ActivationReceipt | None:
        row = self.repo.db.execute(
            "SELECT * FROM activation_receipts WHERE activation_id=?", (activation_id,)
        ).fetchone()
        if row is None:
            return None
        return ActivationReceipt(
            activation_id=row["activation_id"],
            run_id=row["run_id"],
            node=row["node"],
            iteration=row["iteration"],
            attempt_no=row["attempt_no"],
            definition_hash=row["definition_hash"],
            input_snapshot=json.loads(row["input_snapshot_json"]),
            idempotency_key=row["idempotency_key"],
            task_id=row["task_id"],
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def submit_or_reconcile(self, activation_id: str) -> str:
        """Idempotently submit activation to Bridge or reconcile existing Bridge task.

        Guarantees that crash-before-submit and crash-after-submit cannot produce
        a second concrete task in Bridge.
        """
        now = self.clock()
        receipt = self.get_activation(activation_id)
        if receipt is None:
            raise ActivationError(f"unknown activation {activation_id}")

        if receipt.task_id is not None:
            return receipt.task_id

        attempt_id = f"{receipt.run_id}/{receipt.node}/{receipt.iteration}/{receipt.attempt_no}"

        # 0. If attempt in repository already has task_id correlated, adopt it
        try:
            attempt = self.repo.get_attempt(attempt_id)
            if attempt["task_id"] is not None:
                task_id = attempt["task_id"]
                with self.repo.transaction():
                    self.repo.db.execute(
                        "UPDATE activation_receipts SET task_id=?, status='submitted', updated_at=? WHERE activation_id=?",
                        (task_id, now, activation_id),
                    )
                return task_id
        except RepositoryError:
            pass

        # 1. Reconcile with Bridge first using deterministic idempotency key
        existing = self.bridge.reconcile_task(receipt.idempotency_key)
        if existing is not None:
            task_id = existing.task_id
        else:
            # 2. Build SubmitRequest using engine's canonical authority to prevent competing submission paths
            try:
                req = self.engine.submit_request(attempt_id)
            except RepositoryError:
                # Standalone fallback if attempt was not inserted via engine
                run = self.repo.get_run(receipt.run_id)
                node_def = self.engine.definition_for(run).node(receipt.node)
                inputs = receipt.input_snapshot

                context = {
                    "run_goal": inputs.get("goal", ""),
                    "definition_hash": receipt.definition_hash,
                    "activation_id": receipt.activation_id,
                    "node": receipt.node,
                    "iteration": receipt.iteration,
                    "attempt_no": receipt.attempt_no,
                }

                executor = (
                    inputs.get("executor")
                    if inputs.get("executor") in node_def.allowed_executors
                    else node_def.allowed_executors[0]
                )
                model = (
                    inputs.get("model")
                    if inputs.get("model") in node_def.allowed_models
                    else node_def.allowed_models[0]
                )

                req = SubmitRequest(
                    idempotency_key=receipt.idempotency_key,
                    title=f"[{receipt.run_id}] {receipt.node} #{receipt.iteration}.{receipt.attempt_no}",
                    goal=f"{node_def.goal}\n\nWorkflow context: {json.dumps(context, sort_keys=True)}",
                    repo=str(inputs.get("repo", "")),
                    working_dir=inputs.get("working_dir"),
                    executor=executor,
                    model=model,
                    timeout_seconds=node_def.timeout_seconds,
                    acceptance_criteria=node_def.completion_criteria,
                    constraints=(f"role: {node_def.role}",),
                )
            task_id = self.bridge.submit_task(req)

        # 3. Atomically persist task_id correlation in receipt
        with self.repo.transaction():
            self.repo.db.execute(
                "UPDATE activation_receipts SET task_id=?, status='submitted', updated_at=? WHERE activation_id=?",
                (task_id, now, activation_id),
            )

        return task_id

    def create_task_event(
        self,
        activation_id: str,
        outcome: Outcome,
        evidence: Mapping[str, Any] | None = None,
        reason: str = "",
    ) -> TaskEvent:
        """Create a deterministic TaskEvent from an activation receipt."""
        receipt = self.get_activation(activation_id)
        if receipt is None:
            raise ActivationError(f"unknown activation {activation_id}")
        if receipt.task_id is None:
            raise ActivationError(f"activation {activation_id} has not been submitted yet")

        attempt_id = f"{receipt.run_id}/{receipt.node}/{receipt.iteration}/{receipt.attempt_no}"
        return TaskEvent(
            event_id=f"bridge:{receipt.task_id}:{outcome.value}",
            attempt_id=attempt_id,
            task_id=receipt.task_id,
            outcome=outcome,
            evidence=dict(evidence or {}),
            reason=reason,
        )
