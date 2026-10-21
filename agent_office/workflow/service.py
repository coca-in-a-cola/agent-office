"""Process Studio service: JSON views and operator commands over Workflow Core.

The HTTP server is a client of this service, never a source of truth: every
command goes through WorkflowEngine (one transaction each) and Bridge is only
reached by the Coordinator. One lock serialises the shared SQLite connection
between HTTP handler threads and the optional background coordinator thread.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping

from .bridge_port import BridgePort
from .coordinator import Coordinator
from .definitions import DefinitionError, Outcome, WorkflowDefinition
from .engine import (
    TERMINAL_RUN_STATUSES, ApprovalError, ControlError, CorrelationError,
    WorkflowEngine,
)
from .release_workflow import build_release_workflow
from .templates import get_all_templates
from .storage import RepositoryError, WorkflowRepository

logger = logging.getLogger("agent_office.workflow.service")

RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

# Graph badge per attempt status (Process Studio colour legend).
NODE_STATE = {
    "pending": "running",
    "submitted": "running",
    "succeeded": "succeeded",
    "defect": "defect",
    "timed_out": "timeout",
    "failed": "failure",
    "cancelled": "cancelled",
    "quota": "quota",
    "awaiting_approval": "approval_wait",
}

# Tycoon View: office workstation that performs each workflow node role.
# Unknown roles project onto a workstation named after the role itself.
ROLE_WORKSTATIONS = {
    "implementer": "coder",
    "independent_reviewer": "qa",
    "builder": "devops",
    "artifact_checker": "qa",
    "publisher": "devops",
    "owner_liaison": "tyler",
}
# Approval gates are decided by the managing director's desk.
APPROVER_WORKSTATION = "tyler"


class WorkflowApiError(Exception):
    """Client-visible error carrying an HTTP status code."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _json(text: str | None) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return {"unparsed": text}


def _text(payload: Mapping[str, Any], key: str, default: str = "",
          required: bool = False) -> str:
    value = payload.get(key, default)
    if value is None:
        value = default
    if not isinstance(value, str):
        raise WorkflowApiError(400, f"{key} must be a string")
    value = value.strip()
    if required and not value:
        raise WorkflowApiError(400, f"{key} is required")
    return value


