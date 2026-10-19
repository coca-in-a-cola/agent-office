"""Injectable Task Bridge port: the ONLY way Workflow Core reaches execution.

Core never spawns, kills or admits executors. It asks Bridge to submit,
report, cancel or reconcile a task identified by a deterministic
idempotency key derived from the persisted node_attempt id.
"""

from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass, field
import json
from pathlib import Path
import sqlite3
from typing import Any, Mapping, Protocol

# Mirrors task_bridge.models.TaskState values (read-only reference).
QUEUED, RUNNING = "queued", "running"
SUCCEEDED, FAILED, CANCELLED = "succeeded", "failed", "cancelled"
NEEDS_APPROVAL, DEGRADED = "needs_approval", "degraded"
TERMINAL_STATES = frozenset({SUCCEEDED, FAILED, CANCELLED, NEEDS_APPROVAL, DEGRADED})

EVIDENCE_FILENAME = "workflow-evidence.json"


class BridgeTransportError(RuntimeError):
    """Bridge call outcome is unknown; caller must reconcile, not assume."""


@dataclass(frozen=True, slots=True)
class SubmitRequest:
    idempotency_key: str
    title: str
    goal: str
    repo: str
    working_dir: str | None
    executor: str
    model: str
    timeout_seconds: int
    complexity: str = "medium"
    acceptance_criteria: tuple[str, ...] = ()
    constraints: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class BridgeTaskStatus:
    task_id: str
    idempotency_key: str
    state: str
    error: str = ""
    git_sha: str | None = None
    exit_code: int | None = None
    run_ids: tuple[str, ...] = ()
    artifacts: tuple[str, ...] = ()
    evidence: Mapping[str, Any] = field(default_factory=dict)

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL_STATES


class BridgePort(Protocol):
    def submit_task(self, request: SubmitRequest) -> str: ...
    def get_task_status(self, task_id: str) -> BridgeTaskStatus | None: ...
    def cancel_task(self, task_id: str, reason: str) -> bool: ...
    def reconcile_task(self, idempotency_key: str) -> BridgeTaskStatus | None: ...


