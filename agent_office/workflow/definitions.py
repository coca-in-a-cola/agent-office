"""Immutable, hash-pinned workflow definitions for Workflow Core.

A definition is data only: nodes, explicit per-outcome transitions and the
roles that perform each node. Its identity is the SHA-256 of a canonical JSON
document, so a run pinned to a hash can never silently follow an edited graph.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import enum
import hashlib
import json
from typing import Any, Mapping


class Outcome(str, enum.Enum):
    """Typed interpretation of one node attempt; not Bridge TaskState."""

    SUCCESS = "success"
    DEFECT = "defect"
    TIMEOUT = "timeout"
    FAILURE = "failure"
    CANCEL = "cancel"
    QUOTA = "quota"
    APPROVAL_WAIT = "approval_wait"


class Target(str, enum.Enum):
    """Engine-level transition targets that are not workflow nodes."""

    RETRY = "@retry"          # new attempt, same node iteration (bounded)
    INSPECT = "@inspect"      # reconcile preserved state before any recovery
    BLOCKED = "@blocked"      # visible, explained stop of THIS run only
    CANCELLED = "@cancelled"  # terminal; no successor, no resubmission
    QUOTA_WAIT = "@quota"     # due-time backoff before a new attempt
    APPROVAL = "@approval"    # park until an explicit gate decision
    COMPLETED = "@completed"  # terminal success of the run


SPECIAL_TARGETS = frozenset(t.value for t in Target)


class DefinitionError(ValueError):
    """Definition is structurally invalid; never registered or executed."""


@dataclass(frozen=True, slots=True)
class DigestBinding:
    """evidence[evidence_key] must equal the digest node.artifact recorded."""

    evidence_key: str
    node: str
    artifact: str

    def to_json(self) -> dict[str, str]:
        return {"evidence_key": self.evidence_key, "node": self.node,
                "artifact": self.artifact}


@dataclass(frozen=True, slots=True)
class NodeDefinition:
    """One logical step: who may run it and what proves it finished."""

    name: str
    role: str
    allowed_executors: tuple[str, ...]
    allowed_models: tuple[str, ...]
    goal: str
    inputs: tuple[str, ...] = ()
    expected_artifacts: tuple[str, ...] = ()
    required_fields: tuple[str, ...] = ()
    completion_criteria: tuple[str, ...] = ()
    timeout_seconds: int = 3600
    budget: tuple[tuple[str, int], ...] = ()
    max_attempts: int = 2
    max_iterations: int = 2
    binds_source: bool = False
    independent_of: tuple[str, ...] = ()
    digest_bindings: tuple[DigestBinding, ...] = ()
    side_effecting: bool = False
    requires_approval: bool = False
    approval_scope: str = ""
    input_scope: str = "task"
    is_mandatory_publication: bool = False

    def __post_init__(self) -> None:
        if not self.name or self.name.startswith("@"):
            raise DefinitionError(f"invalid node name {self.name!r}")
        if not self.role:
            raise DefinitionError(f"{self.name}: role is required")
        if not self.allowed_executors or not self.allowed_models:
            raise DefinitionError(f"{self.name}: executors and models required")
        if self.timeout_seconds <= 0:
            raise DefinitionError(f"{self.name}: timeout must be positive")
        if not 1 <= self.max_attempts <= 2 or not 1 <= self.max_iterations <= 2:
            raise DefinitionError(f"{self.name}: attempts/iterations bounded to 2")
        if self.requires_approval and not self.approval_scope:
            raise DefinitionError(f"{self.name}: approval gate needs a scope")
        if self.input_scope not in ("project", "task", "batch"):
            raise DefinitionError(f"{self.name}: input_scope must be 'project', 'task', or 'batch'")
        for value in (self.allowed_executors, self.allowed_models, self.inputs,
                      self.expected_artifacts, self.required_fields,
                      self.completion_criteria, self.budget,
                      self.independent_of, self.digest_bindings):
            if not isinstance(value, tuple):
                raise DefinitionError(f"{self.name}: collections must be tuples")

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "role": self.role,
            "allowed_executors": list(self.allowed_executors),
            "allowed_models": list(self.allowed_models),
            "goal": self.goal,
            "inputs": list(self.inputs),
            "expected_artifacts": list(self.expected_artifacts),
            "required_fields": list(self.required_fields),
            "completion_criteria": list(self.completion_criteria),
            "timeout_seconds": self.timeout_seconds,
            "budget": {k: v for k, v in self.budget},
            "max_attempts": self.max_attempts,
            "max_iterations": self.max_iterations,
            "binds_source": self.binds_source,
            "independent_of": list(self.independent_of),
            "digest_bindings": [b.to_json() for b in self.digest_bindings],
            "side_effecting": self.side_effecting,
            "requires_approval": self.requires_approval,
            "approval_scope": self.approval_scope,
            "input_scope": self.input_scope,
            "is_mandatory_publication": self.is_mandatory_publication,
        }

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> "NodeDefinition":
        return cls(
            name=data["name"],
            role=data["role"],
            allowed_executors=tuple(data["allowed_executors"]),
            allowed_models=tuple(data["allowed_models"]),
            goal=data["goal"],
            inputs=tuple(data["inputs"]),
            expected_artifacts=tuple(data["expected_artifacts"]),
            required_fields=tuple(data["required_fields"]),
            completion_criteria=tuple(data["completion_criteria"]),
            timeout_seconds=int(data["timeout_seconds"]),
            budget=tuple(sorted((str(k), int(v)) for k, v in data["budget"].items())),
            max_attempts=int(data["max_attempts"]),
            max_iterations=int(data["max_iterations"]),
            binds_source=bool(data["binds_source"]),
            independent_of=tuple(data["independent_of"]),
            digest_bindings=tuple(DigestBinding(**b) for b in data["digest_bindings"]),
            side_effecting=bool(data["side_effecting"]),
            requires_approval=bool(data["requires_approval"]),
            approval_scope=data["approval_scope"],
            input_scope=data.get("input_scope", "task"),
            is_mandatory_publication=bool(data.get("is_mandatory_publication", False)),
        )


@dataclass(frozen=True, slots=True)
class Transition:
    source: str
    outcome: Outcome
    target: str

    def to_json(self) -> dict[str, str]:
        return {"source": self.source, "outcome": self.outcome.value,
                "target": self.target}


@dataclass(frozen=True, slots=True)
class WorkflowDefinition:
    """Validated immutable graph. Editing means a new version and new hash."""

    name: str
    version: int
    start: str
    nodes: tuple[NodeDefinition, ...]
    transitions: tuple[Transition, ...]
    _index: dict[str, NodeDefinition] = field(init=False, repr=False,
                                              compare=False, hash=False)
    _edges: dict[tuple[str, Outcome], str] = field(init=False, repr=False,
                                                   compare=False, hash=False)

    def __post_init__(self) -> None:
        if not isinstance(self.nodes, tuple) or not isinstance(self.transitions, tuple):
            raise DefinitionError("nodes and transitions must be tuples")
        if self.version < 1:
            raise DefinitionError("version must be >= 1")
        index: dict[str, NodeDefinition] = {}
        for node in self.nodes:
            if node.name in index:
                raise DefinitionError(f"duplicate node {node.name}")
            index[node.name] = node
        if self.start not in index:
            raise DefinitionError(f"unknown start node {self.start}")
        edges: dict[tuple[str, Outcome], str] = {}
        for t in self.transitions:
            key = (t.source, Outcome(t.outcome))
            if t.source not in index:
                raise DefinitionError(f"transition from unknown node {t.source}")
            if t.target not in index and t.target not in SPECIAL_TARGETS:
                raise DefinitionError(f"transition to unknown target {t.target}")
            if key in edges:
                raise DefinitionError(f"duplicate transition {t.source}/{t.outcome}")
            edges[key] = t.target
        for name in index:
            missing = [o.value for o in Outcome if (name, o) not in edges]
            if missing:
                raise DefinitionError(f"{name}: no explicit branch for {missing}")
        success_preds: dict[str, str] = {}
        for (source, outcome), target in edges.items():
            if outcome is Outcome.SUCCESS and target in index:
                if target in success_preds:
                    raise DefinitionError(f"join into {target} is not supported")
                success_preds[target] = source
        for node in self.nodes:
            for ref in node.independent_of + tuple(b.node for b in node.digest_bindings):
                if ref not in index:
                    raise DefinitionError(f"{node.name}: unknown node ref {ref}")
            for binding in node.digest_bindings:
                if binding.artifact not in index[binding.node].expected_artifacts:
                    raise DefinitionError(f"{node.name}: {binding.node} does not "
                                          f"produce {binding.artifact}")
        object.__setattr__(self, "_index", index)
        object.__setattr__(self, "_edges", edges)

    def node(self, name: str) -> NodeDefinition:
        return self._index[name]

    def target(self, source: str, outcome: Outcome) -> str:
        return self._edges[(source, outcome)]

    def downstream(self, name: str) -> frozenset[str]:
        """Nodes reachable from name by success edges (evidence invalidated
        when name starts a new iteration)."""
        seen: set[str] = set()
        frontier = [name]
        while frontier:
            current = frontier.pop()
            nxt = self._edges[(current, Outcome.SUCCESS)]
            if nxt in self._index and nxt not in seen:
                seen.add(nxt)
                frontier.append(nxt)
        seen.discard(name)
        return frozenset(seen)

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "start": self.start,
            "nodes": [n.to_json() for n in sorted(self.nodes, key=lambda n: n.name)],
            "transitions": [t.to_json() for t in sorted(
                self.transitions, key=lambda t: (t.source, Outcome(t.outcome).value))],
            "roles": {n.name: n.role for n in self.nodes},
        }

    def canonical_json(self) -> str:
        return json.dumps(self.to_json(), sort_keys=True, separators=(",", ":"),
                          ensure_ascii=False)

    @property
    def definition_hash(self) -> str:
        digest = hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()
        return f"sha256:{digest}"

    @classmethod
    def from_canonical_json(cls, text: str) -> "WorkflowDefinition":
        data = json.loads(text)
        definition = cls(
            name=data["name"],
            version=int(data["version"]),
            start=data["start"],
            nodes=tuple(NodeDefinition.from_json(n) for n in data["nodes"]),
            transitions=tuple(Transition(t["source"], Outcome(t["outcome"]), t["target"])
                              for t in data["transitions"]),
        )
        if definition.to_json()["roles"] != data["roles"]:
            raise DefinitionError("role map does not match nodes")
        return definition
