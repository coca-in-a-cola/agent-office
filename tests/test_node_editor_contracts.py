"""Validation tests for Node Editor v1 JSON Schema and Graph Contracts (AO-NE-01).

Validates:
1. schemas/node-editor-v1.schema.json is a valid JSON schema draft-07.
2. schemas/examples/valid-timeout-recovery.json complies with schema and passes all graph contract checks.
3. schemas/examples/invalid-port-link.json correctly triggers graph contract violations (control-to-data, status-to-control, data type mismatch).
"""

import json
from pathlib import Path
import unittest

import jsonschema


REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "schemas" / "node-editor-v1.schema.json"
VALID_EXAMPLE_PATH = REPO_ROOT / "schemas" / "examples" / "valid-timeout-recovery.json"
INVALID_EXAMPLE_PATH = REPO_ROOT / "schemas" / "examples" / "invalid-port-link.json"


def validate_graph_contracts(graph: dict) -> list[str]:
    """Applies domain contract checks to a graph definition.

    Returns a list of violation error strings (empty if valid).
    """
    errors: list[str] = []

    # Map nodes and ports
    nodes = {node["id"]: node for node in graph.get("nodes", [])}
    ports_by_node: dict[str, dict[str, dict]] = {}
    for node_id, node in nodes.items():
        ports_by_node[node_id] = {p["id"]: p for p in node.get("ports", [])}

    # Verify Entrypoint
    entrypoint = graph.get("entrypoint")
    if not entrypoint or entrypoint not in nodes:
        errors.append(f"Entrypoint '{entrypoint}' does not exist in nodes.")
    elif nodes[entrypoint].get("type") != "Start":
        errors.append(f"Entrypoint '{entrypoint}' must be of type 'Start'.")

    # Validate Edges
    for edge in graph.get("edges", []):
        edge_id = edge.get("id")
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

        src_ports = ports_by_node[src_node_id]
        tgt_ports = ports_by_node[tgt_node_id]

        if src_port_id not in src_ports:
            errors.append(f"Edge '{edge_id}': source port '{src_port_id}' not found on node '{src_node_id}'.")
            continue
        if tgt_port_id not in tgt_ports:
            errors.append(f"Edge '{edge_id}': target port '{tgt_port_id}' not found on node '{tgt_node_id}'.")
            continue

        src_port = src_ports[src_port_id]
        tgt_port = tgt_ports[tgt_port_id]

        # Port direction checks
        if src_port.get("direction") != "output":
            errors.append(f"Edge '{edge_id}': source port '{src_port_id}' direction must be 'output'.")
        if tgt_port.get("direction") != "input":
            errors.append(f"Edge '{edge_id}': target port '{tgt_port_id}' direction must be 'input'.")

        # Port kind checks
        src_kind = src_port.get("kind")
        tgt_kind = tgt_port.get("kind")

        # Invariant: Waiting states (status ports) cannot activate an ordinary exec successor
        if src_kind == "status" and tgt_kind == "control":
            errors.append(
                f"Edge '{edge_id}': source port '{src_port_id}' is a 'status' port (waiting state) "
                f"and cannot be wired to activate control port '{tgt_port_id}'."
            )

        # Invariant: Edge kind must match port kinds
        if edge_kind != src_kind:
            errors.append(
                f"Edge '{edge_id}': edge kind '{edge_kind}' does not match source port kind '{src_kind}'."
            )
        if edge_kind != tgt_kind:
            errors.append(
                f"Edge '{edge_id}': edge kind '{edge_kind}' does not match target port kind '{tgt_kind}'."
            )

        # Data type compatibility
        if edge_kind == "data":
            src_dtype = src_port.get("data_type")
            tgt_dtype = tgt_port.get("data_type")
            if src_dtype != tgt_dtype:
                errors.append(
                    f"Edge '{edge_id}': source data_type '{src_dtype}' cannot be wired to target data_type '{tgt_dtype}'."
                )

    # Invariant: Role/executor/model separation in policies
    policies = graph.get("policies", {}).get("routing_policies", [])
    for policy in policies:
        strategy = policy.get("strategy")
        if strategy not in ("priority", "round_robin"):
            errors.append(f"Routing policy '{policy.get('policy_id')}' has invalid strategy '{strategy}'.")
        routes = policy.get("routes", [])
        if not routes:
            errors.append(f"Routing policy '{policy.get('policy_id')}' must define at least one route.")
        for route in routes:
            if not route.get("provider") or not route.get("model") or not route.get("executor"):
                errors.append(f"Route '{route.get('route_id')}' must specify provider, model, and executor explicitly.")

    return errors


class NodeEditorSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert SCHEMA_PATH.exists(), f"Schema file missing: {SCHEMA_PATH}"
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            cls.schema = json.load(f)
        cls.validator = jsonschema.Draft7Validator(cls.schema)

    def test_schema_itself_is_valid_draft7(self):
        jsonschema.Draft7Validator.check_schema(self.schema)

    def test_valid_timeout_recovery_complies_with_schema(self):
        with open(VALID_EXAMPLE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        errors = list(self.validator.iter_errors(data))
        self.assertEqual(len(errors), 0, f"Schema validation errors: {[e.message for e in errors]}")

    def test_valid_timeout_recovery_passes_contract_rules(self):
        with open(VALID_EXAMPLE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        contract_errors = validate_graph_contracts(data)
        self.assertEqual(len(contract_errors), 0, f"Contract errors: {contract_errors}")

    def test_invalid_port_link_fails_contract_rules(self):
        with open(INVALID_EXAMPLE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        contract_errors = validate_graph_contracts(data)
        self.assertGreater(len(contract_errors), 0, "Expected contract violations were not caught!")

        # Verify specific expected error patterns are caught
        errors_text = " ".join(contract_errors)
        self.assertIn("cannot be wired to activate control port", errors_text)
        self.assertIn("does not match source port kind", errors_text)
        self.assertIn("cannot be wired to target data_type", errors_text)


if __name__ == "__main__":
    unittest.main()
