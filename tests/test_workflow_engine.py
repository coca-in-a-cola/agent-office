"""AO-GRAPH-02 Workflow Core tests: definitions, repository, reducer, faults.

All databases live in unique TemporaryDirectory paths; no live Bridge, Office
or Hermes state is read or written.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
import sqlite3
import tempfile
import unittest

from agent_office.workflow.definitions import (
    DefinitionError, NodeDefinition, Outcome, Target, Transition,
    WorkflowDefinition,
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