class TaskBridgeAdapter:
    """Adapter over the public task_bridge.TaskBridge interface.

    The bridge object is injected (constructed by the supervisor with its
    own paths); this module never imports or opens a live Bridge database.
    Node evidence is read from a `workflow-evidence.json` task artifact.
    """

    def __init__(self, bridge: Any, complexity_type: Any = None) -> None:
        self.bridge = bridge
        if complexity_type is None:
            from task_bridge.models import TaskComplexity  # type: ignore[import-not-found]
            complexity_type = TaskComplexity
        self.complexity_type = complexity_type

    def submit_task(self, request: SubmitRequest) -> str:
        try:
            task_id = self.bridge.submit_task(
                title=request.title,
                goal=request.goal,
                repo=request.repo,
                working_dir=request.working_dir,
                complexity=self.complexity_type(request.complexity),
                acceptance_criteria=list(request.acceptance_criteria),
                constraints=list(request.constraints),
                idempotency_key=request.idempotency_key,
                timeout_seconds=request.timeout_seconds,
                model=request.model,
                executor=request.executor,
            )
        except Exception as exc:  # unknown whether Bridge persisted the task
            raise BridgeTransportError(f"submit failed: {exc!r}") from exc
        # Bridge may return a generated id whose save failed: confirm it.
        status = self.get_task_status(task_id)
        if status is None or status.idempotency_key != request.idempotency_key:
            status = self.reconcile_task(request.idempotency_key)
        if status is None:
            raise BridgeTransportError("submit acknowledgement not persisted")
        return status.task_id

    def get_task_status(self, task_id: str) -> BridgeTaskStatus | None:
        try:
            task = self.bridge.get_task(task_id)
        except Exception as exc:
            raise BridgeTransportError(f"status failed: {exc!r}") from exc
        return None if task is None else self._status(task)

    def cancel_task(self, task_id: str, reason: str) -> bool:
        try:
            return bool(self.bridge.cancel_task(task_id, reason=reason))
        except Exception as exc:
            raise BridgeTransportError(f"cancel failed: {exc!r}") from exc

    def reconcile_task(self, idempotency_key: str) -> BridgeTaskStatus | None:
        try:
            task = self.bridge.storage.get_task_by_idempotency_key(idempotency_key)
        except Exception as exc:
            raise BridgeTransportError(f"reconcile failed: {exc!r}") from exc
        return None if task is None else self._status(task)

    @staticmethod
    def _status(task: Any) -> BridgeTaskStatus:
        state = getattr(task.state, "value", task.state)
        artifacts = tuple(str(a) for a in (task.artifacts or ()))
        evidence: dict[str, Any] = {}
        for path in artifacts:
            if Path(path).name == EVIDENCE_FILENAME:
                try:
                    loaded = json.loads(Path(path).read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    loaded = None
                if isinstance(loaded, dict):
                    evidence = loaded
        return BridgeTaskStatus(
            task_id=task.id, idempotency_key=task.idempotency_key, state=str(state),
            error=task.error or "", git_sha=task.git_sha, exit_code=task.exit_code,
            run_ids=tuple(task.run_ids or ()), artifacts=artifacts, evidence=evidence)


class FakeBridge:
    """Persistent SQLite stand-in for Bridge; owns fake task identities only.

    Never executes anything. Tests drive task states explicitly and inject
    transport faults. UNIQUE(idempotency_key) models Bridge's intended
    idempotency contract, not measured real-Bridge concurrency.
    """

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self._faults: list[str] = []
        with closing(self._connect()) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS tasks (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT UNIQUE NOT NULL,
                    idempotency_key TEXT UNIQUE NOT NULL,
                    request_json TEXT NOT NULL,
                    state TEXT NOT NULL,
                    error TEXT NOT NULL DEFAULT '',
                    git_sha TEXT, exit_code INTEGER,
                    evidence_json TEXT NOT NULL DEFAULT '{}');
                CREATE TABLE IF NOT EXISTS calls (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    op TEXT NOT NULL, arg TEXT NOT NULL);
            """)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, timeout=30.0)
        db.row_factory = sqlite3.Row
        return db

    # -- fault injection -------------------------------------------------
    def inject(self, *faults: str) -> None:
        """Queue faults: 'submit_lost_ack' (accept then raise),
        'submit_reject' (raise before accepting), 'status_error',
        'cancel_error', 'reconcile_error'."""
        self._faults.extend(faults)

    def _take(self, fault: str) -> bool:
        if self._faults and self._faults[0] == fault:
            self._faults.pop(0)
            return True
        return False

    def _log(self, db: sqlite3.Connection, op: str, arg: str) -> None:
        db.execute("INSERT INTO calls(op, arg) VALUES (?, ?)", (op, arg))

    # -- BridgePort --------------------------------------------------------
    def submit_task(self, request: SubmitRequest) -> str:
        if self._take("submit_reject"):
            raise BridgeTransportError("injected: connection refused")
        with closing(self._connect()) as db, db:
            self._log(db, "submit", request.idempotency_key)
            row = db.execute("SELECT task_id FROM tasks WHERE idempotency_key=?",
                             (request.idempotency_key,)).fetchone()
            if row is None:
                seq = db.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM tasks").fetchone()[0]
                task_id = f"fake-task-{seq}"
                db.execute(
                    "INSERT INTO tasks(task_id, idempotency_key, request_json, state)"
                    " VALUES (?, ?, ?, ?)",
                    (task_id, request.idempotency_key,
                     json.dumps(_request_json(request), sort_keys=True), QUEUED))
            else:
                task_id = row["task_id"]
        if self._take("submit_lost_ack"):
            raise BridgeTransportError("injected: response lost after accept")
        return task_id

    def get_task_status(self, task_id: str) -> BridgeTaskStatus | None:
        if self._take("status_error"):
            raise BridgeTransportError("injected: status timeout")
        with closing(self._connect()) as db:
            row = db.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return None if row is None else self._status(row)

    def cancel_task(self, task_id: str, reason: str) -> bool:
        if self._take("cancel_error"):
            raise BridgeTransportError("injected: cancel timeout")
        with closing(self._connect()) as db, db:
            self._log(db, "cancel", task_id)
            cur = db.execute(
                "UPDATE tasks SET state=?, error=? WHERE task_id=? AND state IN (?, ?)",
                (CANCELLED, reason, task_id, QUEUED, RUNNING))
            return cur.rowcount == 1

    def reconcile_task(self, idempotency_key: str) -> BridgeTaskStatus | None:
        if self._take("reconcile_error"):
            raise BridgeTransportError("injected: reconcile timeout")
        with closing(self._connect()) as db:
            self._log(db, "reconcile", idempotency_key)
            db.commit()
            row = db.execute("SELECT * FROM tasks WHERE idempotency_key=?",
                             (idempotency_key,)).fetchone()
        return None if row is None else self._status(row)

    # -- test drivers ------------------------------------------------------
    def set_state(self, task_id: str, state: str, *, evidence: Mapping[str, Any] | None = None,
                  error: str = "", git_sha: str | None = None,
                  exit_code: int | None = None) -> None:
        with closing(self._connect()) as db, db:
            cur = db.execute(
                "UPDATE tasks SET state=?, error=?, git_sha=?, exit_code=?,"
                " evidence_json=? WHERE task_id=?",
                (state, error, git_sha, exit_code, json.dumps(dict(evidence or {})),
                 task_id))
            if cur.rowcount != 1:
                raise KeyError(task_id)

    def interrupt(self, task_id: str) -> None:
        """What Bridge recover_interrupted_tasks records for a lost executor."""
        self.set_state(task_id, FAILED, error="executor interrupted (process lost)",
                       exit_code=-9)

    def tasks(self) -> list[dict[str, Any]]:
        with closing(self._connect()) as db:
            return [dict(r) for r in db.execute("SELECT * FROM tasks ORDER BY seq")]

    def calls(self, op: str | None = None) -> list[str]:
        with closing(self._connect()) as db:
            rows = db.execute("SELECT op, arg FROM calls ORDER BY seq").fetchall()
        return [r["arg"] for r in rows if op is None or r["op"] == op]

    @staticmethod
    def _status(row: sqlite3.Row) -> BridgeTaskStatus:
        return BridgeTaskStatus(
            task_id=row["task_id"], idempotency_key=row["idempotency_key"],
            state=row["state"], error=row["error"], git_sha=row["git_sha"],
            exit_code=row["exit_code"], evidence=json.loads(row["evidence_json"]))


def _request_json(request: SubmitRequest) -> dict[str, Any]:
    return {"title": request.title, "goal": request.goal, "repo": request.repo,
            "executor": request.executor, "model": request.model,
            "timeout_seconds": request.timeout_seconds,
            "complexity": request.complexity}
