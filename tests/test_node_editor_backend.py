"""Unit and HTTP integration tests for the Process Studio Node Editor backend (AO-NE-03).

Tests:
1. Draft save and reload with full layout and viewport preservation.
2. Optimistic concurrency with stale revision conflict rejection (409 Conflict).
3. Semantic canonical hash invariant: layout-only edits yield identical definition_hash.
4. Typed port and grammar validation:
   - status-to-control rejection
   - control-to-data rejection
   - data type mismatch rejection
   - unknown port/node rejection
   - unsupported join (AllOfJoin) rejection
   - arbitrary cycle rejection vs LoopGate cycle acceptance
5. Immutable publication:
   - Monotonic versioning and canonical record storage
   - Zero task submissions to Task Bridge
   - Existing running workflow instances remain untouched on their pinned definitions
6. Thin HTTP integration tests over ThreadingHTTPServer.
"""

from __future__ import annotations

import contextlib
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from agent_office.editor import (
    EditorApiError,
    EditorService,
    EditorStorage,
    RevisionConflictError,
    canonicalize_graph,
    compute_semantic_hash,
    validate_graph,
)
from agent_office.server import create_server
from agent_office.storage import OfficeStorage
from agent_office.workflow.bridge_port import FakeBridge
from agent_office.workflow.service import WorkflowService

REPO_ROOT = Path(__file__).resolve().parent.parent
VALID_GRAPH_PATH = REPO_ROOT / "schemas" / "valid-timeout-recovery.json"
INVALID_PORT_PATH = REPO_ROOT / "schemas" / "invalid-port-link.json"


