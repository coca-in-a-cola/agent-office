"""AO-GRAPH-02 Workflow Core tests: definitions, repository, reducer, faults.

All databases live in unique TemporaryDirectory paths; no live Bridge, Office
or Hermes state is read or written.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest import mock

from agent_office.workflow import bridge_port as bp
from agent_office.workflow.bridge_port import FakeBridge
from agent_office.workflow.coordinator import Coordinator
from agent_office.workflow.definitions import (
    DefinitionError, NodeDefinition, Outcome, Target, Transition,
    WorkflowDefinition,
)
from agent_office.workflow.engine import (
    ApprovalError, CorrelationError, Policy, TaskEvent, WorkflowEngine,
)
from agent_office.workflow.storage import RepositoryError, WorkflowRepository
from agent_office.workflow.release_workflow import (
    RELEASE_STEPS, build_release_workflow,
)


def _node(name: str, **kw) -> NodeDefinition:
    return NodeDefinition(name=name, role=f"{name}-role",
                          allowed_executors=("claude",),
                          allowed_models=("claude-opus-5-5",),
                          goal=f"do {name}", **kw)


def _edges(source: str, success: str) -> tuple[Transition, ...]:
    targets = {o: Target.BLOCKED.value for o in Outcome}
    targets[Outcome.SUCCESS] = success
    return tuple(Transition(source, o, t) for o, t in targets.items())


class DefinitionTests(unittest.TestCase):
    def test_hash_is_deterministic_and_order_independent(self) -> None:
        first = build_release_workflow()
        shuffled = WorkflowDefinition(
            name=first.name, version=first.version, start=first.start,
            nodes=tuple(reversed(first.nodes)),
            transitions=tuple(reversed(first.transitions)))
        self.assertEqual(first.definition_hash, build_release_workflow().definition_hash)
        self.assertEqual(first.definition_hash, shuffled.definition_hash)
        self.assertRegex(first.definition_hash, r"^sha256:[0-9a-f]{64}$")

    def test_hash_changes_with_version_role_or_transition(self) -> None:
        base = build_release_workflow()
        self.assertNotEqual(base.definition_hash, build_release_workflow(2).definition_hash)
        nodes = tuple(dataclasses.replace(n, role="someone-else")
                      if n.name == "acceptance" else n for n in base.nodes)
        renamed = dataclasses.replace(base, nodes=nodes)
        self.assertNotEqual(base.definition_hash, renamed.definition_hash)
        edges = tuple(dataclasses.replace(t, target=Target.BLOCKED.value)
                      if (t.source, t.outcome) == ("build", Outcome.DEFECT) else t
                      for t in base.transitions)
        self.assertNotEqual(base.definition_hash,
                            dataclasses.replace(base, transitions=edges).definition_hash)

    def test_canonical_round_trip_preserves_hash(self) -> None:
        base = build_release_workflow()
        again = WorkflowDefinition.from_canonical_json(base.canonical_json())
        self.assertEqual(base.definition_hash, again.definition_hash)
        self.assertEqual(again.node("publication").approval_scope, "publish")

    def test_definitions_are_immutable(self) -> None:
        base = build_release_workflow()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            base.version = 9  # type: ignore[misc]
        with self.assertRaises(dataclasses.FrozenInstanceError):
            base.nodes[0].timeout_seconds = 1  # type: ignore[misc]

    def test_release_workflow_has_six_ordered_steps(self) -> None:
        wf = build_release_workflow()
        path, node = [], wf.start
        while node in RELEASE_STEPS:
            path.append(node)
            node = wf.target(node, Outcome.SUCCESS)
        self.assertEqual(tuple(path), RELEASE_STEPS)
        self.assertEqual(node, Target.COMPLETED.value)
        self.assertTrue(wf.node("publication").requires_approval)
        self.assertEqual(wf.target("publication", Outcome.FAILURE), Target.BLOCKED.value)
        self.assertEqual(wf.target("acceptance", Outcome.DEFECT), "implementation")
        self.assertEqual(wf.node("acceptance").independent_of, ("implementation",))

    def test_every_outcome_branch_must_be_explicit(self) -> None:
        partial = tuple(t for t in _edges("a", Target.COMPLETED.value)
                        if t.outcome is not Outcome.QUOTA)
        with self.assertRaisesRegex(DefinitionError, "quota"):
            WorkflowDefinition("x", 1, "a", (_node("a"),), partial)

    def test_invalid_graphs_fail_closed(self) -> None:
        ok = _edges("a", Target.COMPLETED.value)
        with self.assertRaises(DefinitionError):
            WorkflowDefinition("x", 1, "missing", (_node("a"),), ok)
        with self.assertRaises(DefinitionError):
            WorkflowDefinition("x", 1, "a", (_node("a"),), _edges("a", "ghost"))
        with self.assertRaises(DefinitionError):
            WorkflowDefinition("x", 1, "a", (_node("a"), _node("a")), ok)
        with self.assertRaises(DefinitionError):
            WorkflowDefinition("x", 1, "a", (_node("a"),), ok + ok[:1])
        with self.assertRaisesRegex(DefinitionError, "join"):
            WorkflowDefinition("x", 1, "a", (_node("a"), _node("b"), _node("c")),
                               _edges("a", "c") + _edges("b", "c")
                               + _edges("c", Target.COMPLETED.value))
        with self.assertRaises(DefinitionError):
            _node("a", max_attempts=3)
        with self.assertRaises(DefinitionError):
            _node("a", requires_approval=True)


class TempDirCase(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.db_path = self.root / "workflow.sqlite3"

    def open_repo(self) -> WorkflowRepository:
        repo = WorkflowRepository(self.db_path)
        self.addCleanup(repo.close)
        return repo


class RepositoryTests(TempDirCase):
    def setUp(self) -> None:
        super().setUp()
        self.repo = self.open_repo()
        self.wf = build_release_workflow()
        with self.repo.transaction():
            self.digest = self.repo.register_definition(self.wf, 1.0)
            self.repo.insert_run("r1", self.digest, {"goal": "g"}, 1.0)
            self.repo.insert_attempt("r1/implementation/1/1", "r1",
                                     "implementation", 1, 1, "pending", 1.0)

    def test_register_is_idempotent_but_version_reuse_fails_closed(self) -> None:
        with self.repo.transaction():
            self.assertEqual(self.repo.register_definition(self.wf, 2.0), self.digest)
        nodes = tuple(dataclasses.replace(n, goal="edited") for n in self.wf.nodes)
        edited = dataclasses.replace(self.wf, nodes=nodes)
        with self.assertRaises(sqlite3.IntegrityError):
            with self.repo.transaction():
                self.repo.register_definition(edited, 2.0)

    def test_definitions_rows_are_immutable(self) -> None:
        with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
            with self.repo.transaction():
                self.repo.db.execute("UPDATE workflow_definitions SET version=5")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
            with self.repo.transaction():
                self.repo.db.execute("DELETE FROM workflow_definitions")

    def test_run_version_pin_cannot_be_changed(self) -> None:
        with self.repo.transaction():
            other = self.repo.register_definition(build_release_workflow(2), 2.0)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "pinned"):
            with self.repo.transaction():
                self.repo.update_run("r1", 3.0, definition_hash=other)
        self.assertEqual(self.repo.get_run("r1")["definition_hash"], self.digest)

    def test_unknown_definition_run_fails(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            with self.repo.transaction():
                self.repo.insert_run("r2", "sha256:" + "0" * 64, {}, 1.0)

    def test_tampered_definition_fails_hash_check(self) -> None:
        self.repo.db.execute("DROP TRIGGER workflow_definitions_no_update")
        self.repo.db.execute(
            "UPDATE workflow_definitions SET canonical_json=replace("
            "canonical_json, 'independent_reviewer', 'implementer')")
        with self.assertRaises((RepositoryError, DefinitionError)):
            self.repo.load_definition(self.digest)

    def test_task_correlation_is_unique_and_immutable(self) -> None:
        with self.repo.transaction():
            self.repo.update_attempt("r1/implementation/1/1", task_id="t-1",
                                     status="submitted")
        self.assertEqual(self.repo.attempt_for_task("t-1")["attempt_id"],
                         "r1/implementation/1/1")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
            with self.repo.transaction():
                self.repo.update_attempt("r1/implementation/1/1", task_id="t-2")
        with self.repo.transaction():
            self.repo.insert_run("r2", self.digest, {}, 1.0)
            self.repo.insert_attempt("r2/implementation/1/1", "r2",
                                     "implementation", 1, 1, "pending", 1.0)
        with self.assertRaises(sqlite3.IntegrityError):
            with self.repo.transaction():
                self.repo.update_attempt("r2/implementation/1/1", task_id="t-1")

    def test_single_active_attempt_per_run(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            with self.repo.transaction():
                self.repo.insert_attempt("r1/implementation/1/2", "r1",
                                         "implementation", 1, 2, "pending", 2.0)

    def test_failure_rolls_back_whole_transaction(self) -> None:
        with self.assertRaises(RuntimeError):
            with self.repo.transaction():
                self.repo.update_run("r1", 5.0, status="blocked")
                self.repo.append_transition("r1", None, None, None, "failure",
                                            "@blocked", "x", 5.0)
                raise RuntimeError("crash mid-transition")
        self.assertEqual(self.repo.get_run("r1")["status"], "running")
        self.assertEqual(self.repo.transitions("r1"), [])

    def test_mutation_outside_transaction_and_nesting_fail(self) -> None:
        with self.assertRaises(RepositoryError):
            self.repo.update_run("r1", 2.0, status="blocked")
        with self.assertRaises(RepositoryError):
            with self.repo.transaction():
                with self.repo.transaction():
                    pass
        with self.assertRaises(sqlite3.IntegrityError):
            with self.repo.transaction():
                self.repo.update_run("r1", 2.0, status="not-a-status")

    def test_journal_is_append_only_and_survives_reopen(self) -> None:
        with self.repo.transaction():
            self.repo.append_transition("r1", None, None, None, "start",
                                        "implementation", "", 1.0)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "append-only"):
            with self.repo.transaction():
                self.repo.db.execute("DELETE FROM transitions")
        reopened = self.open_repo()
        self.assertEqual(len(reopened.transitions("r1")), 1)
        self.assertEqual(reopened.load_definition(self.digest).definition_hash,
                         self.digest)


# ---------------------------------------------------------------------------
# Engine / coordinator harness
# ---------------------------------------------------------------------------

def D(c: str) -> str:
    return "sha256:" + c * 64


SHA1, SHA2 = "1111111aaaa", "2222222bbbb"


def evidence(node: str, sha: str = SHA1, **over):
    base = {
        "implementation": {"artifacts": {"patch": D("1")}, "producer": "implementer-a"},
        "acceptance": {"artifacts": {"acceptance_report": D("2")},
                       "producer": "reviewer-b"},
        "build": {"artifacts": {"build_artifact": D("3")}, "producer": "builder-c",
                  "command": "bun run build", "exit_code": 0},
        "artifact_check": {"artifacts": {"artifact_check_report": D("4")},
                           "producer": "checker-d", "checked_digest": D("3")},
        "publication": {"artifacts": {"publication_receipt": D("5")},
                        "producer": "publisher-e", "destination": "sandbox-preview",
                        "published_digest": D("3"), "readback_digest": D("3")},
        "delivery": {"artifacts": {"delivery_receipt": D("6")}, "producer": "liaison-f",
                     "delivered_to": "owner", "acknowledged_by": "owner"},
    }[node]
    if node != "delivery":
        base["source_sha"] = sha
    base.update(over)
    return base


class Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class Harness:
    """One 'process': repo + engine + coordinator over persistent temp DBs."""

    def __init__(self, case: TempDirCase, clock: Clock, policy: Policy = Policy()) -> None:
        self.case, self.clock, self.policy = case, clock, policy
        self.repo = case.open_repo()
        self.engine = WorkflowEngine(self.repo, clock=clock, policy=policy)
        self.bridge = FakeBridge(case.root / "fake-bridge.sqlite3")
        self.coordinator = Coordinator(self.engine, self.bridge)

    def restart(self) -> "Harness":
        return Harness(self.case, self.clock, self.policy)

    def tick(self):
        return self.coordinator.run_until_idle()

    def active(self, run_id: str = "run-1"):
        return self.repo.active_attempt(run_id)

    def finish(self, run_id: str = "run-1", state: str = bp.SUCCEEDED,
               ev=None, error: str = "", sha: str = SHA1, tick: bool = True):
        attempt = self.active(run_id)
        assert attempt is not None and attempt["task_id"], attempt
        if ev is None and state == bp.SUCCEEDED:
            ev = evidence(attempt["node"], sha)
        self.bridge.set_state(attempt["task_id"], state, evidence=ev, error=error,
                              git_sha=sha)
        if tick:
            self.tick()
        return attempt

    def run(self, run_id: str = "run-1"):
        return self.repo.get_run(run_id)

    def gate(self, run_id: str = "run-1"):
        return [g for g in self.repo.gates(run_id) if g["status"] == "pending"][-1]

    def approve_publication(self, run_id: str = "run-1"):
        gate = self.gate(run_id)
        self.engine.approve(gate["gate_id"], "owner", gate["scope"])
        self.tick()


class EngineCase(TempDirCase):
    policy = Policy()

    def setUp(self) -> None:
        super().setUp()
        self.clock = Clock()
        self.h = Harness(self, self.clock, self.policy)
        self.v1 = self.h.engine.register(build_release_workflow(1))

    def start(self, run_id: str = "run-1") -> None:
        self.h.engine.start_run(run_id, self.v1, {"goal": "ship feature X",
                                                  "repo": "/tmp/sandbox-repo"})
        self.h.tick()

    def advance_to(self, node: str, run_id: str = "run-1") -> None:
        while self.h.active(run_id) is None or self.h.active(run_id)["node"] != node:
            if self.h.run(run_id)["status"] == "waiting_approval":
                self.h.approve_publication(run_id)
                continue
            self.h.finish(run_id)

    def nodes_submitted(self) -> list[str]:
        return [json.loads(t["request_json"])["title"].split()[1]
                for t in self.h.bridge.tasks()]


class HappyPathTests(EngineCase):
    def test_full_release_reaches_completed_with_one_task_per_step(self) -> None:
        self.start()
        self.assertEqual(self.h.active()["node"], "implementation")
        self.advance_to("publication")
        self.h.finish()
        self.h.finish()
        run = self.h.run()
        self.assertEqual(run["status"], "completed", run["status_reason"])
        self.assertEqual(self.nodes_submitted(), list(RELEASE_STEPS))
        self.assertEqual(self.h.repo.transitions("run-1")[-1]["target"], "@completed")
        self.assertEqual(run["source_sha"], SHA1)

    def test_submit_request_carries_pinned_context(self) -> None:
        self.start()
        request = json.loads(self.h.bridge.tasks()[0]["request_json"])
        self.assertEqual(request["executor"], "claude")
        self.assertEqual(request["model"], "claude-opus-5-5")
        self.assertIn(self.v1, request["goal"])
        key = self.h.active()["idempotency_key"]
        self.assertEqual(key, "agent-office-workflow:run-1/implementation/1/1")


class VersionPinningTests(EngineCase):
    def test_running_v1_ignores_v2_graph(self) -> None:
        self.start()
        base = build_release_workflow(2)
        shortcut = tuple(dataclasses.replace(t, target="build")
                         if (t.source, t.outcome) == ("implementation", Outcome.SUCCESS)
                         else t for t in base.transitions)
        # v2 skips acceptance (its success edge is dropped to avoid a join).
        shortcut = tuple(dataclasses.replace(t, target="@blocked")
                         if (t.source, t.outcome) == ("acceptance", Outcome.SUCCESS)
                         else t for t in shortcut)
        v2 = self.h.engine.register(dataclasses.replace(base, transitions=shortcut))
        self.assertNotEqual(v2, self.v1)
        restarted = self.h.restart()
        self.h = restarted
        self.h.finish()
        self.assertEqual(self.h.active()["node"], "acceptance")
        self.assertEqual(self.h.run()["definition_hash"], self.v1)
        self.h.engine.start_run("run-2", v2, {"goal": "v2"})
        self.h.tick()
        self.h.finish("run-2")
        self.assertEqual(self.h.active("run-2")["node"], "build")

    def test_unknown_definition_cannot_start(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.h.engine.start_run("run-x", "sha256:" + "f" * 64, {})
        with self.assertRaises(RepositoryError):
            self.h.repo.get_run("run-x")


class CorrelationAndDuplicateTests(EngineCase):
    def setUp(self) -> None:
        super().setUp()
        self.start()
        self.attempt = self.h.active()
        self.event = TaskEvent("evt-1", self.attempt["attempt_id"],
                               self.attempt["task_id"], Outcome.SUCCESS,
                               evidence("implementation"))

    def test_foreign_task_or_unknown_attempt_is_rejected_without_receipt(self) -> None:
        with self.assertRaises(CorrelationError):
            self.h.engine.apply_event(dataclasses.replace(self.event, task_id="fake-task-99"))
        with self.assertRaises(CorrelationError):
            self.h.engine.apply_event(dataclasses.replace(self.event, attempt_id="nope"))
        self.assertEqual(self.h.repo.receipts(self.attempt["attempt_id"]), [])
        self.assertEqual(self.h.active()["status"], "submitted")

    def test_same_event_id_and_same_attempt_are_idempotent(self) -> None:
        first = self.h.engine.apply_event(self.event)
        self.assertEqual(first.disposition, "applied")
        self.assertEqual(self.h.engine.apply_event(self.event).disposition, "duplicate")
        other = dataclasses.replace(self.event, event_id="evt-2", outcome=Outcome.FAILURE)
        self.assertEqual(self.h.engine.apply_event(other).disposition, "duplicate")
        self.h.tick()
        self.h.tick()
        self.assertEqual(self.nodes_submitted(), ["implementation", "acceptance"])
        receipts = self.h.repo.receipts(self.attempt["attempt_id"])
        self.assertEqual([r["disposition"] for r in receipts], ["applied", "duplicate"])
        self.assertEqual(self.h.repo.get_attempt(self.attempt["attempt_id"])["status"],
                         "succeeded")

    def test_bridge_poll_and_wake_event_for_same_completion_dedupe(self) -> None:
        self.h.engine.apply_event(self.event)       # wake/outbox delivery
        self.h.bridge.set_state(self.attempt["task_id"], bp.SUCCEEDED,
                                evidence=evidence("implementation"))
        for _ in range(3):
            self.h.restart().tick()                 # repeated polls after restarts
        self.assertEqual(self.nodes_submitted(), ["implementation", "acceptance"])


class DefectAndEvidenceTests(EngineCase):
    def setUp(self) -> None:
        super().setUp()
        self.start()

    def test_acceptance_defect_loops_once_then_blocks(self) -> None:
        self.advance_to("acceptance")
        self.h.finish(ev=dict(evidence("acceptance"), verdict="defect"))
        active = self.h.active()
        self.assertEqual((active["node"], active["iteration"]), ("implementation", 2))
        earlier = [a for a in self.h.repo.attempts("run-1")
                   if a["attempt_id"] != active["attempt_id"]]
        self.assertTrue(earlier and all(a["stale"] for a in earlier))
        self.h.finish(sha=SHA2)
        self.assertEqual(self.h.run()["source_sha"], SHA2)
        self.h.finish(ev=dict(evidence("acceptance", SHA2), verdict="defect"))
        run = self.h.run()
        self.assertEqual(run["status"], "blocked")
        self.assertIn("iteration limit", run["status_reason"])
        self.assertIsNone(self.h.active())
        self.assertEqual(len(self.h.bridge.tasks()), 4)

    def test_stale_source_sha_is_rejected_after_correction(self) -> None:
        self.advance_to("acceptance")
        self.h.finish(ev=dict(evidence("acceptance"), verdict="defect"))
        self.h.finish(sha=SHA2)
        old = self.h.finish(ev=evidence("acceptance", SHA1))  # stale input
        self.assertIn("stale or foreign input",
                      self.h.repo.get_attempt(old["attempt_id"])["reason"])
        retry = self.h.active()
        self.assertEqual((retry["node"], retry["attempt_no"]), ("acceptance", 2))
        self.h.finish(ev=evidence("acceptance", SHA2))
        self.assertEqual(self.h.active()["node"], "build")

    def test_acceptance_must_be_independent_of_implementation(self) -> None:
        self.advance_to("acceptance")
        self.h.finish(ev=evidence("acceptance", producer="implementer-a"))
        self.h.finish(ev=evidence("acceptance", producer="implementer-a"))
        run = self.h.run()
        self.assertEqual(run["status"], "blocked")
        self.assertIn("2/2 attempts exhausted", run["status_reason"])
        reasons = [a["reason"] for a in self.h.repo.attempts("run-1", "acceptance")]
        self.assertTrue(all("also produced implementation" in r for r in reasons))

    def test_mutated_artifact_never_reaches_publication(self) -> None:
        self.advance_to("artifact_check")
        self.h.finish(ev=evidence("artifact_check", checked_digest=D("9")))
        self.assertEqual(self.h.active()["node"], "artifact_check")
        self.h.finish(ev=evidence("artifact_check", checked_digest=D("9")))
        self.assertEqual(self.h.run()["status"], "blocked")
        self.assertNotIn("publication", self.nodes_submitted())
        self.assertEqual(self.h.repo.gates("run-1"), [])

    def test_artifact_check_defect_rebuilds_and_invalidates_check(self) -> None:
        self.advance_to("artifact_check")
        self.h.finish(ev=dict(evidence("artifact_check"), verdict="defect"))
        self.assertEqual(self.h.active()["node"], "build")
        self.assertEqual(self.h.active()["iteration"], 2)
        self.h.finish(ev=evidence("build", artifacts={"build_artifact": D("7")}))
        # The check must now bind the NEW digest; the old one is stale.
        self.h.finish(ev=evidence("artifact_check"))
        self.assertEqual(self.h.active()["node"], "artifact_check")
        self.h.finish(ev=evidence("artifact_check", checked_digest=D("7")))
        gate = self.h.gate()
        self.assertEqual(gate["scope"], f"publish:{D('7')}")

    def test_missing_artifact_digest_is_not_success(self) -> None:
        bad = evidence("implementation", artifacts={"patch": "done!"})
        self.h.finish(ev=bad)
        attempt = self.h.active()
        self.assertEqual((attempt["node"], attempt["attempt_no"]), ("implementation", 2))


class FailureRecoveryTests(EngineCase):
    def test_interrupted_executor_recovers_and_successor_starts_unattended(self) -> None:
        self.start()
        first = self.h.active()
        self.h.bridge.interrupt(first["task_id"])
        self.h = self.h.restart()                   # coordinator restart, no owner kick
        self.h.tick()
        retry = self.h.active()
        self.assertEqual(retry["attempt_no"], 2)
        self.assertIn("recovery after failure", retry["reason"])
        self.assertIsNotNone(retry["task_id"])
        self.h.finish()
        self.assertEqual(self.h.active()["node"], "acceptance")
        journal = [(t["from_node"], t["outcome"], t["target"])
                   for t in self.h.repo.transitions("run-1")]
        self.assertIn(("implementation", "failure", "@retry"), journal)

    def test_failure_exhaustion_blocks_only_that_run(self) -> None:
        self.start("run-1")
        self.start("run-2")
        self.h.finish("run-1", state=bp.FAILED, error="tests red")
        self.h.finish("run-1", state=bp.FAILED, error="tests red")
        self.assertEqual(self.h.run("run-1")["status"], "blocked")
        self.assertIn("attempts exhausted", self.h.run("run-1")["status_reason"])
        self.h.finish("run-2")
        self.assertEqual(self.h.active("run-2")["node"], "acceptance")
        self.assertEqual(self.h.run("run-2")["status"], "running")

    def test_publication_failure_is_never_retried(self) -> None:
        self.start()
        self.advance_to("publication")
        self.h.finish(state=bp.FAILED, error="upload 500")
        self.assertEqual(self.h.run()["status"], "blocked")
        self.assertEqual(self.nodes_submitted().count("publication"), 1)


class TimeoutTests(EngineCase):
    def setUp(self) -> None:
        super().setUp()
        self.start()

    def overdue(self) -> dict:
        attempt = self.h.active()
        self.h.bridge.set_state(attempt["task_id"], bp.RUNNING, git_sha="wip-sha")
        self.clock.advance(3601)
        return attempt

    def test_timeout_inspects_preserved_state_then_bounded_recovery(self) -> None:
        attempt = self.overdue()
        self.h.tick()
        stored = self.h.repo.get_attempt(attempt["attempt_id"])
        self.assertEqual(stored["status"], "timed_out")
        self.assertIn("preserved sha wip-sha", stored["reason"])
        self.assertEqual(self.h.bridge.calls("cancel"), [attempt["task_id"]])
        retry = self.h.active()
        self.assertEqual(retry["attempt_no"], 2)
        self.assertIn("wip-sha", retry["reason"])
        targets = [t["target"] for t in self.h.repo.transitions("run-1")]
        self.assertIn("@inspect", targets)
        self.overdue()
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "blocked")
        self.assertEqual(len(self.h.bridge.tasks()), 2)

    def test_inspection_finds_completed_work_and_advances_without_rerun(self) -> None:
        attempt = self.overdue()
        with mock.patch.object(Coordinator, "_execute"):   # stop before inspection
            self.h.tick()
        self.assertEqual(self.h.run()["status"], "inspecting")
        self.h.bridge.set_state(attempt["task_id"], bp.SUCCEEDED,
                                evidence=evidence("implementation"))
        self.h.tick()
        self.assertEqual(self.h.active()["node"], "acceptance")
        self.assertEqual(self.nodes_submitted(), ["implementation", "acceptance"])

    def test_publication_timeout_blocks_instead_of_republishing(self) -> None:
        self.advance_to("publication")
        self.overdue()
        self.h.tick()
        run = self.h.run()
        self.assertEqual(run["status"], "blocked")
        self.assertIn("never retried automatically", run["status_reason"])
        self.assertEqual(self.nodes_submitted().count("publication"), 1)

    def test_task_still_queued_in_bridge_admission_is_not_timed_out(self) -> None:
        attempt = self.h.active()
        self.clock.advance(7200)
        self.h.tick()
        self.assertEqual(self.h.repo.get_attempt(attempt["attempt_id"])["status"],
                         "submitted")
        self.assertEqual(self.h.bridge.calls("cancel"), [])

    def test_bridge_reported_timeout_routes_to_inspection(self) -> None:
        self.h.finish(state=bp.FAILED, error="Task timed out after 3600s")
        self.assertEqual(self.h.active()["attempt_no"], 2)
        self.assertIn("inspection", self.h.active()["reason"])


class CancelTests(EngineCase):
    def test_cancel_running_task_through_bridge(self) -> None:
        self.start()
        attempt = self.h.active()
        self.h.engine.request_cancel("run-1", "owner changed plan")
        self.assertEqual(self.h.run()["status"], "cancelling")
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "cancelled")
        self.assertEqual(self.h.bridge.calls("cancel"), [attempt["task_id"]])
        self.assertEqual(self.h.repo.get_attempt(attempt["attempt_id"])["status"],
                         "cancelled")
        self.h.tick()
        self.assertEqual(len(self.h.bridge.tasks()), 1)

    def test_cancel_before_submit_reconciles_and_creates_no_task(self) -> None:
        self.h.engine.start_run("run-1", self.v1, {"goal": "g"})
        self.h.engine.request_cancel("run-1", "never mind")
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "cancelled")
        self.assertEqual(self.h.bridge.tasks(), [])
        self.assertEqual(self.h.bridge.calls("submit"), [])

    def test_cancel_after_lost_submit_ack_cancels_the_accepted_task(self) -> None:
        self.h.engine.start_run("run-1", self.v1, {"goal": "g"})
        self.h.bridge.inject("submit_lost_ack")
        self.h.tick()
        self.h.engine.request_cancel("run-1", "abort")
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "cancelled")
        self.assertEqual(self.h.bridge.tasks()[0]["state"], bp.CANCELLED)

    def test_external_bridge_cancel_is_terminal_without_successor(self) -> None:
        self.start()
        self.h.finish(state=bp.CANCELLED, error="cancelled by operator")
        self.assertEqual(self.h.run()["status"], "cancelled")
        self.assertIsNone(self.h.active())
        self.assertEqual(len(self.h.bridge.tasks()), 1)

    def test_cancel_while_waiting_for_approval(self) -> None:
        self.start()
        self.advance_to("artifact_check")
        self.h.finish()
        self.h.engine.request_cancel("run-1", "stop release")
        self.assertEqual(self.h.run()["status"], "cancelled")
        self.assertEqual(self.h.repo.gates("run-1")[0]["status"], "revoked")


class QuotaTests(EngineCase):
    def test_quota_waits_for_due_time_then_blocks_after_bounded_rechecks(self) -> None:
        self.start()
        self.h.finish(state=bp.FAILED, error="provider quota exceeded (429)")
        run = self.h.run()
        self.assertEqual(run["status"], "quota_wait")
        self.assertEqual(run["due_at"], self.clock.now + 60)
        for _ in range(5):
            self.h.tick()
        self.assertEqual(len(self.h.bridge.tasks()), 1)   # no tight retry loop
        for backoff in (60, 300, 900):
            self.clock.advance(backoff)
            self.h.restart().tick()
            self.assertEqual(self.h.run()["status"], "running")
            self.h.finish(state=bp.FAILED, error="rate limit")
        self.assertEqual(self.h.run()["status"], "blocked")
        self.assertIn("quota still exhausted", self.h.run()["status_reason"])
        self.assertEqual(len(self.h.bridge.tasks()), 4)


class ApprovalTests(EngineCase):
    def setUp(self) -> None:
        super().setUp()
        self.start()
        self.advance_to("artifact_check")
        self.h.finish()

    def test_publication_is_not_submitted_until_scoped_approval(self) -> None:
        self.assertEqual(self.h.run()["status"], "waiting_approval")
        for _ in range(3):
            self.h.tick()
        self.assertNotIn("publication", self.nodes_submitted())
        gate = self.h.gate()
        self.assertEqual(gate["scope"], f"publish:{D('3')}")
        with self.assertRaises(ApprovalError):
            self.h.engine.approve(gate["gate_id"], "owner", f"publish:{D('9')}")
        self.assertNotIn("publication", self.nodes_submitted())
        self.h.engine.approve(gate["gate_id"], "owner", gate["scope"])
        self.h.tick()
        self.assertEqual(self.h.active()["node"], "publication")
        self.assertEqual(self.nodes_submitted().count("publication"), 1)
        with self.assertRaises(ApprovalError):
            self.h.engine.approve(gate["gate_id"], "owner", gate["scope"])

    def test_rejection_blocks_visibly(self) -> None:
        gate = self.h.gate()
        self.h.engine.reject(gate["gate_id"], "owner", "not this week")
        self.assertEqual(self.h.run()["status"], "blocked")
        self.assertIn("not this week", self.h.run()["status_reason"])

    def test_revocation_after_approval_cancels_publication(self) -> None:
        gate = self.h.gate()
        self.h.engine.approve(gate["gate_id"], "owner", gate["scope"])
        self.h.tick()
        task_id = self.h.active()["task_id"]
        self.h.engine.revoke(gate["gate_id"], "owner", "wrong target")
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "blocked")
        self.assertEqual(self.h.bridge.calls("cancel"), [task_id])

    def test_bridge_needs_approval_parks_and_resumes(self) -> None:
        gate = self.h.gate()
        self.h.engine.approve(gate["gate_id"], "owner", gate["scope"])
        self.h.tick()
        self.h.finish(state=bp.NEEDS_APPROVAL, ev={})
        self.assertEqual(self.h.run()["status"], "waiting_approval")
        parked = self.h.gate()
        self.h.engine.approve(parked["gate_id"], "owner", parked["scope"])
        self.h.tick()
        self.assertEqual(self.h.active()["attempt_no"], 2)
        self.h.finish()
        self.assertEqual(self.h.active()["node"], "delivery")


class ApprovalExpiryTests(EngineCase):
    policy = Policy(approval_ttl_seconds=600)

    def test_expired_approval_blocks(self) -> None:
        self.start()
        self.advance_to("artifact_check")
        self.h.finish()
        gate = self.h.gate()
        self.clock.advance(601)
        with self.assertRaisesRegex(ApprovalError, "expired"):
            self.h.engine.approve(gate["gate_id"], "owner", gate["scope"])
        self.assertEqual(self.h.run()["status"], "blocked")
        self.assertNotIn("publication", self.nodes_submitted())


CHILD_CRASH = r"""
import os, sys
sys.path.insert(0, sys.argv[1])
from agent_office.workflow.bridge_port import FakeBridge
from agent_office.workflow.coordinator import Coordinator
from agent_office.workflow.engine import WorkflowEngine
from agent_office.workflow.storage import WorkflowRepository

