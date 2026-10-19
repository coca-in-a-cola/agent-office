"""AO-GRAPH-02 Workflow Core tests: definitions, repository, reducer, faults.

All databases live in unique TemporaryDirectory paths; no live Bridge, Office
or Hermes state is read or written.
"""

from __future__ import annotations

import dataclasses
import unittest

from agent_office.workflow.definitions import (
    DefinitionError, NodeDefinition, Outcome, Target, Transition,
    WorkflowDefinition,
)
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