class WorkflowService:
    def __init__(self, db_path: str | Path, bridge: BridgePort, *,
                 clock: Callable[[], float] = time.time,
                 bridge_kind: str = "custom") -> None:
        self.lock = threading.RLock()
        self.repo = WorkflowRepository(db_path, check_same_thread=False)
        self.engine = WorkflowEngine(self.repo, clock=clock)
        self.coordinator = Coordinator(self.engine, bridge)
        self.bridge_kind = bridge_kind
        with self.repo.transaction():
            self.canonical_hash = self.repo.register_canonical_definition(
                build_release_workflow(), clock())
            self.template_hashes = {
                name: (self.canonical_hash if name == "software-release" else
                       self.repo.register_definition(definition, clock()))
                for name, definition in get_all_templates().items()
            }
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- lifecycle -------------------------------------------------------
    def tick(self) -> dict[str, int]:
        """Advance until nothing is due right now; returns summed counters."""
        with self.lock:
            reports = self.coordinator.run_until_idle()
        return {key: sum(getattr(r, key) for r in reports) for key in vars(reports[0])}

    def start(self, interval: float = 5.0) -> None:
        """Run the coordinator in a daemon thread (headless; no browser needed)."""
        if self._thread is not None:
            return

        def loop() -> None:
            while not self._stop.is_set():
                try:
                    self.tick()
                except Exception:  # keep supervising; state is transactional
                    logger.exception("workflow coordinator tick failed")
                self._stop.wait(interval)

        self._thread = threading.Thread(target=loop, name="workflow-coordinator",
                                        daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        with self.lock:
            self.repo.close()

    # -- definitions -----------------------------------------------------
    def list_templates(self) -> list[dict[str, Any]]:
        """Return registered, hash-pinned blueprints including node contracts."""
        with self.lock:
            return [dict(self._definition_json(self.repo.load_definition(digest)),
                         template_id=name)
                    for name, digest in self.template_hashes.items()]

    def list_definitions(self) -> dict[str, Any]:
        with self.lock:
            rows = self.repo.list_definitions()
            items = []
            for row in rows:
                definition = self.repo.load_definition(row["definition_hash"])
                items.append({
                    "definition_hash": row["definition_hash"],
                    "name": row["name"],
                    "version": row["version"],
                    "created_at": row["created_at"],
                    "start": definition.start,
                    "node_count": len(definition.nodes),
                    "canonical": row["definition_hash"] == self.canonical_hash,
                })
        return {"definitions": items, "canonical_hash": self.canonical_hash}

    def get_definition(self, definition_hash: str) -> dict[str, Any]:
        with self.lock:
            definition = self._load_definition(definition_hash)
        return self._definition_json(definition)

    def _load_definition(self, definition_hash: str) -> WorkflowDefinition:
        try:
            return self.repo.load_definition(definition_hash)
        except RepositoryError as exc:
            raise WorkflowApiError(404, str(exc)) from exc

    def _definition_json(self, definition: WorkflowDefinition) -> dict[str, Any]:
        data = definition.to_json()
        names = {n.name for n in definition.nodes}
        order, node = [], definition.start
        while node in names and node not in order:  # main success path
            order.append(node)
            node = definition.target(node, Outcome.SUCCESS)
        order += sorted(names - set(order))
        data.update({
            "definition_hash": definition.definition_hash,
            "canonical": definition.definition_hash == self.canonical_hash,
            "node_order": order,
            "allowed_transitions": data["transitions"],
        })
        return data

    # -- runs ------------------------------------------------------------
    def create_run(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        definition_hash = _text(payload, "definition_hash") or self.canonical_hash
        inputs = payload.get("inputs", {})
        if not isinstance(inputs, dict):
            raise WorkflowApiError(400, "inputs must be an object")
        inputs = dict(inputs)
        for key in ("goal", "repo", "working_dir"):
            if key in payload and key not in inputs:
                inputs[key] = payload[key]
        if not isinstance(inputs.get("goal"), str) or not inputs["goal"].strip():
            raise WorkflowApiError(400, "inputs.goal is required")
        run_id = _text(payload, "run_id") or (
            time.strftime("run-%Y%m%d-%H%M%S-") + secrets.token_hex(3))
        if not RUN_ID_RE.match(run_id):
            raise WorkflowApiError(400, "run_id must match [A-Za-z0-9._-]{1,64}")
        with self.lock:
            self._load_definition(definition_hash)
            try:
                self.engine.start_run(run_id, definition_hash, inputs)
            except sqlite3.IntegrityError as exc:
                raise WorkflowApiError(400, f"run {run_id} already exists") from exc
            self.coordinator.run_until_idle()
            return self._run_detail(run_id)

    def list_runs(self) -> dict[str, Any]:
        with self.lock:
            paused = self.repo.paused_run_ids()
            runs = []
            for run in self.repo.list_runs():
                definition = self.engine.definition_for(run)
                attempts = self.repo.attempts(run["run_id"])
                runs.append({
                    "run_id": run["run_id"],
                    "definition_hash": run["definition_hash"],
                    "definition_name": definition.name,
                    "definition_version": definition.version,
                    "status": run["status"],
                    "status_reason": run["status_reason"],
                    "current_node": run["current_node"],
                    "paused": run["run_id"] in paused,
                    "active": run["status"] not in TERMINAL_RUN_STATUSES,
                    "attempt_count": len(attempts),
                    "goal": (_json(run["inputs_json"]) or {}).get("goal", ""),
                    "created_at": run["created_at"],
                    "updated_at": run["updated_at"],
                })
        return {"runs": runs,
                "summary": {s: sum(1 for r in runs if r["status"] == s)
                            for s in sorted({r["status"] for r in runs})}}

    def get_run(self, run_id: str) -> dict[str, Any]:
        with self.lock:
            return self._run_detail(run_id)

    def _get_run_row(self, run_id: str) -> dict[str, Any]:
        try:
            return self.repo.get_run(run_id)
        except RepositoryError as exc:
            raise WorkflowApiError(404, f"unknown run {run_id}") from exc

    def _run_detail(self, run_id: str) -> dict[str, Any]:
        run = self._get_run_row(run_id)
        definition = self.engine.definition_for(run)
        control = self.repo.get_control(run_id)
        paused = bool(control and control["paused"])
        attempts = [self._attempt_json(a) for a in self.repo.attempts(run_id)]
        gates = self.repo.gates(run_id)
        pending_gate = next((g for g in reversed(gates) if g["status"] == "pending"), None)
        active = self.repo.active_attempt(run_id)
        current = None
        if active is not None:
            current = next(a for a in attempts if a["attempt_id"] == active["attempt_id"])
        elif attempts:
            current = attempts[-1]

        node_states: dict[str, dict[str, Any]] = {}
        for node in definition.nodes:
            mine = [a for a in attempts if a["node"] == node.name]
            last = mine[-1] if mine else None
            state = NODE_STATE.get(last["status"], "pending") if last else "pending"
            if pending_gate is not None and pending_gate["node"] == node.name:
                state = "approval_wait"
            node_states[node.name] = {
                "state": state,
                "attempts": len(mine),
                "iteration": last["iteration"] if last else 0,
                "stale": bool(last and last["stale"]),
                "last_attempt_id": last["attempt_id"] if last else None,
                "is_current": node.name == run["current_node"],
            }

        terminal = run["status"] in TERMINAL_RUN_STATUSES
        last_current = [a for a in attempts if a["node"] == run["current_node"]]
        retryable = (run["status"] == "blocked" and active is None and bool(last_current)
                     and last_current[-1]["status"] in ("failed", "timed_out"))
        intents = self.repo.intents(run_id)
        return {
            "run": {
                "run_id": run_id,
                "definition_hash": run["definition_hash"],
                "definition_name": definition.name,
                "definition_version": definition.version,
                "status": run["status"],
                "status_reason": run["status_reason"],
                "current_node": run["current_node"],
                "source_sha": run["source_sha"],
                "inputs": _json(run["inputs_json"]) or {},
                "due_at": run["due_at"],
                "created_at": run["created_at"],
                "updated_at": run["updated_at"],
                "paused": paused,
                "control": control,
            },
            "current_attempt": current,
            "attempts": attempts,
            "node_states": node_states,
            "gates": gates,
            "pending_gate": pending_gate,
            "timeline": self.repo.transitions(run_id),
            "intents": intents,
            "logs": self._logs(attempts, intents),
            "evidence_digests": {
                a["attempt_id"]: a["artifacts"] for a in attempts if a["artifacts"]},
            "actions": {
                "pause": not terminal and not paused,
                "resume": paused,
                "cancel": not terminal and run["status"] != "cancelling",
                "approve": pending_gate is not None and run["status"] == "waiting_approval",
                "retry": retryable,
            },
            "bridge": self.bridge_kind,
        }

    # -- Tycoon View projection ------------------------------------------------
    def workstation_assignments(self) -> list[dict[str, Any]]:
        """Project live runs onto office workstations, most recently updated first.

        Derived only from persisted runs, node attempts (with their Bridge task
        ids) and approval gates. Terminal runs project nothing, so a desk with
        no live run stays idle.
        """
        with self.lock:
            items = []
            for run in self.repo.list_runs():
                if run["status"] in TERMINAL_RUN_STATUSES or not run["current_node"]:
                    continue
                items.extend(self._run_assignments(run))
        items.sort(key=lambda a: (-a["updated_at"], a["run_id"]))
        return items

    def _run_assignments(self, run: Mapping[str, Any]) -> list[dict[str, Any]]:
        definition = self.engine.definition_for(run)
        node = definition.node(run["current_node"])
        attempts = self.repo.attempts(run["run_id"], node.name)
        last = attempts[-1] if attempts else None
        status = run["status"]
        if status in ("running", "cancelling"):
            desk_status = "working"
        elif status == "waiting_approval":
            desk_status = "review"
        elif status == "blocked" and last is not None and last["status"] == "defect":
            desk_status = "defect"
        else:  # blocked, inspecting (timeout), quota_wait
            desk_status = "blocked"
        gate = next((g for g in reversed(self.repo.gates(run["run_id"]))
                     if g["status"] == "pending" and g["node"] == node.name), None)
        inputs = _json(run["inputs_json"]) or {}
        title = str(inputs.get("title") or inputs.get("goal") or run["run_id"]).strip()
        if len(title) > 60:
            title = title[:59] + "…"
        base = {
            "status": desk_status,
            "run_id": run["run_id"],
            "run_status": status,
            "status_reason": run["status_reason"],
            "definition_name": definition.name,
            "title": title,
            "node": node.name,
            "role": node.role,
            "current_task": f"{title} — {node.name}",
            "attempt_id": last["attempt_id"] if last else None,
            "attempt_status": last["status"] if last else None,
            "iteration": last["iteration"] if last else (gate["iteration"] if gate else 0),
            "task_id": last["task_id"] if last else None,
            "gate_id": gate["gate_id"] if gate else None,
            "updated_at": run["updated_at"],
        }
        desk = ROLE_WORKSTATIONS.get(node.role, node.role)
        items = [dict(base, workstation=desk, assignment="performer")]
        if desk_status == "review" and desk != APPROVER_WORKSTATION:
            items.append(dict(base, workstation=APPROVER_WORKSTATION,
                              assignment="approver"))
        return items

    def _attempt_json(self, row: Mapping[str, Any]) -> dict[str, Any]:
        evidence = _json(row["evidence_json"])
        artifacts = evidence.get("artifacts") if isinstance(evidence, dict) else None
        return {
            "attempt_id": row["attempt_id"],
            "node": row["node"],
            "iteration": row["iteration"],
            "attempt_no": row["attempt_no"],
            "status": row["status"],
            "task_id": row["task_id"],
            "idempotency_key": row["idempotency_key"],
            "stale": bool(row["stale"]),
            "producer": row["producer"],
            "reason": row["reason"],
            "evidence": evidence,
            "artifacts": artifacts if isinstance(artifacts, dict) else {},
            "created_at": row["created_at"],
            "submitted_at": row["submitted_at"],
            "deadline_at": row["deadline_at"],
            "finished_at": row["finished_at"],
            "receipts": self.repo.receipts(row["attempt_id"]),
        }

    @staticmethod
    def _logs(attempts: list[dict[str, Any]],
              intents: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Execution log lines merged from Bridge receipts and command intents."""
        lines = []
        for intent in intents:
            text = f"{intent['kind']} intent {intent['status']} (tries {intent['tries']})"
            if intent["last_error"]:
                text += f": {intent['last_error']}"
            lines.append({"at": intent["updated_at"], "attempt_id": intent["attempt_id"],
                          "source": "coordinator", "message": text})
        for attempt in attempts:
            for receipt in attempt["receipts"]:
                lines.append({"at": receipt["received_at"],
                              "attempt_id": attempt["attempt_id"], "source": "bridge",
                              "message": f"{receipt['event_id']} -> {receipt['outcome']}"
                                         f" ({receipt['disposition']})"})
            if attempt["reason"]:
                lines.append({"at": attempt["finished_at"] or attempt["created_at"],
                              "attempt_id": attempt["attempt_id"], "source": "engine",
                              "message": attempt["reason"]})
        lines.sort(key=lambda line: (line["at"] or 0))
        return lines

    # -- commands ----------------------------------------------------------
    def _command(self, run_id: str, action: Callable[[], Any]) -> dict[str, Any]:
        with self.lock:
            self._get_run_row(run_id)
            try:
                result = action()
            except (ControlError, ApprovalError, CorrelationError, DefinitionError) as exc:
                raise WorkflowApiError(400, str(exc)) from exc
            except RepositoryError as exc:
                raise WorkflowApiError(404, str(exc)) from exc
            self.coordinator.run_until_idle()
            detail = self._run_detail(run_id)
        if result is not None:
            detail["result"] = result
        return detail

    def pause(self, run_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        actor, reason = _text(payload, "actor", "owner"), _text(payload, "reason")
        return self._command(run_id, lambda: self.engine.pause_run(run_id, actor, reason))

    def resume(self, run_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        actor, reason = _text(payload, "actor", "owner"), _text(payload, "reason")
        return self._command(run_id, lambda: self.engine.resume_run(run_id, actor, reason))

    def cancel(self, run_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        reason = _text(payload, "reason", "cancelled from Process Studio")

        def action() -> None:
            if self.repo.get_run(run_id)["status"] in TERMINAL_RUN_STATUSES:
                raise ControlError(f"{run_id} already finished")
            self.engine.request_cancel(run_id, reason)
        return self._command(run_id, action)

    def approve(self, run_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        approver = _text(payload, "approver", required=True)
        scope = _text(payload, "scope", required=True)
        gate_id = _text(payload, "gate_id")

        def action() -> dict[str, str]:
            if not gate_id:
                pending = [g for g in self.repo.gates(run_id) if g["status"] == "pending"]
                if not pending:
                    raise ApprovalError(f"{run_id} has no pending approval gate")
                chosen = pending[-1]["gate_id"]
            else:
                chosen = gate_id
                if self._gate_run(chosen) != run_id:
                    raise ApprovalError(f"gate {chosen} does not belong to {run_id}")
            return {"gate_id": chosen,
                    "attempt_id": self.engine.approve(chosen, approver, scope)}
        return self._command(run_id, action)

    def _gate_run(self, gate_id: str) -> str | None:
        try:
            return self.repo.get_gate(gate_id)["run_id"]
        except RepositoryError:
            return None

    def retry(self, run_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        actor, reason = _text(payload, "actor", "owner"), _text(payload, "reason")
        confirm = payload.get("confirm_side_effect", False)
        if not isinstance(confirm, bool):
            raise WorkflowApiError(400, "confirm_side_effect must be a boolean")
        return self._command(run_id, lambda: {"attempt_id": self.engine.authorize_retry(
            run_id, actor, reason, confirm_side_effect=confirm)})