root = sys.argv[2]
repo = WorkflowRepository(root + "/workflow.sqlite3")
engine = WorkflowEngine(repo, clock=lambda: 1_000_000.0)
engine.record_submission = lambda *a, **k: os._exit(137)  # die after Bridge accept
Coordinator(engine, FakeBridge(root + "/fake-bridge.sqlite3")).run_once()
"""


class FaultInjectionTests(EngineCase):
    def test_failed_successor_creation_rolls_back_and_replays_once(self) -> None:
        self.start()
        attempt = self.h.active()
        self.h.bridge.set_state(attempt["task_id"], bp.SUCCEEDED,
                                evidence=evidence("implementation"))
        with mock.patch.object(self.h.repo, "insert_attempt",
                               side_effect=sqlite3.OperationalError("disk I/O error")):
            with self.assertRaises(sqlite3.OperationalError):
                self.h.tick()
        stored = self.h.repo.get_attempt(attempt["attempt_id"])
        self.assertEqual(stored["status"], "submitted")
        self.assertEqual(self.h.repo.receipts(attempt["attempt_id"]), [])
        self.assertEqual(self.h.run()["source_sha"], None)
        self.h.restart().tick()
        self.h.restart().tick()
        self.assertEqual(self.nodes_submitted(), ["implementation", "acceptance"])

    def test_lost_submit_ack_reconciles_to_single_task(self) -> None:
        self.h.engine.start_run("run-1", self.v1, {"goal": "g"})
        self.h.bridge.inject("submit_lost_ack")
        self.h.tick()
        intent = self.h.repo.intents("run-1")[0]
        self.assertEqual((intent["status"], intent["tries"]), ("pending", 1))
        self.assertEqual(intent["due_at"], self.clock.now + 2)
        self.assertIsNone(self.h.active()["task_id"])
        self.clock.advance(2)
        self.h.tick()
        self.assertEqual(len(self.h.bridge.tasks()), 1)
        self.assertEqual(self.h.active()["task_id"], self.h.bridge.tasks()[0]["task_id"])
        self.assertEqual(self.h.bridge.calls("submit"), [self.h.active()["idempotency_key"]])

    def test_crash_between_bridge_accept_and_record_is_recovered(self) -> None:
        self.h.engine.start_run("run-1", self.v1, {"goal": "g"})
        with mock.patch.object(self.h.engine, "record_submission",
                               side_effect=RuntimeError("process killed")):
            with self.assertRaises(RuntimeError):
                self.h.tick()
        self.h = self.h.restart()
        self.h.tick()
        self.assertEqual(len(self.h.bridge.tasks()), 1)
        self.assertEqual(self.h.active()["status"], "submitted")

    def test_hard_killed_coordinator_process_is_recovered(self) -> None:
        import subprocess
        import sys
        self.h.engine.start_run("run-1", self.v1, {"goal": "g"})
        project = str(Path(__file__).resolve().parents[1])
        child = subprocess.run([sys.executable, "-c", CHILD_CRASH, project,
                                str(self.root)], capture_output=True, timeout=60)
        self.assertEqual(child.returncode, 137, child.stderr.decode()[-2000:])
        self.assertEqual(len(self.h.bridge.tasks()), 1)
        self.assertIsNone(self.h.restart().active()["task_id"])
        self.h = self.h.restart()
        self.h.tick()
        self.assertEqual(len(self.h.bridge.tasks()), 1)
        self.assertEqual(self.h.active()["task_id"], self.h.bridge.tasks()[0]["task_id"])

    def test_terminal_bridge_state_while_coordinator_down(self) -> None:
        self.start()
        task_id = self.h.active()["task_id"]
        self.h.repo.close()
        self.h.bridge.set_state(task_id, bp.SUCCEEDED, evidence=evidence("implementation"))
        self.h = self.h.restart()
        self.h.tick()
        self.assertEqual(self.h.active()["node"], "acceptance")

    def test_transport_exhaustion_blocks_visibly(self) -> None:
        self.h.engine.start_run("run-1", self.v1, {"goal": "g"})
        self.h.bridge.inject(*["reconcile_error"] * 4)
        for backoff in (0, 2, 4, 8):
            self.clock.advance(backoff)
            self.h.tick()
        run = self.h.run()
        self.assertEqual(run["status"], "blocked")
        self.assertIn("unreconciled after 4 tries", run["status_reason"])
        self.assertEqual(self.h.bridge.tasks(), [])
        self.assertIsNone(self.h.active())

    def test_status_poll_errors_do_not_change_state(self) -> None:
        self.start()
        self.h.bridge.inject("status_error")
        report = self.h.coordinator.run_once()
        self.assertEqual(report.transport_errors, 1)
        self.assertEqual(self.h.active()["status"], "submitted")

    def test_interrupted_cancel_is_retried_until_observed(self) -> None:
        self.start()
        self.h.engine.request_cancel("run-1", "stop")
        self.h.bridge.inject("cancel_error")
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "cancelling")
        self.clock.advance(2)
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "cancelled")


class _StubTask:
    def __init__(self, task_id: str, key: str, state: str = "queued", **kw) -> None:
        self.id, self.idempotency_key, self.state = task_id, key, state
        self.error, self.git_sha, self.exit_code = kw.get("error"), None, None
        self.run_ids, self.artifacts = [], kw.get("artifacts", [])


class _StubBridge:
    """Mimics the public TaskBridge surface the adapter relies on."""

    def __init__(self) -> None:
        self.tasks: dict[str, _StubTask] = {}
        self.kwargs: list[dict] = []
        self.storage = self
        self.drop_save = False
        self.explode = False

    def submit_task(self, **kw):
        if self.explode:
            raise OSError("bridge db locked")
        self.kwargs.append(kw)
        for task in self.tasks.values():
            if task.idempotency_key == kw["idempotency_key"]:
                return task.id
        task_id = f"t{len(self.kwargs)}"
        if not self.drop_save:
            self.tasks[task_id] = _StubTask(task_id, kw["idempotency_key"])
        return task_id

    def get_task(self, task_id):
        return self.tasks.get(task_id)

    def get_task_by_idempotency_key(self, key):
        return next((t for t in self.tasks.values() if t.idempotency_key == key), None)

    def cancel_task(self, task_id, reason=""):
        return task_id in self.tasks


REQUEST = bp.SubmitRequest("agent-office-workflow:r/implementation/1/1", "title",
                           "goal", "/repo", None, "claude", "claude-opus-5-5", 60,
                           complexity="heavy")


class TaskBridgeAdapterTests(TempDirCase):
    def test_maps_request_to_public_submit_signature(self) -> None:
        stub = _StubBridge()
        adapter = bp.TaskBridgeAdapter(stub, complexity_type=str)
        task_id = adapter.submit_task(REQUEST)
        self.assertEqual(adapter.submit_task(REQUEST), task_id)
        kw = stub.kwargs[0]
        self.assertEqual(kw["idempotency_key"], REQUEST.idempotency_key)
        self.assertEqual((kw["executor"], kw["model"], kw["complexity"]),
                         ("claude", "claude-opus-5-5", "heavy"))
        self.assertEqual(adapter.reconcile_task(REQUEST.idempotency_key).task_id, task_id)

    def test_unpersisted_ack_and_exceptions_become_transport_errors(self) -> None:
        stub = _StubBridge()
        adapter = bp.TaskBridgeAdapter(stub, complexity_type=str)
        stub.drop_save = True
        with self.assertRaises(bp.BridgeTransportError):
            adapter.submit_task(REQUEST)
        stub.drop_save, stub.explode = False, True
        with self.assertRaises(bp.BridgeTransportError):
            adapter.submit_task(REQUEST)

    def test_reads_workflow_evidence_artifact(self) -> None:
        path = self.root / bp.EVIDENCE_FILENAME
        path.write_text(json.dumps({"producer": "x", "verdict": "defect"}))
        stub = _StubBridge()
        stub.tasks["t9"] = _StubTask("t9", "k", "succeeded", artifacts=[str(path)])
        status = bp.TaskBridgeAdapter(stub, complexity_type=str).get_task_status("t9")
        self.assertEqual(status.evidence["verdict"], "defect")
        self.assertTrue(status.terminal)


STAGE2_SRC = Path("/home/tyler/workspaces/stage2-infra/src")


@unittest.skipUnless((STAGE2_SRC / "task_bridge" / "bridge.py").exists(),
                     "stage2-infra Task Bridge sources not present")
class RealTaskBridgeSandboxTests(TempDirCase):
    """Real TaskBridge class, temp DB/dirs only, wake runner stubbed + deferred."""

    def setUp(self) -> None:
        super().setUp()
        import sys
        if str(STAGE2_SRC) not in sys.path:
            sys.path.append(str(STAGE2_SRC))
        from task_bridge.bridge import TaskBridge
        from task_bridge.wake import ManagerWakeDispatcher
        sandbox = self.root / "bridge"
        self.bridge = TaskBridge(db_path=sandbox / "tasks.db", base_workdir=sandbox / "work",
                                 outbox_dir=sandbox / "outbox",
                                 artifacts_dir=sandbox / "artifacts")
        self.wake_commands: list = []
        self.bridge.wake_dispatcher = ManagerWakeDispatcher(
            self.bridge.storage,
            runner=lambda cmd: self.wake_commands.append(cmd) or (0, "", ""))
        self.bridge.defer_wake_dispatch = True
        self.adapter = bp.TaskBridgeAdapter(self.bridge)

    def test_workflow_attempt_round_trips_through_real_bridge(self) -> None:
        from task_bridge.models import TaskState
        clock = Clock()
        repo = self.open_repo()
        engine = WorkflowEngine(repo, clock=clock)
        coordinator = Coordinator(engine, self.adapter)
        digest = engine.register(build_release_workflow())
        engine.start_run("run-1", digest, {"goal": "g",
                                           "working_dir": str(self.root / "wd")})
        coordinator.run_until_idle()
        coordinator.run_until_idle()
        attempt = repo.active_attempt("run-1")
        task = self.bridge.get_task(attempt["task_id"])
        self.assertEqual(task.idempotency_key, attempt["idempotency_key"])
        self.assertEqual(task.executor, "claude")
        self.assertEqual(len(self.bridge.list_tasks()), 1)
        # Simulate Bridge worker acquisition + completion with evidence file.
        self.assertTrue(self.bridge.storage.atomic_transition(
            task_id=task.id, from_states=[TaskState.QUEUED], to_state=TaskState.RUNNING,
            updates={}))
        evidence_file = self.root / bp.EVIDENCE_FILENAME
        evidence_file.write_text(json.dumps(evidence("implementation")))
        self.assertTrue(self.bridge.complete_task(task.id, git_sha=SHA1,
                                                  artifacts=[str(evidence_file)]))
        coordinator.run_until_idle()
        self.assertEqual(repo.active_attempt("run-1")["node"], "acceptance")
        engine.request_cancel("run-1", "sandbox done")
        coordinator.run_until_idle()
        self.assertEqual(repo.get_run("run-1")["status"], "cancelled")
        self.assertEqual(self.wake_commands, [])
