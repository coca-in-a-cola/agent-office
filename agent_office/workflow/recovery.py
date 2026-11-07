"""Runtime recovery module for the AO node-editor workflow Core.

Implements and documents the recovery properties required by AO-NODE-EDITOR-SPEC-v1
acceptance criteria A4-A8 and A14.  This module does NOT replace the engine or
coordinator; it documents the invariants each component upholds and provides
helpers that tests (and the supervisor) can use to introspect recovery state.

Design goals (spec sections 7, 11; review B3, B8):
- Persist execution state atomically before any external call (outbox pattern).
- Detect crashed/interrupted runs by inspecting persisted intents on restart.
- Resume or block safely: a run never advances past a timed-out attempt until
  the writer-stop barrier confirms the old executor has stopped.
- No budget reset on restart; absolute due_at timestamps survive process exits.
- Duplicate events are receipted and silently discarded; a run never spawns
  two successors for the same attempt.
"""
from __future__ import annotations

import dataclasses
from typing import Any, Mapping

from .storage import WorkflowRepository


# ---------------------------------------------------------------------------
# Recovery state summary
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True, slots=True)
class RunRecoveryState:
    """Snapshot of one run's durable recovery bookmarks.

    Fields are read-only projections from persisted tables; they do not
    dictate engine decisions but do expose the properties that acceptance
    criteria require to be verifiable.
    """
    run_id: str
    run_status: str
    # Last stable node that completed successfully (None on first attempt).
    last_completed_node: str | None
    # Attempt that produced the latest timed-out / failed / cancelled status,
    # if any.  This is what InspectResult reads.
    interrupted_attempt_id: str | None
    interrupted_attempt_status: str | None
    # Was the writer-stop barrier confirmed for the interrupted attempt?
    writer_stop_confirmed: bool
    # How many route-tries have been consumed on the current iteration of the
    # current node?  Used to enforce spec §8 budget tracking.
    route_tries_this_iteration: int
    # Absolute restart-safe deadlines.
    execution_deadline_at: float | None
    # Is there a durable submit intent still pending?  True means the outbox
    # has an un-acknowledged submit that the coordinator will reconcile next
    # tick.
    pending_submit_intent: bool
    # Was the last recovery path triggered by a timeout (spec A4) or a
    # failure (spec A5)?
    timeout_triggered: bool


def snapshot_recovery_state(repo: WorkflowRepository, run_id: str) -> RunRecoveryState:
    """Return a consistent, read-only view of a run's recovery state.

    Safe to call from any context; does not start a transaction.
    """
    run = repo.get_run(run_id)
    attempts_all = repo.attempts(run_id)

    # Find last successfully completed node
    last_completed: str | None = None
    for a in reversed(attempts_all):
        if a["status"] == "succeeded":
            last_completed = a["node"]
            break

    # Find the most recent interrupted attempt (timed_out, failed, cancelled)
    interrupted: Mapping[str, Any] | None = None
    for a in reversed(attempts_all):
        if a["status"] in ("timed_out", "failed", "cancelled"):
            interrupted = a
            break

    writer_stop = False
    if interrupted is not None:
        row = repo.db.execute(
            "SELECT stop_status FROM writer_stop_barriers WHERE attempt_id=?",
            (interrupted["attempt_id"],),
        ).fetchone()
        if row is not None and row["stop_status"] == "stopped":
            writer_stop = True

    # Count route tries on the current iteration of the current node
    current_node = run.get("current_node")
    route_tries = 0
    if current_node is not None:
        # Count all non-pending attempts on the latest iteration
        node_attempts = repo.attempts(run_id, current_node)
        if node_attempts:
            latest_iter = node_attempts[-1]["iteration"]
            route_tries = sum(
                1 for a in node_attempts
                if a["iteration"] == latest_iter and a["status"] not in ("pending",)
            )

    # Pending submit intent
    pending_intent = False
    for intent in repo.intents(run_id):
        if intent["kind"] == "submit" and intent["status"] == "pending":
            pending_intent = True
            break

    # Execution deadline from active or last submitted attempt
    deadline_at: float | None = None
    for a in reversed(attempts_all):
        if a.get("deadline_at") is not None:
            deadline_at = a["deadline_at"]
            break

    timeout_triggered = interrupted is not None and interrupted["status"] == "timed_out"

    return RunRecoveryState(
        run_id=run_id,
        run_status=run["status"],
        last_completed_node=last_completed,
        interrupted_attempt_id=interrupted["attempt_id"] if interrupted else None,
        interrupted_attempt_status=interrupted["status"] if interrupted else None,
        writer_stop_confirmed=writer_stop,
        route_tries_this_iteration=route_tries,
        execution_deadline_at=deadline_at,
        pending_submit_intent=pending_intent,
        timeout_triggered=timeout_triggered,
    )


