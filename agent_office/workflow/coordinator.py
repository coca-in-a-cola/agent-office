"""Headless, browser-independent coordinator loop for Workflow Core.

Each tick: resume due quota backoffs, execute due command intents against
the Bridge port, then poll submitted attempts for terminal Bridge state or
an expired workflow deadline. All decisions are delegated to the engine,
which persists them transactionally; a crash at any point is recovered by
the next tick (possibly in a new process) from the persisted intents.

Single-coordinator-per-database is assumed (single-host milestone); no
multi-coordinator lease/fencing is implemented.
"""

from __future__ import annotations

from dataclasses import dataclass
import threading
from typing import Any, Mapping

from .activation import ActivationBoundary
from .bridge_port import QUEUED, BridgePort, BridgeTransportError
from .definitions import Outcome
from .engine import TaskEvent, WorkflowEngine, event_from_status


@dataclass
class TickReport:
    resumed: int = 0
    submitted: int = 0
    cancelled: int = 0
    inspected: int = 0
    events: int = 0
    transport_errors: int = 0


class Coordinator:
    def __init__(self, engine: WorkflowEngine, bridge: BridgePort,
                 boundary: ActivationBoundary | None = None) -> None:
        self.engine = engine
        self.repo = engine.repo
        self.bridge = bridge
        self.boundary = boundary or ActivationBoundary(
            self.repo, self.engine, self.bridge, clock=self.engine.clock
        )

    def run_once(self) -> TickReport:
        # Paused runs do not advance: no new submissions, quota rechecks or
        # outcome polling (deadlines resume with the run). Operator cancel
        # intents still reach Bridge so pause never blocks a stop.
        paused = self.repo.paused_run_ids()
        report = TickReport(resumed=len(self.engine.resume_due(skip=paused)))
        for intent in self.repo.due_intents(self.engine.clock()):
            if intent["run_id"] in paused and intent["kind"] != "cancel":
                continue
            self._execute(intent, report)
        for attempt in self.repo.submitted_attempts():
            if attempt["run_id"] in paused:
                continue
            self._poll(attempt, report)
        return report

    def run_until_idle(self, max_ticks: int = 20) -> list[TickReport]:
        """Tick until nothing is due right now (tests / one-shot supervisor)."""
        reports = []
        for _ in range(max_ticks):
            report = self.run_once()
            reports.append(report)
            if not any((report.resumed, report.submitted, report.cancelled,
                        report.inspected, report.events)):
                break
        return reports

    def run_forever(self, stop: threading.Event, interval: float = 5.0) -> None:
        """Supervisor entry point; progress never depends on a browser/HTTP request."""
        while not stop.is_set():
            self.run_once()
            stop.wait(interval)

    # -- intents -------------------------------------------------------------
    def _execute(self, intent: Mapping[str, Any], report: TickReport) -> None:
        attempt = self.repo.get_attempt(intent["attempt_id"])
        kind = intent["kind"]
        try:
            if kind == "submit":
                self._submit(intent, attempt, report)
            elif kind == "cancel":
                self._cancel(intent, attempt, report)
            elif kind == "inspect":
                self._inspect(intent, attempt, report)
        except BridgeTransportError as exc:
            report.transport_errors += 1
            self.engine.intent_transport_failed(intent["intent_id"],
                                                attempt["attempt_id"], str(exc))

    def _submit(self, intent: Mapping[str, Any], attempt: Mapping[str, Any],
                report: TickReport) -> None:
        receipt = self.boundary.record_activation(
            attempt["run_id"],
            attempt["node"],
            iteration=attempt["iteration"],
            attempt_no=attempt["attempt_no"],
        )
        task_id = self.boundary.submit_or_reconcile(receipt.activation_id)
        self.engine.record_submission(intent["intent_id"], attempt["attempt_id"], task_id)
        report.submitted += 1

    def _cancel(self, intent: Mapping[str, Any], attempt: Mapping[str, Any],
                report: TickReport) -> None:
        task_id = attempt["task_id"]
        if task_id is None:
            existing = self.bridge.reconcile_task(attempt["idempotency_key"])
            task_id = existing.task_id if existing else None
        status = None
        if task_id is not None:
            self.bridge.cancel_task(task_id, "workflow cancel requested")
            status = self.bridge.get_task_status(task_id)
            if status is not None and not status.terminal:
                raise BridgeTransportError(f"cancel of {task_id} not yet observed")
        self.engine.record_cancel_result(intent["intent_id"], attempt["attempt_id"], status)
        report.cancelled += 1

    def _inspect(self, intent: Mapping[str, Any], attempt: Mapping[str, Any],
                 report: TickReport) -> None:
        observation = self.boundary.enforce_writer_stop_barrier(attempt)
        if not observation.stopped:
            block_reason = (
                f"reconciliation_required: executor stop unconfirmed for attempt "
                f"{attempt['attempt_id']} ({observation.reason})"
            )
            self.engine.block_run(attempt["run_id"], block_reason)
            with self.repo.transaction():
                self.repo.update_intent(intent["intent_id"], self.engine.clock(), status="void")
                self.repo.update_attempt(
                    attempt["attempt_id"],
                    reason=f"barrier blocked: {observation.reason}",
                )
            return

        self.engine.resolve_inspection(intent["intent_id"], attempt["attempt_id"], observation.status)
        report.inspected += 1

    # -- polling ---------------------------------------------------------------
    def _poll(self, attempt: Mapping[str, Any], report: TickReport) -> None:
        try:
            status = self.bridge.get_task_status(attempt["task_id"])
        except BridgeTransportError:
            report.transport_errors += 1
            return
        if status is None:
            event = TaskEvent(f"bridge:{attempt['task_id']}:missing",
                              attempt["attempt_id"], attempt["task_id"],
                              Outcome.FAILURE, reason="task missing in Bridge")
        else:
            event = event_from_status(attempt, status)
        # Queue wait belongs to Bridge admission, not to the executor budget:
        # never time out (and resubmit) a task Bridge has not started yet.
        started = status is not None and status.state != QUEUED
        if event is None and started and attempt["deadline_at"] is not None \
                and self.engine.clock() > attempt["deadline_at"]:
            event = TaskEvent(f"deadline:{attempt['attempt_id']}", attempt["attempt_id"],
                              attempt["task_id"], Outcome.TIMEOUT,
                              reason="workflow deadline exceeded")
        if event is not None:
            self.engine.apply_event(event)
            report.events += 1
