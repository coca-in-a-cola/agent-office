"""Machine-readable graph validator for Agent Office Process Studio (v1).

Enforces:
1. JSON Schema (draft-07) compliance against schemas/node-editor-v1.schema.json.
2. Entrypoint invariants (must be type Start, no incoming control edges).
3. Typed port compatibility (direction, kind, data type matching, status isolation).
4. Bounded supported grammar:
   - Gated/unsupported joins (AllOfJoin) are rejected in v1 release.
5. Arbitrary cycle detection:
   - All control-flow cycles must be explicitly gated by a LoopGate node enforcing max_iterations.
6. Role and routing policy referential integrity.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import jsonschema

# Locate schema relative to repository root
DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent / "schemas" / "node-editor-v1.schema.json"
)

# Supported node types for v1 bounded release
SUPPORTED_V1_NODE_TYPES = {
    "Start",
    "Work",
    "InspectResult",
    "IndependentAcceptance",
    "Condition",
    "LoopGate",
    "Approval",
    "End",
}

# Gated / unsupported join types in v1
UNSUPPORTED_V1_NODE_TYPES = {
    "AllOfJoin",
    "Join",
}


def _find_all_cycles(nodes: list[str], edges: list[tuple[str, str]]) -> list[list[str]]:
    """Find all simple directed cycles in the graph using DFS with backtracking."""
    adj: dict[str, list[str]] = {n: [] for n in nodes}
    for src, tgt in edges:
        if src in adj and tgt in adj:
            adj[src].append(tgt)

    cycles: list[list[str]] = []
    visited: set[str] = set()
    stack: list[str] = []
    stack_set: set[str] = set()

    def dfs(current: str) -> None:
        stack.append(current)
        stack_set.add(current)
        visited.add(current)

        for neighbor in adj.get(current, []):
            if neighbor in stack_set:
                idx = stack.index(neighbor)
                cycle = stack[idx:] + [neighbor]
                cycles.append(cycle)
            elif neighbor not in visited:
                dfs(neighbor)

        stack.pop()
        stack_set.remove(current)

    for node in nodes:
        if node not in visited:
            dfs(node)

    return cycles


class GraphValidator:
    """Validates an Agent Office graph against schema and normative domain contracts."""

    def __init__(self, schema_path: Optional[Path] = None):
        path = schema_path or DEFAULT_SCHEMA_PATH
        if not path.exists():
            raise FileNotFoundError(f"Schema file not found at {path}")
        with open(path, "r", encoding="utf-8") as f:
            self.schema = json.load(f)
        self.draft7_validator = jsonschema.Draft7Validator(self.schema)

    def validate(self, graph: dict[str, Any]) -> list[str]:
        """Validate graph against JSON Schema and domain contracts.

        Returns:
            list[str]: List of validation error strings. Empty list indicates valid graph.
        """
        errors: list[str] = []

        # 1. JSON Schema Validation
        for err in self.draft7_validator.iter_errors(graph):
            path_str = "/".join(str(p) for p in err.path) if err.path else "root"
            errors.append(f"Schema error at '{path_str}': {err.message}")

        # 2. Structural & Referential Integrity
        nodes_list = graph.get("nodes", [])
        if not isinstance(nodes_list, list):
            return errors

        nodes: dict[str, dict[str, Any]] = {}
        for n in nodes_list:
            if isinstance(n, dict) and "id" in n:
                nodes[n["id"]] = n

        ports_by_node: dict[str, dict[str, dict[str, Any]]] = {}
        for node_id, node in nodes.items():
            ports = node.get("ports", [])
            ports_by_node[node_id] = {
                p["id"]: p for p in ports if isinstance(p, dict) and "id" in p
            }

        # Entrypoint validation
        entrypoint = graph.get("entrypoint")
        if not entrypoint or entrypoint not in nodes:
            errors.append(f"Entrypoint '{entrypoint}' does not exist in graph nodes.")
        elif nodes[entrypoint].get("type") != "Start":
            errors.append(
                f"Entrypoint '{entrypoint}' must be of type 'Start', found '{nodes[entrypoint].get('type')}'."
            )

        # Node type grammar checks (rejecting AllOfJoin / unsupported joins)
        for node_id, node in nodes.items():
            ntype = node.get("type", "")
            if ntype in UNSUPPORTED_V1_NODE_TYPES or "Join" in ntype:
                errors.append(
                    f"Node '{node_id}' has unsupported type '{ntype}': parallel joins are gated in v1 release."
                )

        # Roles and policies referential checks
        defined_roles = set(graph.get("roles", {}).keys())
        routing_policies = graph.get("policies", {}).get("routing_policies", [])
        defined_policy_ids = {p.get("policy_id") for p in routing_policies if isinstance(p, dict)}

        for node_id, node in nodes.items():
            role = node.get("role")
            if role and role not in defined_roles:
                errors.append(f"Node '{node_id}' references undefined role '{role}'.")
            policy_id = node.get("route_policy_id")
            if policy_id and policy_id not in defined_policy_ids:
                errors.append(
                    f"Node '{node_id}' references undefined route_policy_id '{policy_id}'."
                )

        # 3. Edge Validation
        edges_list = graph.get("edges", [])
        control_edges: list[tuple[str, str]] = []

        if isinstance(edges_list, list):
            seen_edge_ports: set[tuple[str, str, str, str]] = set()

            for edge in edges_list:
                if not isinstance(edge, dict):
                    continue
                edge_id = edge.get("id", "unknown_edge")
                src_node_id = edge.get("source_node_id")
                src_port_id = edge.get("source_port_id")
                tgt_node_id = edge.get("target_node_id")
                tgt_port_id = edge.get("target_port_id")
                edge_kind = edge.get("kind")

                if src_node_id not in nodes:
                    errors.append(f"Edge '{edge_id}': source node '{src_node_id}' not found.")
                    continue
                if tgt_node_id not in nodes:
                    errors.append(f"Edge '{edge_id}': target node '{tgt_node_id}' not found.")
                    continue

                src_ports = ports_by_node.get(src_node_id, {})
                tgt_ports = ports_by_node.get(tgt_node_id, {})

                if src_port_id not in src_ports:
                    errors.append(
                        f"Edge '{edge_id}': source port '{src_port_id}' not found on node '{src_node_id}'."
                    )
                    continue
                if tgt_port_id not in tgt_ports:
                    errors.append(
                        f"Edge '{edge_id}': target port '{tgt_port_id}' not found on node '{tgt_node_id}'."
                    )
                    continue

                src_port = src_ports[src_port_id]
                tgt_port = tgt_ports[tgt_port_id]

                # Check duplicate edges
                edge_key = (src_node_id, src_port_id, tgt_node_id, tgt_port_id)
                if edge_key in seen_edge_ports:
                    errors.append(f"Edge '{edge_id}': duplicate connection {edge_key}.")
                seen_edge_ports.add(edge_key)

                # Direction check
                if src_port.get("direction") != "output":
                    errors.append(
                        f"Edge '{edge_id}': source port '{src_port_id}' direction must be 'output'."
                    )
                if tgt_port.get("direction") != "input":
                    errors.append(
                        f"Edge '{edge_id}': target port '{tgt_port_id}' direction must be 'input'."
                    )

                src_kind = src_port.get("kind")
                tgt_kind = tgt_port.get("kind")

                # Invariant: Waiting states (status ports) cannot activate an ordinary exec successor
                if src_kind == "status" and tgt_kind == "control":
                    errors.append(
                        f"Edge '{edge_id}': source port '{src_port_id}' has kind 'status', "
                        f"but edge kind is '{edge_kind}' and target port '{tgt_port_id}' is 'control'. "
                        f"Observable waiting states cannot activate an ordinary exec successor."
                    )
                elif src_kind == "control" and tgt_kind == "data":
                    errors.append(
                        f"Edge '{edge_id}': source port '{src_port_id}' has kind 'control', "
                        f"but edge kind is '{edge_kind}' and target port '{tgt_port_id}' has kind 'data'. "
                        f"Control tokens cannot be wired to data input ports."
                    )
                elif src_kind == "data" and tgt_kind == "control":
                    errors.append(
                        f"Edge '{edge_id}': source port '{src_port_id}' has kind 'data', "
                        f"but target port '{tgt_port_id}' has kind 'control'. "
                        f"Data does not trigger exec."
                    )
                elif edge_kind != src_kind or edge_kind != tgt_kind:
                    errors.append(
                        f"Edge '{edge_id}': edge kind '{edge_kind}' does not match "
                        f"source port kind '{src_kind}' or target port kind '{tgt_kind}'."
                    )

                # Data type compatibility
                if edge_kind == "data":
                    src_dtype = src_port.get("data_type")
                    tgt_dtype = tgt_port.get("data_type")
                    if src_dtype != tgt_dtype:
                        errors.append(
                            f"Edge '{edge_id}': source data_type '{src_dtype}' does not "
                            f"match or satisfy target data_type '{tgt_dtype}'."
                        )

                # Track control flow for cycle detection
                if edge_kind == "control":
                    control_edges.append((src_node_id, tgt_node_id))
                    # Invariant: Entrypoint Start node cannot receive incoming control
                    if tgt_node_id == entrypoint:
                        errors.append(
                            f"Edge '{edge_id}': entrypoint node '{entrypoint}' cannot receive incoming control."
                        )

        # 4. Cycle Detection on Control Flow
        all_cycles = _find_all_cycles(list(nodes.keys()), control_edges)
        for cycle in all_cycles:
            # Check whether this cycle has at least one LoopGate node
            has_loop_gate = any(nodes[nid].get("type") == "LoopGate" for nid in cycle if nid in nodes)
            if not has_loop_gate:
                cycle_str = " -> ".join(cycle)
                errors.append(
                    f"Arbitrary cycle detected: {cycle_str}. "
                    f"Cycles must pass through an explicit LoopGate enforcing max_iterations."
                )

        return errors


_DEFAULT_VALIDATOR: Optional[GraphValidator] = None


def validate_graph(graph: dict[str, Any], schema_path: Optional[Path] = None) -> list[str]:
    """Validate a graph definition using the default or custom validator instance."""
    global _DEFAULT_VALIDATOR
    if schema_path is not None:
        validator = GraphValidator(schema_path)
    else:
        if _DEFAULT_VALIDATOR is None:
            _DEFAULT_VALIDATOR = GraphValidator()
        validator = _DEFAULT_VALIDATOR
    return validator.validate(graph)