# ---------------------------------------------------------------------------
# Budget tracking helpers (spec §7, review B3)
# ---------------------------------------------------------------------------

def budgets_survived_restart(repo: WorkflowRepository, run_id: str) -> bool:
    """Return True if no budget counter was reset to zero after the last restart.

    A reset would manifest as an attempt with an attempt_no that starts over
    at 1 on a *new iteration* of the same node where previous iterations
    already consumed the full budget.  This helper checks that the per-node
    max_attempts is not silently renewed by a restart.

    Concretely: if attempt_no resets to 1 and the previous iteration already
    reached the node's max_attempts, that is a budget violation.
    """
    # We cannot access the definition from here without the engine, so we
    # apply a weaker but still useful check: across all attempts on the same
    # (run, node), the attempt_no never jumps backward across a restart.
    # The coordinator only creates new attempts within the engine's
    # transaction, so attempt_id sequence is monotone if budgets hold.
    attempts_by_node: dict[str, list[Mapping[str, Any]]] = {}
    for a in repo.attempts(run_id):
        attempts_by_node.setdefault(a["node"], []).append(a)

    for node, ats in attempts_by_node.items():
        # attempt_no must be strictly monotone across iterations when sorted
        # by creation time (approximated by attempt_id lexicographic order).
        sorted_ats = sorted(ats, key=lambda x: x["attempt_id"])
        prev_no = 0
        for a in sorted_ats:
            # attempt_no can restart at 1 only on a new *iteration*; within
            # the same iteration it must increase.
            if a["iteration"] == sorted_ats[0]["iteration"] or \
                    all(x["iteration"] == a["iteration"] for x in sorted_ats):
                if a["attempt_no"] < prev_no:
                    return False  # attempt_no went backward - budget reset
            prev_no = max(prev_no, a["attempt_no"])
    return True


# ---------------------------------------------------------------------------
# Restart idempotency check (spec §11, A6, A14)
# ---------------------------------------------------------------------------

def count_bridge_tasks_for_run(repo: WorkflowRepository, run_id: str) -> int:
    """Count distinct Bridge task IDs recorded for this run.

    After any number of coordinator restarts there must be exactly one Bridge
    task per attempt; never two tasks for the same (node, iteration, attempt_no).
    """
    task_ids: set[str] = set()
    for a in repo.attempts(run_id):
        if a.get("task_id"):
            task_ids.add(a["task_id"])
    return len(task_ids)


def duplicate_submissions_detected(repo: WorkflowRepository, run_id: str) -> bool:
    """Return True if any (node, iteration, attempt_no) tuple has >1 Bridge task.

    This indicates a recovery bug: the idempotency boundary was breached and
    two separate tasks were submitted to Bridge for the same attempt.
    """
    seen: dict[tuple[str, int, int], str] = {}
    for a in repo.attempts(run_id):
        tid = a.get("task_id")
        if not tid:
            continue
        key = (a["node"], a["iteration"], a["attempt_no"])
        if key in seen and seen[key] != tid:
            return True
        seen[key] = tid
    return False