def load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class TestEditorStorageAndCanonical(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_path = Path(self.temp_dir.name) / "test_editor.sqlite3"
        self.storage = EditorStorage(self.db_path)
        self.valid_graph = load_json(VALID_GRAPH_PATH)

    def test_draft_save_and_reload_preserves_layout_and_viewport(self) -> None:
        graph = copy.deepcopy(self.valid_graph)
        graph["layout"] = {
            "viewport": {"x": 350.5, "y": -120.0, "zoom": 1.75},
            "nodes": {
                "node_start": {"x": 100, "y": 200, "width": 180, "height": 90},
                "node_work": {"x": 400, "y": 200, "width": 250, "height": 260},
            },
        }

        save_res = self.storage.save_draft("draft-alpha", graph)
        self.assertEqual(save_res["draft_id"], "draft-alpha")
        self.assertEqual(save_res["revision"], 1)

        loaded = self.storage.get_draft("draft-alpha")
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(loaded["draft_id"], "draft-alpha")
        self.assertEqual(loaded["revision"], 1)

        loaded_graph = loaded["graph"]
        self.assertEqual(loaded_graph["layout"]["viewport"]["x"], 350.5)
        self.assertEqual(loaded_graph["layout"]["viewport"]["y"], -120.0)
        self.assertEqual(loaded_graph["layout"]["viewport"]["zoom"], 1.75)
        self.assertEqual(loaded_graph["layout"]["nodes"]["node_start"]["x"], 100)
        self.assertEqual(loaded_graph["layout"]["nodes"]["node_work"]["width"], 250)

    def test_stale_revision_conflict(self) -> None:
        graph = copy.deepcopy(self.valid_graph)
        res1 = self.storage.save_draft("draft-sync", graph)
        self.assertEqual(res1["revision"], 1)

        # Worker A updates with expected_revision=1 -> succeeds, revision becomes 2
        res2 = self.storage.save_draft("draft-sync", graph, expected_revision=1)
        self.assertEqual(res2["revision"], 2)

        # Worker B tries to update with stale expected_revision=1 -> raises conflict
        with self.assertRaises(RevisionConflictError) as ctx:
            self.storage.save_draft("draft-sync", graph, expected_revision=1)
        self.assertEqual(ctx.exception.current_revision, 2)
        self.assertEqual(ctx.exception.expected_revision, 1)

    def test_same_hash_for_layout_only_edits(self) -> None:
        base_graph = copy.deepcopy(self.valid_graph)
        _, hash_1 = canonicalize_graph(base_graph)

        # Edit only layout and viewport coordinates
        layout_edited_graph = copy.deepcopy(base_graph)
        layout_edited_graph["layout"] = {
            "viewport": {"x": 9999.0, "y": -5555.0, "zoom": 2.5},
            "nodes": {
                "node_start": {"x": 888, "y": 777},
                "node_work": {"x": 666, "y": 555},
            },
        }
        _, hash_2 = canonicalize_graph(layout_edited_graph)

        # Semantic hash MUST be identical despite layout changes
        self.assertEqual(hash_1, hash_2, "Layout-only edits must produce the exact same definition_hash")

        # Now edit a semantic field (e.g. node goal or timeout)
        semantic_edited_graph = copy.deepcopy(base_graph)
        semantic_edited_graph["nodes"][0]["name"] = "Mutated Admission Gate Name"
        _, hash_3 = canonicalize_graph(semantic_edited_graph)

        # Semantic hash MUST change on semantic edits
        self.assertNotEqual(hash_1, hash_3, "Semantic changes must produce a different definition_hash")


class TestPortAndGrammarValidation(unittest.TestCase):
    def setUp(self) -> None:
        self.valid_graph = load_json(VALID_GRAPH_PATH)
        self.invalid_graph = load_json(INVALID_PORT_PATH)

    def test_valid_example_passes_all_checks(self) -> None:
        errors = validate_graph(self.valid_graph)
        self.assertEqual(errors, [], f"Expected zero validation errors on valid graph, got: {errors}")

    def test_invalid_example_triggers_specific_port_contract_failures(self) -> None:
        errors = validate_graph(self.invalid_graph)
        self.assertGreater(len(errors), 0, "Invalid port link example must fail validation")

        errors_joined = "\n".join(errors)
        # 1. Status to control
        self.assertIn("cannot activate an ordinary exec successor", errors_joined)
        # 2. Control to data
        self.assertIn("Control tokens cannot be wired to data input ports", errors_joined)
        # 3. Data type mismatch
        self.assertIn("does not match or satisfy target data_type", errors_joined)

    def test_unknown_node_and_port_references(self) -> None:
        graph = copy.deepcopy(self.valid_graph)
        graph["edges"].append({
            "id": "e_unknown_node",
            "kind": "control",
            "source_node_id": "non_existent_node",
            "source_port_id": "p_foo",
            "target_node_id": "node_work",
            "target_port_id": "p_work_ctrl_in",
        })
        errors = validate_graph(graph)
        self.assertTrue(any("source node 'non_existent_node' not found" in e for e in errors))

        graph2 = copy.deepcopy(self.valid_graph)
        graph2["edges"].append({
            "id": "e_unknown_port",
            "kind": "control",
            "source_node_id": "node_start",
            "source_port_id": "non_existent_port",
            "target_node_id": "node_work",
            "target_port_id": "p_work_ctrl_in",
        })
        errors2 = validate_graph(graph2)
        self.assertTrue(any("source port 'non_existent_port' not found" in e for e in errors2))

    def test_unsupported_join_rejection(self) -> None:
        graph = copy.deepcopy(self.valid_graph)
        graph["nodes"].append({
            "id": "node_join_test",
            "type": "AllOfJoin",
            "name": "Parallel Join",
            "ports": [
                {
                    "id": "p_join_in_1",
                    "name": "Branch 1",
                    "direction": "input",
                    "kind": "control",
                    "control_outcome": "exec_in",
                },
                {
                    "id": "p_join_out",
                    "name": "Joined",
                    "direction": "output",
                    "kind": "control",
                    "control_outcome": "joined",
                },
            ],
        })
        errors = validate_graph(graph)
        self.assertTrue(any("parallel joins are gated in v1 release" in e for e in errors))

    def test_arbitrary_cycle_rejection_vs_loop_gate_acceptance(self) -> None:
        # Valid graph has cycle work -> inspect -> loop_gate -> work, which passes through LoopGate
        self.assertEqual(validate_graph(self.valid_graph), [])

        # Create an arbitrary cycle without any LoopGate:
        # Add edge from acceptance.success back to node_work.exec_in directly
        graph = copy.deepcopy(self.valid_graph)
        graph["edges"].append({
            "id": "e_arbitrary_cycle",
            "kind": "control",
            "source_node_id": "node_acceptance",
            "source_port_id": "p_acc_succ",
            "target_node_id": "node_work",
            "target_port_id": "p_work_ctrl_in",
        })
        errors = validate_graph(graph)
        self.assertTrue(
            any("Arbitrary cycle detected" in e and "Cycles must pass through an explicit LoopGate" in e for e in errors),
            f"Expected arbitrary cycle error, got: {errors}",
        )


class TestPublicationAndWorkflowIsolation(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)

        self.db_path = self.root / "office.sqlite3"
        self.storage = OfficeStorage(self.db_path)
        self.addCleanup(self.storage.close)

        self.editor = EditorService(self.db_path)
        self.valid_graph = load_json(VALID_GRAPH_PATH)

        # Set up a real WorkflowService with a FakeBridge to verify isolation
        self.bridge_db = self.root / "bridge.sqlite3"
        self.fake_bridge = FakeBridge(self.bridge_db)
        self.workflow_db = self.root / "workflow.sqlite3"
        self.workflow = WorkflowService(self.workflow_db, self.fake_bridge, bridge_kind="fake")
        self.addCleanup(self.workflow.close)

    def test_immutable_publish_zero_bridge_submit_and_old_runs_unchanged(self) -> None:
        # 1. Start an existing workflow run on legacy definition
        run_res = self.workflow.create_run({"run_id": "run-legacy-1", "inputs": {"goal": "build feature"}})
        self.assertEqual(run_res["run"]["status"], "running")
        with contextlib.closing(self.fake_bridge._connect()) as db:
            initial_task_count = db.execute("SELECT count(*) FROM tasks").fetchone()[0]

        # 2. Publish a new graph via EditorService
        pub_res = self.editor.publish({"graph": self.valid_graph})
        self.assertEqual(pub_res["status"], "ok")
        self.assertEqual(pub_res["version"], 1)
        self.assertEqual(pub_res["graph_id"], self.valid_graph["graph_id"])
        self.assertTrue(pub_res["definition_hash"].startswith("sha256:"))

        # 3. Publish a second version of the same graph
        pub_res_2 = self.editor.publish({"graph": self.valid_graph})
        self.assertEqual(pub_res_2["version"], 2)

        # 4. Invariant: ZERO tasks submitted to Bridge during publication
        with contextlib.closing(self.fake_bridge._connect()) as db:
            current_task_count = db.execute("SELECT count(*) FROM tasks").fetchone()[0]
        self.assertEqual(current_task_count, initial_task_count, "Graph publication must submit ZERO Bridge tasks")

        # 5. Invariant: Existing running workflow instance is untouched and pinned to its definition
        run_detail = self.workflow.get_run("run-legacy-1")
        self.assertEqual(run_detail["run"]["run_id"], "run-legacy-1")
        self.assertEqual(run_detail["run"]["status"], "running")
        self.assertEqual(run_detail["run"]["definition_name"], "software-release")

        # 6. Verify published records in storage are retrievable and immutable
        v1 = self.editor.get_published(self.valid_graph["graph_id"], version=1)
        v2 = self.editor.get_published(self.valid_graph["graph_id"], version=2)
        self.assertEqual(v1["version"], 1)
        self.assertEqual(v2["version"], 2)
        self.assertEqual(v1["definition_hash"], pub_res["definition_hash"])
        self.assertEqual(v2["definition_hash"], pub_res_2["definition_hash"])


class TestEditorHttpIntegration(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)

        self.storage = OfficeStorage(self.root / "office.sqlite3")
        self.addCleanup(self.storage.close)

        static = self.root / "static"
        static.mkdir()
        (static / "index.html").write_text("<html>SPA</html>")

        self.editor = EditorService(self.storage.db_path)
        self.server = create_server(
            host="127.0.0.1",
            port=0,
            storage=self.storage,
            static_dir=static,
            editor=self.editor,
        )
        self.port = self.server.server_address[1]

        self.thread = threading.Thread(
            target=self.server.serve_forever,
            kwargs={"poll_interval": 0.02},
            daemon=True,
        )
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

        self.valid_graph = load_json(VALID_GRAPH_PATH)
        self.invalid_graph = load_json(INVALID_PORT_PATH)

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=data,
            method=method,
        )
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read().decode("utf-8"))

    def test_draft_save_load_and_revision_conflict_http(self) -> None:
        # Save draft
        status, res = self.request("POST", "/api/editor/drafts/test-http-draft", {
            "graph": self.valid_graph,
        })
        self.assertEqual(status, 200)
        self.assertEqual(res["draft_id"], "test-http-draft")
        self.assertEqual(res["revision"], 1)

        # Load draft
        status, loaded = self.request("GET", "/api/editor/drafts/test-http-draft")
        self.assertEqual(status, 200)
        self.assertEqual(loaded["draft_id"], "test-http-draft")
        self.assertEqual(loaded["revision"], 1)
        self.assertEqual(loaded["graph"]["graph_id"], self.valid_graph["graph_id"])

        # Update draft with expected_revision=1 -> revision becomes 2
        status, res2 = self.request("POST", "/api/editor/drafts/test-http-draft", {
            "graph": self.valid_graph,
            "revision": 1,
        })
        self.assertEqual(status, 200)
        self.assertEqual(res2["revision"], 2)

        # Stale update with revision=1 -> 409 Conflict
        status, conflict = self.request("POST", "/api/editor/drafts/test-http-draft", {
            "graph": self.valid_graph,
            "revision": 1,
        })
        self.assertEqual(status, 409)
        self.assertEqual(conflict["status"], "error")
        self.assertIn("revision conflict", conflict["message"].lower())

    def test_validate_api_http(self) -> None:
        # Valid graph
        status, res_valid = self.request("POST", "/api/editor/validate", {
            "graph": self.valid_graph,
        })
        self.assertEqual(status, 200)
        self.assertTrue(res_valid["valid"])
        self.assertEqual(res_valid["errors"], [])
        self.assertTrue(res_valid["definition_hash"].startswith("sha256:"))

        # Invalid graph
        status, res_invalid = self.request("POST", "/api/editor/validate", {
            "graph": self.invalid_graph,
        })
        self.assertEqual(status, 200)
        self.assertFalse(res_invalid["valid"])
        self.assertGreater(len(res_invalid["errors"]), 0)

    def test_publish_api_http(self) -> None:
        # 1. Publish valid graph directly
        status, pub_res = self.request("POST", "/api/editor/publish", {
            "graph": self.valid_graph,
        })
        self.assertEqual(status, 200)
        self.assertEqual(pub_res["status"], "ok")
        self.assertEqual(pub_res["version"], 1)
        self.assertEqual(pub_res["graph_id"], self.valid_graph["graph_id"])

        # 2. Retrieve published graph over HTTP
        status, get_pub = self.request("GET", f"/api/editor/published/{self.valid_graph['graph_id']}?version=1")
        self.assertEqual(status, 200)
        self.assertEqual(get_pub["version"], 1)
        self.assertEqual(get_pub["definition_hash"], pub_res["definition_hash"])

        # 3. Publish invalid graph fails with 400
        status, err_res = self.request("POST", "/api/editor/publish", {
            "graph": self.invalid_graph,
        })
        self.assertEqual(status, 400)
        self.assertEqual(err_res["status"], "error")
        self.assertIn("errors", err_res)


if __name__ == "__main__":
    unittest.main()
