"""Transition reducer for pinned workflow runs.

Every public mutation is ONE repository transaction: receipt, attempt
result, journal entry, successor attempt and its Bridge command intent
commit together or not at all. External calls never happen here; the
coordinator executes persisted command intents afterwards (outbox pattern).
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
import time
from typing import Any, Callable, Mapping

from .bridge_port import (
    CANCELLED, DEGRADED, FAILED, NEEDS_APPROVAL, SUCCEEDED, BridgeTaskStatus,
    SubmitRequest,
)
from .definitions import NodeDefinition, Outcome, Target, WorkflowDefinition
from .storage import RepositoryError, WorkflowRepository

DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
TERMINAL_RUN_STATUSES = frozenset({"cancelled", "completed"})

ATTEMPT_STATUS = {
    Outcome.SUCCESS: "succeeded",
    Outcome.DEFECT: "defect",
    Outcome.TIMEOUT: "timed_out",
    Outcome.FAILURE: "failed",
    Outcome.CANCEL: "cancelled",
    Outcome.QUOTA: "quota",
    Outcome.APPROVAL_WAIT: "awaiting_approval",
}
FAILURE_STATUSES = ("failed", "timed_out")


class CorrelationError(Exception):
    """Event does not match the persisted attempt <-> Bridge task pair."""


class ApprovalError(Exception):
    """Approval decision does not match a pending, current, in-scope gate."""


@dataclass(frozen=True, slots=True)
class Policy:
    """GRAPH-01 proposed milestone bounds; persisted counters enforce them."""

    transport_backoff_seconds: tuple[float, ...] = (2.0, 4.0, 8.0)
    quota_backoff_seconds: tuple[float, ...] = (60.0, 300.0, 900.0)
    approval_ttl_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class TaskEvent:
    event_id: str
    attempt_id: str
    task_id: str
    outcome: Outcome
    evidence: Mapping[str, Any] = field(default_factory=dict)
    reason: str = ""


@dataclass(frozen=True, slots=True)
class EventResult:
    disposition: str            # "applied" | "duplicate"
    run_status: str
    target: str | None = None
    next_attempt: str | None = None


def outcome_from_status(status: BridgeTaskStatus) -> Outcome | None:
    """Interpret a terminal Bridge task state; None while still active."""
    if status.state == SUCCEEDED:
        if status.evidence.get("verdict") == "defect":
            return Outcome.DEFECT
        return Outcome.SUCCESS
    if status.state == FAILED:
        error = status.error.lower()
        if any(k in error for k in ("quota", "rate limit", "rate_limit", "429")):
            return Outcome.QUOTA
        if "timeout" in error or "timed out" in error:
            return Outcome.TIMEOUT
        return Outcome.FAILURE
    if status.state == DEGRADED:
        return Outcome.FAILURE
    if status.state == CANCELLED:
        return Outcome.CANCEL
    if status.state == NEEDS_APPROVAL:
        return Outcome.APPROVAL_WAIT
    return None


def event_from_status(attempt: Mapping[str, Any], status: BridgeTaskStatus) -> TaskEvent | None:
    """Deterministic event id so repeated polls/wakes deduplicate."""
    outcome = outcome_from_status(status)
    if outcome is None:
        return None
    return TaskEvent(event_id=f"bridge:{status.task_id}:{status.state}",
                     attempt_id=attempt["attempt_id"], task_id=status.task_id,
                     outcome=outcome, evidence=dict(status.evidence),
                     reason=status.error)


class WorkflowEngine:
    def __init__(self, repo: WorkflowRepository,
                 clock: Callable[[], float] = time.time,
                 policy: Policy = Policy()) -> None:
        self.repo = repo
        self.clock = clock
        self.policy = policy
        self._definitions: dict[str, WorkflowDefinition] = {}

    # -- definitions / runs ------------------------------------------------
    def register(self, definition: WorkflowDefinition) -> str:
        with self.repo.transaction():
            return self.repo.register_definition(definition, self.clock())

    def definition_for(self, run: Mapping[str, Any]) -> WorkflowDefinition:
        digest = run["definition_hash"]
        if digest not in self._definitions:
            self._definitions[digest] = self.repo.load_definition(digest)
        return self._definitions[digest]

    def start_run(self, run_id: str, definition_hash: str,
                  inputs: Mapping[str, Any]) -> str | None:
        """Pin run to definition_hash and activate its start node."""
        now = self.clock()
        with self.repo.transaction():
            self.repo.insert_run(run_id, definition_hash, inputs, now)
            run = self.repo.get_run(run_id)
            definition = self.definition_for(run)
            self.repo.append_transition(run_id, None, None, None, "start",
                                        definition.start, f"pinned {definition_hash}", now)
            return self._enter(run, definition, definition.start, None, now)

    # -- events --------------------------------------------------------------
    def apply_event(self, event: TaskEvent) -> EventResult:
        now = self.clock()
        with self.repo.transaction():
            if self.repo.has_receipt(event.event_id):
                return self._duplicate(event)
            try:
                attempt = self.repo.get_attempt(event.attempt_id)
            except RepositoryError as exc:
                raise CorrelationError(event.attempt_id) from exc
            if attempt["task_id"] is None or attempt["task_id"] != event.task_id:
                raise CorrelationError(event.attempt_id, event.task_id)
            run = self.repo.get_run(attempt["run_id"])
            if attempt["status"] != "submitted":
                self.repo.insert_receipt(event.event_id, event.attempt_id,
                                         event.task_id, event.outcome.value,
                                         "duplicate", now)
                return EventResult("duplicate", run["status"])
            self.repo.insert_receipt(event.event_id, event.attempt_id, event.task_id,
                                     event.outcome.value, "applied", now)
            return self._resolve(run, attempt, event.outcome, event.evidence,
                                 event.reason, event.event_id, now)

    def _duplicate(self, event: TaskEvent) -> EventResult:
        attempt = self.repo.get_attempt(event.attempt_id)
        run = self.repo.get_run(attempt["run_id"])
        return EventResult("duplicate", run["status"])

    def _resolve(self, run: dict[str, Any], attempt: dict[str, Any],
                 outcome: Outcome, evidence: Mapping[str, Any], reason: str,
                 event_id: str | None, now: float) -> EventResult:
        definition = self.definition_for(run)
        node = definition.node(attempt["node"])
        if outcome is Outcome.SUCCESS:
            problem = self._verify(run, definition, node, evidence)
            if problem:
                outcome, reason = Outcome.FAILURE, f"evidence rejected: {problem}"
        self.repo.update_attempt(
            attempt["attempt_id"], status=ATTEMPT_STATUS[outcome],
            evidence_json=json.dumps(dict(evidence), sort_keys=True),
            producer=evidence.get("producer"), reason=reason, finished_at=now)
        if outcome is Outcome.SUCCESS and "source_sha" in node.required_fields \
                and not node.binds_source:
            self.repo.update_run(run["run_id"], now, source_sha=evidence["source_sha"])
        run = self.repo.get_run(run["run_id"])
        if run["status"] == "cancelling":
            return self._finish_cancel(run, attempt, now, f"{outcome.value} during cancel")
        target = definition.target(node.name, outcome)
        self.repo.append_transition(run["run_id"], attempt["attempt_id"], event_id,
                                    node.name, outcome.value, target, reason, now)
        next_attempt = self._route(run, definition, attempt, outcome, target, now)
        return EventResult("applied", self.repo.get_run(run["run_id"])["status"],
                           target, next_attempt)

    # -- evidence ------------------------------------------------------------
    def _verify(self, run: Mapping[str, Any], definition: WorkflowDefinition,
                node: NodeDefinition, evidence: Mapping[str, Any]) -> str:
        artifacts = evidence.get("artifacts")
        if not isinstance(artifacts, Mapping):
            artifacts = {}
        for name in node.expected_artifacts:
            if not DIGEST_RE.match(str(artifacts.get(name, ""))):
                return f"missing or malformed artifact digest {name}"
        for name in node.required_fields:
            if evidence.get(name) in (None, ""):
                return f"missing field {name}"
        if node.binds_source:
            if not run["source_sha"] or evidence.get("source_sha") != run["source_sha"]:
                return (f"source_sha {evidence.get('source_sha')!r} != run "
                        f"{run['source_sha']!r} (stale or foreign input)")
        producer = evidence.get("producer")
        for ref in node.independent_of:
            prior = self.repo.latest_success(run["run_id"], ref)
            if prior is None:
                return f"no current {ref} evidence to be independent of"
            if prior["producer"] == producer:
                return f"producer {producer!r} also produced {ref}"
        for binding in node.digest_bindings:
            prior = self.repo.latest_success(run["run_id"], binding.node)
            if prior is None:
                return f"no current {binding.node} evidence"
            built = json.loads(prior["evidence_json"])["artifacts"][binding.artifact]
            if evidence.get(binding.evidence_key) != built:
                return (f"{binding.evidence_key} {evidence.get(binding.evidence_key)!r}"
                        f" != {binding.node}.{binding.artifact} {built!r}")
        if node.requires_approval:
            gate = self._approved_gate(run, definition, node)
            if gate is None:
                return "no current approval for this artifact"
        return ""

    def _bound_digest(self, run: Mapping[str, Any], node: NodeDefinition) -> str:
        for binding in node.digest_bindings:
            prior = self.repo.latest_success(run["run_id"], binding.node)
            if prior is None:
                return ""
            return json.loads(prior["evidence_json"])["artifacts"][binding.artifact]
        return ""

    def _approved_gate(self, run: Mapping[str, Any], definition: WorkflowDefinition,
                       node: NodeDefinition) -> dict[str, Any] | None:
        digest = self._bound_digest(run, node)
        for gate in reversed(self.repo.gates(run["run_id"])):
            if gate["node"] == node.name and gate["status"] == "approved" \
                    and gate["evidence_digest"] == digest:
                return gate
        return None

    # -- routing -------------------------------------------------------------
    def _route(self, run: dict[str, Any], definition: WorkflowDefinition,
               attempt: dict[str, Any], outcome: Outcome, target: str,
               now: float) -> str | None:
        node = definition.node(attempt["node"])
        run_id = run["run_id"]
        if target == Target.COMPLETED.value:
            self.repo.update_run(run_id, now, status="completed", current_node=None,
                                 status_reason="all release steps evidenced")
            return None
        if target == Target.CANCELLED.value:
            self.repo.update_run(run_id, now, status="cancelled",
                                 status_reason=f"{node.name} cancelled in Bridge")
            return None
        if target == Target.BLOCKED.value:
            self._block(run_id, f"{node.name}: {outcome.value} routes to blocked", now)
            return None
        if target == Target.INSPECT.value:
            self.repo.update_run(run_id, now, status="inspecting",
                                 status_reason=f"{node.name} {outcome.value}: inspecting "
                                               "preserved state before recovery")
            self.repo.insert_intent(run_id, attempt["attempt_id"], "inspect", now)
            return None
        if target == Target.RETRY.value:
            return self._retry(run, node, attempt, now, f"after {outcome.value}")
        if target == Target.QUOTA_WAIT.value:
            used = self._count(run_id, node.name, attempt["iteration"], ("quota",))
            backoff = self.policy.quota_backoff_seconds
            if used > len(backoff):
                self._block(run_id, f"{node.name}: quota still exhausted after "
                                    f"{len(backoff)} rechecks", now)
                return None
            self.repo.update_run(run_id, now, status="quota_wait",
                                 due_at=now + backoff[used - 1],
                                 status_reason=f"{node.name}: quota, recheck #{used}")
            return None
        if target == Target.APPROVAL.value:
            self._open_gate(run, node, attempt["iteration"], f"{attempt['attempt_id']}/gate",
                            f"{node.approval_scope or 'resume'}:{attempt['attempt_id']}",
                            now)
            return None
        return self._enter(run, definition, target, node.name, now)

    def _enter(self, run: dict[str, Any], definition: WorkflowDefinition,
               name: str, came_from: str | None, now: float) -> str | None:
        """Activate a node in a NEW iteration (success or feedback edge)."""
        node = definition.node(name)
        used = {a["iteration"] for a in self.repo.attempts(run["run_id"], name)}
        used |= {g["iteration"] for g in self.repo.gates(run["run_id"]) if g["node"] == name}
        iteration = max(used, default=0) + 1
        if iteration > node.max_iterations:
            self._block(run["run_id"], f"{name}: iteration limit {node.max_iterations} "
                                       f"exhausted (from {came_from})", now)
            return None
        if iteration > 1:
            self.repo.mark_stale(run["run_id"], definition.downstream(name) | {name})
        if node.requires_approval:
            digest = self._bound_digest(run, node)
            self._open_gate(run, node, iteration, f"{run['run_id']}/{name}/{iteration}/gate",
                            f"{node.approval_scope}:{digest}", now, digest)
            return None
        return self._new_attempt(run, node, iteration, now, "")

    def _new_attempt(self, run: Mapping[str, Any], node: NodeDefinition,
                     iteration: int, now: float, reason: str) -> str:
        attempt_no = len(self.repo.attempts(run["run_id"], node.name, iteration)) + 1
        attempt_id = f"{run['run_id']}/{node.name}/{iteration}/{attempt_no}"
        self.repo.insert_attempt(attempt_id, run["run_id"], node.name, iteration,
                                 attempt_no, "pending", now)
        if reason:
            self.repo.update_attempt(attempt_id, reason=reason)
        self.repo.insert_intent(run["run_id"], attempt_id, "submit", now)
        self.repo.update_run(run["run_id"], now, status="running",
                             current_node=node.name, due_at=None,
                             status_reason=f"{attempt_id} queued for Bridge")
        return attempt_id

    def _retry(self, run: Mapping[str, Any], node: NodeDefinition,
               attempt: Mapping[str, Any], now: float, why: str) -> str | None:
        if node.side_effecting:
            self._block(run["run_id"], f"{node.name}: side-effecting node is never "
                                       "retried automatically; reconcile and authorize", now)
            return None
        failures = self._count(run["run_id"], node.name, attempt["iteration"],
                               FAILURE_STATUSES)
        if failures >= node.max_attempts:
            self._block(run["run_id"], f"{node.name}: {failures}/{node.max_attempts} "
                                       f"attempts exhausted {why}", now)
            return None
        return self._new_attempt(run, node, attempt["iteration"], now,
                                 f"recovery {why} of {attempt['attempt_id']}")

    def _count(self, run_id: str, node: str, iteration: int,
               statuses: tuple[str, ...]) -> int:
        return sum(1 for a in self.repo.attempts(run_id, node, iteration)
                   if a["status"] in statuses)

    def _block(self, run_id: str, reason: str, now: float) -> None:
        self.repo.update_run(run_id, now, status="blocked", status_reason=reason,
                             due_at=None)
        self.repo.append_transition(run_id, None, None, None, "blocked",
                                    Target.BLOCKED.value, reason, now)

    def _open_gate(self, run: Mapping[str, Any], node: NodeDefinition, iteration: int,
                   gate_id: str, scope: str, now: float, digest: str = "") -> None:
        ttl = self.policy.approval_ttl_seconds
        self.repo.insert_gate(gate_id, run["run_id"], node.name, iteration, scope,
                              digest, None if ttl is None else now + ttl, now)
        self.repo.update_run(run["run_id"], now, status="waiting_approval",
                             current_node=node.name,
                             status_reason=f"waiting for approval {gate_id} ({scope})")
        self.repo.append_transition(run["run_id"], None, None, node.name,
                                    "approval_wait", Target.APPROVAL.value, scope, now)

    # -- approvals -----------------------------------------------------------
    def approve(self, gate_id: str, approver: str, scope: str) -> str:
        now = self.clock()
        expired = False
        with self.repo.transaction():
            gate = self.repo.get_gate(gate_id)
            run = self.repo.get_run(gate["run_id"])
            if gate["status"] != "pending" or run["status"] != "waiting_approval":
                raise ApprovalError(f"{gate_id} is {gate['status']}, run {run['status']}")
            if scope != gate["scope"]:
                raise ApprovalError(f"scope {scope!r} != gate scope {gate['scope']!r}")
            definition = self.definition_for(run)
            node = definition.node(gate["node"])
            if gate["evidence_digest"] != self._bound_digest(run, node) \
                    and node.requires_approval and gate["evidence_digest"]:
                raise ApprovalError("gate evidence is stale")
            if gate["expires_at"] is not None and now > gate["expires_at"]:
                expired = True
                self.repo.update_gate(gate_id, status="revoked", decided_at=now,
                                      approver=approver)
                self._block(run["run_id"], f"approval {gate_id} expired", now)
            else:
                self.repo.update_gate(gate_id, status="approved", approver=approver,
                                      decided_at=now)
                self.repo.append_transition(run["run_id"], None, None, node.name,
                                            "approved", node.name,
                                            f"{approver}: {scope}", now)
                attempt_id = self._new_attempt(run, node, gate["iteration"], now,
                                               f"approved by {approver}")
        if expired:
            raise ApprovalError(f"{gate_id} expired")
        return attempt_id

    def reject(self, gate_id: str, approver: str, reason: str) -> None:
        now = self.clock()
        with self.repo.transaction():
            gate = self.repo.get_gate(gate_id)
            if gate["status"] != "pending":
                raise ApprovalError(f"{gate_id} is {gate['status']}")
            self.repo.update_gate(gate_id, status="rejected", approver=approver,
                                  decided_at=now)
            self._block(gate["run_id"], f"approval {gate_id} rejected by "
                                        f"{approver}: {reason}", now)

    def revoke(self, gate_id: str, approver: str, reason: str) -> None:
        """Revoke a granted gate; any in-flight attempt is cancelled via Bridge."""
        now = self.clock()
        with self.repo.transaction():
            gate = self.repo.get_gate(gate_id)
            if gate["status"] not in ("pending", "approved"):
                raise ApprovalError(f"{gate_id} is {gate['status']}")
            self.repo.update_gate(gate_id, status="revoked", approver=approver,
                                  decided_at=now)
            active = self.repo.active_attempt(gate["run_id"])
            if active is not None and active["node"] == gate["node"]:
                self.repo.void_pending_intents(active["attempt_id"], "submit", now)
                self.repo.insert_intent(gate["run_id"], active["attempt_id"], "cancel", now)
            self._block(gate["run_id"], f"approval {gate_id} revoked by "
                                        f"{approver}: {reason}", now)

    # -- cancel --------------------------------------------------------------
    def request_cancel(self, run_id: str, reason: str) -> None:
        now = self.clock()
        with self.repo.transaction():
            run = self.repo.get_run(run_id)
            if run["status"] in TERMINAL_RUN_STATUSES or run["status"] == "cancelling":
                return
            active = self.repo.active_attempt(run_id)
            self.repo.append_transition(run_id, active and active["attempt_id"], None,
                                        run["current_node"], "cancel_requested",
                                        Target.CANCELLED.value, reason, now)
            for gate in self.repo.gates(run_id):
                if gate["status"] == "pending":
                    self.repo.update_gate(gate["gate_id"], status="revoked",
                                          decided_at=now)
            if active is None:
                self.repo.update_run(run_id, now, status="cancelled", due_at=None,
                                     status_reason=f"cancelled: {reason}")
                return
            # A pending submit may already have reached Bridge (lost ack):
            # the cancel intent reconciles by idempotency key first.
            self.repo.void_pending_intents(active["attempt_id"], "submit", now)
            self.repo.insert_intent(run_id, active["attempt_id"], "cancel", now)
            self.repo.update_run(run_id, now, status="cancelling",
                                 status_reason=f"cancel requested: {reason}")

    def record_cancel_result(self, intent_id: int, attempt_id: str,
                             status: BridgeTaskStatus | None) -> None:
        now = self.clock()
        with self.repo.transaction():
            self.repo.update_intent(intent_id, now, status="done")
            attempt = self.repo.get_attempt(attempt_id)
            run = self.repo.get_run(attempt["run_id"])
            if status is not None and attempt["task_id"] is None:
                self.repo.update_attempt(attempt_id, task_id=status.task_id)
            if attempt["status"] in ("pending", "submitted"):
                observed = outcome_from_status(status) if status else Outcome.CANCEL
                self.repo.update_attempt(
                    attempt_id, status=ATTEMPT_STATUS[observed or Outcome.CANCEL],
                    reason=f"bridge observed {status.state if status else 'no task'}",
                    finished_at=now)
            if run["status"] == "cancelling":
                self._finish_cancel(run, attempt, now, "Bridge cancellation recorded")
            else:
                self.repo.append_transition(run["run_id"], attempt_id, None,
                                            attempt["node"], "cancel",
                                            run["status"], "Bridge cancellation recorded",
                                            now)

    def _finish_cancel(self, run: Mapping[str, Any], attempt: Mapping[str, Any],
                       now: float, reason: str) -> EventResult:
        self.repo.void_pending_intents(attempt["attempt_id"], "cancel", now)
        self.repo.update_run(run["run_id"], now, status="cancelled", due_at=None,
                             status_reason=reason)
        self.repo.append_transition(run["run_id"], attempt["attempt_id"], None,
                                    attempt["node"], "cancel", Target.CANCELLED.value,
                                    reason, now)
        return EventResult("applied", "cancelled", Target.CANCELLED.value)

    # -- coordinator hooks -----------------------------------------------------
    def submit_request(self, attempt_id: str) -> SubmitRequest:
        attempt = self.repo.get_attempt(attempt_id)
        run = self.repo.get_run(attempt["run_id"])
        node = self.definition_for(run).node(attempt["node"])
        inputs = json.loads(run["inputs_json"])
        context = {"run_goal": inputs.get("goal", ""), "source_sha": run["source_sha"],
                   "definition_hash": run["definition_hash"],
                   "inputs": {b.evidence_key: self._bound_digest(run, node)
                              for b in node.digest_bindings},
                   "recovery": attempt["reason"]}
        return SubmitRequest(
            idempotency_key=attempt["idempotency_key"],
            title=f"[{run['run_id']}] {node.name} "
                  f"#{attempt['iteration']}.{attempt['attempt_no']}",
            goal=f"{node.goal}\n\nWorkflow context: {json.dumps(context, sort_keys=True)}",
            repo=inputs.get("repo", ""), working_dir=inputs.get("working_dir"),
            executor=node.allowed_executors[0], model=node.allowed_models[0],
            timeout_seconds=node.timeout_seconds,
            acceptance_criteria=node.completion_criteria,
            constraints=(f"role: {node.role}",
                         f"expected artifacts: {', '.join(node.expected_artifacts)}"))

    def record_submission(self, intent_id: int, attempt_id: str, task_id: str) -> None:
        now = self.clock()
        with self.repo.transaction():
            attempt = self.repo.get_attempt(attempt_id)
            if attempt["task_id"] not in (None, task_id):
                raise CorrelationError(attempt_id, task_id)
            run = self.repo.get_run(attempt["run_id"])
            node = self.definition_for(run).node(attempt["node"])
            self.repo.update_intent(intent_id, now, status="done")
            if attempt["status"] == "pending":
                self.repo.update_attempt(attempt_id, task_id=task_id, status="submitted",
                                         submitted_at=now,
                                         deadline_at=now + node.timeout_seconds)

    def intent_transport_failed(self, intent_id: int, attempt_id: str, error: str) -> None:
        now = self.clock()
        with self.repo.transaction():
            intent = next(i for i in self.repo.intents(self.repo.get_attempt(
                attempt_id)["run_id"]) if i["intent_id"] == intent_id)
            tries = intent["tries"] + 1
            backoff = self.policy.transport_backoff_seconds
            if tries <= len(backoff):
                self.repo.update_intent(intent_id, now, tries=tries, last_error=error,
                                        due_at=now + backoff[tries - 1])
                return
            self.repo.update_intent(intent_id, now, tries=tries, last_error=error,
                                    status="void")
            attempt = self.repo.get_attempt(attempt_id)
            if attempt["status"] == "pending":
                self.repo.update_attempt(attempt_id, status="failed", finished_at=now,
                                         reason=f"{intent['kind']} unreconciled: {error}")
            self._block(attempt["run_id"], f"Bridge {intent['kind']} for {attempt_id} "
                                           f"unreconciled after {tries} tries: {error}", now)

    def resolve_inspection(self, intent_id: int, attempt_id: str,
                           status: BridgeTaskStatus | None) -> EventResult:
        """Choose recovery for a timed-out attempt from preserved Bridge state."""
        now = self.clock()
        with self.repo.transaction():
            self.repo.update_intent(intent_id, now, status="done")
            attempt = self.repo.get_attempt(attempt_id)
            run = self.repo.get_run(attempt["run_id"])
            if run["status"] != "inspecting" or attempt["status"] != "timed_out":
                return EventResult("duplicate", run["status"])
            definition = self.definition_for(run)
            node = definition.node(attempt["node"])
            observed = status.state if status else "missing"
            preserved = status.git_sha if status else None
            note = f"inspection: bridge {observed}, preserved sha {preserved}"
            if status is not None and outcome_from_status(status) is Outcome.SUCCESS \
                    and not self._verify(run, definition, node, status.evidence):
                self.repo.update_attempt(attempt_id, status="submitted")
                return self._resolve(run, attempt, Outcome.SUCCESS, status.evidence,
                                     f"{note}: completed work verified", None, now)
            self.repo.update_attempt(attempt_id, reason=note)
            self.repo.append_transition(run["run_id"], attempt_id, None, node.name,
                                        "inspected", Target.RETRY.value, note, now)
            next_attempt = self._retry(run, node, attempt, now, f"timeout ({note})")
            return EventResult("applied", self.repo.get_run(run["run_id"])["status"],
                               Target.RETRY.value, next_attempt)

    def resume_due(self) -> list[str]:
        """Start a fresh attempt for quota-blocked runs whose due time passed."""
        now = self.clock()
        started: list[str] = []
        for run in self.repo.runs_with_status("quota_wait"):
            if run["due_at"] is None or run["due_at"] > now:
                continue
            with self.repo.transaction():
                run = self.repo.get_run(run["run_id"])
                if run["status"] != "quota_wait":
                    continue
                definition = self.definition_for(run)
                last = self.repo.attempts(run["run_id"], run["current_node"])[-1]
                node = definition.node(last["node"])
                self.repo.append_transition(run["run_id"], last["attempt_id"], None,
                                            node.name, "quota_due", node.name,
                                            "backoff elapsed", now)
                started.append(self._new_attempt(run, node, last["iteration"], now,
                                                 f"quota recheck after {last['attempt_id']}"))
        return started

    def block_run(self, run_id: str, reason: str) -> None:
        now = self.clock()
        with self.repo.transaction():
            self._block(run_id, reason, now)
