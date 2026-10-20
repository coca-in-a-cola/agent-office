"""HTTP tests for the Process Studio workflow API (/api/workflow/*).

A real ThreadingHTTPServer serves a WorkflowService wired to a FakeBridge in
a temp directory; tests drive Bridge task states and coordinator ticks.
"""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error
import urllib.request

from agent_office.server import build_workflow_service, create_server
from agent_office.storage import OfficeStorage
from agent_office.workflow import bridge_port as bp
from agent_office.workflow.bridge_port import FakeBridge
from agent_office.workflow.release_workflow import RELEASE_STEPS
from agent_office.workflow.service import WorkflowService

try:  # discovered with -s tests (top-level) or imported as tests.*
    from test_workflow_engine import SHA1, Clock, evidence
except ImportError:
    from tests.test_workflow_engine import SHA1, Clock, evidence


class ServerCase(unittest.TestCase):
    with_workflow = True

    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.storage = OfficeStorage(db_path=self.root / "office.sqlite3")
        self.addCleanup(self.storage.close)
        static = self.root / "static"
        static.mkdir()
        (static / "index.html").write_text("<html>SPA</html>")
        self.service = None
        if self.with_workflow:
            self.clock = Clock()
            self.bridge = FakeBridge(self.root / "fake-bridge.sqlite3")
            self.service = WorkflowService(self.root / "workflow.sqlite3", self.bridge,
                                           clock=self.clock, bridge_kind="fake")
            self.addCleanup(self.service.close)
        self.server = create_server(host="127.0.0.1", port=0, storage=self.storage,
                                    static_dir=static, workflow=self.service)
        self.port = self.server.server_address[1]
        thread = threading.Thread(target=self.server.serve_forever,
                                  kwargs={"poll_interval": 0.02}, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method: str, path: str, body=None, raw: bytes | None = None):
        data = raw if raw is not None else (
            None if body is None else json.dumps(body).encode("utf-8"))
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data,
                                     method=method)
        req.add_header("Authorization", "Bearer trusted-local-token")
        req.add_header("X-Actor-ID", "owner")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, json.loads(resp.read()), resp.headers
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read()), err.headers

    def ok(self, method: str, path: str, body=None, status: int = 200):
        code, data, _ = self.call(method, path, body)
        self.assertEqual(code, status, data)
        return data

    def error(self, method: str, path: str, body=None, status: int = 400,
              contains: str = ""):
        code, data, _ = self.call(method, path, body)
        self.assertEqual(code, status, data)
        self.assertEqual(data["status"], "error")
        self.assertIn(contains, data["message"])
        return data


class WorkflowCase(ServerCase):
    def start(self, run_id: str = "run-1") -> dict:
        return self.ok("POST", "/api/workflow/runs",
                       {"run_id": run_id, "inputs": {"goal": "ship X",
                                                     "repo": "/tmp/sandbox"}},
                       status=201)

    def run_detail(self, run_id: str = "run-1") -> dict:
        return self.ok("GET", f"/api/workflow/runs/{run_id}")

    def finish(self, run_id: str = "run-1", state: str = bp.SUCCEEDED, ev=None,
               error: str = "") -> None:
        active = self.service.repo.active_attempt(run_id)
        self.assertIsNotNone(active)
        if ev is None and state == bp.SUCCEEDED:
            ev = evidence(active["node"], SHA1)
        self.bridge.set_state(active["task_id"], state, evidence=ev, error=error,
                              git_sha=SHA1)
        self.clock.advance(1)
        self.service.tick()

    def advance_to_gate(self, run_id: str = "run-1") -> dict:
        for _ in RELEASE_STEPS[:4]:
            self.finish(run_id)
        detail = self.run_detail(run_id)
        self.assertEqual(detail["run"]["status"], "waiting_approval")
        return detail


class DefinitionEndpointTests(WorkflowCase):
    def test_lists_canonical_release_definition(self) -> None:
        data = self.ok("GET", "/api/workflow/definitions")
        self.assertEqual(len(data["definitions"]), 1)
        item = data["definitions"][0]
        self.assertTrue(item["canonical"])
        self.assertEqual(item["name"], "software-release")
        self.assertEqual(item["node_count"], 6)
        self.assertEqual(item["definition_hash"], data["canonical_hash"])
        self.assertTrue(item["definition_hash"].startswith("sha256:"))

    def test_definition_detail_has_nodes_roles_and_transitions(self) -> None:
        digest = self.ok("GET", "/api/workflow/definitions")["canonical_hash"]
        data = self.ok("GET", f"/api/workflow/definitions/{digest}")
        self.assertEqual(data["definition_hash"], digest)
        self.assertEqual(data["node_order"], list(RELEASE_STEPS))
        self.assertEqual(data["roles"]["acceptance"], "independent_reviewer")
        self.assertEqual(len(data["nodes"]), 6)
        self.assertEqual(len(data["allowed_transitions"]), 6 * 7)
        self.assertIn({"source": "build", "outcome": "success",
                       "target": "artifact_check"}, data["allowed_transitions"])
        publication = next(n for n in data["nodes"] if n["name"] == "publication")
        self.assertTrue(publication["requires_approval"])

    def test_unknown_definition_is_404(self) -> None:
        self.error("GET", "/api/workflow/definitions/sha256:nope", status=404,
                   contains="unknown definition")


class RunLifecycleEndpointTests(WorkflowCase):
    def test_create_run_pins_definition_and_submits_to_bridge(self) -> None:
        data = self.start()
        run = data["run"]
        self.assertEqual(run["status"], "running")
        self.assertEqual(run["current_node"], "implementation")
        self.assertEqual(run["definition_hash"], self.service.canonical_hash)
        self.assertEqual(data["bridge"], "fake")
        current = data["current_attempt"]
        self.assertEqual(current["attempt_id"], "run-1/implementation/1/1")
        self.assertEqual(current["status"], "submitted")
        self.assertEqual(current["task_id"], "fake-task-1")
        self.assertEqual(data["node_states"]["implementation"]["state"], "running")
        self.assertEqual(data["node_states"]["build"]["state"], "pending")
        self.assertEqual([t["outcome"] for t in data["timeline"]], ["start"])
        self.assertTrue(data["actions"]["pause"])
        self.assertFalse(data["actions"]["approve"])

    def test_create_run_generates_id_and_accepts_top_level_goal(self) -> None:
        data = self.ok("POST", "/api/workflow/runs", {"goal": "ship Y"}, status=201)
        self.assertTrue(data["run"]["run_id"].startswith("run-"))
        self.assertEqual(data["run"]["inputs"]["goal"], "ship Y")

    def test_create_run_validation_errors(self) -> None:
        self.error("POST", "/api/workflow/runs", {"inputs": {}}, contains="goal")
        self.error("POST", "/api/workflow/runs", {"goal": "g", "run_id": "bad id!"},
                   contains="run_id")
        self.error("POST", "/api/workflow/runs", {"goal": "g", "inputs": []},
                   contains="inputs")
        self.error("POST", "/api/workflow/runs",
                   {"goal": "g", "definition_hash": "sha256:missing"}, status=404)
        code, data, _ = self.call("POST", "/api/workflow/runs", raw=b"{not json")
        self.assertEqual((code, data["status"]), (400, "error"))
        code, data, _ = self.call("POST", "/api/workflow/runs", raw=b"[1, 2]")
        self.assertEqual(code, 400)
        self.assertIn("object", data["message"])

    def test_duplicate_run_id_is_rejected(self) -> None:
        self.start()
        self.error("POST", "/api/workflow/runs", {"run_id": "run-1", "goal": "g"},
                   contains="already exists")

    def test_list_runs_with_summary(self) -> None:
        self.start("run-1")
        self.start("run-2")
        self.ok("POST", "/api/workflow/runs/run-2/cancel", {})
        data = self.ok("GET", "/api/workflow/runs")
        by_id = {r["run_id"]: r for r in data["runs"]}
        self.assertEqual(set(by_id), {"run-1", "run-2"})
        self.assertTrue(by_id["run-1"]["active"])
        self.assertFalse(by_id["run-2"]["active"])
        self.assertEqual(by_id["run-1"]["goal"], "ship X")
        self.assertEqual(by_id["run-1"]["definition_name"], "software-release")
        self.assertEqual(data["summary"], {"cancelled": 1, "running": 1})

    def test_unknown_run_is_404_for_get_and_commands(self) -> None:
        self.error("GET", "/api/workflow/runs/nope", status=404, contains="unknown run")
        for command in ("pause", "resume", "cancel", "approve", "retry"):
            self.error("POST", f"/api/workflow/runs/nope/{command}",
                       {"approver": "o", "scope": "s"}, status=404)

    def test_success_records_evidence_digests_and_timeline(self) -> None:
        self.start()
        self.finish()
        data = self.run_detail()
        self.assertEqual(data["run"]["current_node"], "acceptance")
        self.assertEqual(data["run"]["source_sha"], SHA1)
        self.assertEqual(data["node_states"]["implementation"]["state"], "succeeded")
        self.assertEqual(data["node_states"]["acceptance"]["state"], "running")
        digests = data["evidence_digests"]["run-1/implementation/1/1"]
        self.assertTrue(digests["patch"].startswith("sha256:"))
        first = data["attempts"][0]
        self.assertEqual(first["producer"], "implementer-a")
        self.assertEqual(first["receipts"][0]["disposition"], "applied")
        self.assertTrue(any(line["source"] == "bridge" for line in data["logs"]))
        self.assertEqual([t["outcome"] for t in data["timeline"]], ["start", "success"])


class PauseResumeEndpointTests(WorkflowCase):
    def test_pause_holds_advancement_until_resume(self) -> None:
        self.start()
        data = self.ok("POST", "/api/workflow/runs/run-1/pause",
                       {"actor": "owner", "reason": "debug"})
        self.assertTrue(data["run"]["paused"])
        self.assertTrue(data["actions"]["resume"])
        self.assertFalse(data["actions"]["pause"])
        self.assertTrue(self.ok("GET", "/api/workflow/runs")["runs"][0]["paused"])
        self.finish()
        self.assertEqual(self.run_detail()["run"]["current_node"], "implementation")
        data = self.ok("POST", "/api/workflow/runs/run-1/resume", {})
        self.assertFalse(data["run"]["paused"])
        self.assertEqual(data["run"]["current_node"], "acceptance")
        outcomes = [t["outcome"] for t in data["timeline"]]
        self.assertIn("paused", outcomes)
        self.assertIn("resumed", outcomes)

    def test_invalid_pause_and_resume_are_400(self) -> None:
        self.start()
        self.error("POST", "/api/workflow/runs/run-1/resume", {}, contains="not paused")
        self.ok("POST", "/api/workflow/runs/run-1/pause", {})
        self.error("POST", "/api/workflow/runs/run-1/pause", {}, contains="already")
        self.error("POST", "/api/workflow/runs/run-1/pause", {"actor": 5},
                   contains="actor")


class CancelEndpointTests(WorkflowCase):
    def test_cancel_goes_through_bridge(self) -> None:
        self.start()
        data = self.ok("POST", "/api/workflow/runs/run-1/cancel", {"reason": "stop"})
        self.assertEqual(data["run"]["status"], "cancelled")
        self.assertEqual(self.bridge.tasks()[0]["state"], bp.CANCELLED)
        self.assertIn("fake-task-1", self.bridge.calls("cancel"))
        self.assertEqual(data["node_states"]["implementation"]["state"], "cancelled")
        self.assertFalse(any(data["actions"].values()))
        self.error("POST", "/api/workflow/runs/run-1/cancel", {}, contains="finished")


class ApproveEndpointTests(WorkflowCase):
    def test_approval_gate_is_visible_and_satisfied(self) -> None:
        self.start()
        detail = self.advance_to_gate()
        self.assertEqual(detail["node_states"]["publication"]["state"], "approval_wait")
        self.assertTrue(detail["actions"]["approve"])
        gate = detail["pending_gate"]
        self.assertTrue(gate["scope"].startswith("publish:sha256:"))
        data = self.ok("POST", "/api/workflow/runs/run-1/approve",
                       {"approver": "owner", "scope": gate["scope"]})
        self.assertEqual(data["result"]["gate_id"], gate["gate_id"])
        self.assertEqual(data["result"]["attempt_id"], "run-1/publication/1/1")
        self.assertEqual(data["run"]["status"], "running")
        self.assertEqual(data["node_states"]["publication"]["state"], "running")
        self.assertEqual(data["gates"][-1]["approver"], "owner")

    def test_approval_requires_approver_and_matching_scope(self) -> None:
        self.start()
        self.error("POST", "/api/workflow/runs/run-1/approve",
                   {"approver": "owner", "scope": "publish:x"}, contains="no pending")
        gate = self.advance_to_gate()["pending_gate"]
        self.error("POST", "/api/workflow/runs/run-1/approve", {"scope": gate["scope"]},
                   contains="approver")
        self.error("POST", "/api/workflow/runs/run-1/approve", {"approver": "owner"},
                   contains="scope")
        self.error("POST", "/api/workflow/runs/run-1/approve",
                   {"approver": "owner", "scope": "publish:other"}, contains="scope")
        self.error("POST", "/api/workflow/runs/run-1/approve",
                   {"approver": "owner", "scope": gate["scope"], "gate_id": "x/gate"},
                   contains="does not belong")
        self.assertEqual(self.run_detail()["run"]["status"], "waiting_approval")


class RetryEndpointTests(WorkflowCase):
    def test_authorized_retry_after_exhausted_failures(self) -> None:
        self.start()
        self.finish(state=bp.FAILED, error="tests red")
        self.finish(state=bp.FAILED, error="tests red")
        detail = self.run_detail()
        self.assertEqual(detail["run"]["status"], "blocked")
        self.assertEqual(detail["node_states"]["implementation"]["state"], "failure")
        self.assertTrue(detail["actions"]["retry"])
        data = self.ok("POST", "/api/workflow/runs/run-1/retry",
                       {"actor": "owner", "reason": "flaky CI"})
        self.assertEqual(data["result"]["attempt_id"], "run-1/implementation/1/3")
        self.assertEqual(data["run"]["status"], "running")
        self.assertEqual(data["current_attempt"]["status"], "submitted")
        self.finish(state=bp.FAILED, error="tests red")
        self.error("POST", "/api/workflow/runs/run-1/retry", {}, contains="bound")

    def test_retry_rejected_when_not_blocked_or_bad_payload(self) -> None:
        self.start()
        self.error("POST", "/api/workflow/runs/run-1/retry", {}, contains="not blocked")
        self.error("POST", "/api/workflow/runs/run-1/retry",
                   {"confirm_side_effect": "yes"}, contains="boolean")

    def test_side_effecting_retry_needs_confirmation(self) -> None:
        self.start()
        gate = self.advance_to_gate()["pending_gate"]
        self.ok("POST", "/api/workflow/runs/run-1/approve",
                {"approver": "owner", "scope": gate["scope"]})
        self.finish(state=bp.FAILED, error="upload 500")
        self.error("POST", "/api/workflow/runs/run-1/retry", {}, contains="side-effecting")
        data = self.ok("POST", "/api/workflow/runs/run-1/retry",
                       {"confirm_side_effect": True})
        self.assertEqual(data["result"]["attempt_id"], "run-1/publication/1/2")


class NodeStateBadgeTests(WorkflowCase):
    def test_defect_and_timeout_badges(self) -> None:
        self.start()
        self.finish()
        self.finish(ev=dict(evidence("acceptance"), verdict="defect"))
        data = self.run_detail()
        self.assertEqual(data["node_states"]["acceptance"]["state"], "defect")
        self.assertEqual(data["node_states"]["implementation"]["iteration"], 2)
        self.assertTrue(data["node_states"]["implementation"]["is_current"])
        self.finish(state=bp.FAILED, error="executor timed out")
        data = self.run_detail()
        self.assertEqual(data["node_states"]["implementation"]["state"], "running")
        self.assertEqual(data["attempts"][-2]["status"], "timed_out")


class RoutingAndHeadersTests(WorkflowCase):
    def test_cors_headers_on_workflow_responses(self) -> None:
        _, _, headers = self.call("GET", "/api/workflow/runs")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])
        self.assertIn("application/json", headers["Content-Type"])
        _, _, headers = self.call("GET", "/api/workflow/runs/missing")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")

    def test_options_preflight_for_commands(self) -> None:
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/workflow/runs/run-1/pause", method="OPTIONS")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 204)
            self.assertIn("POST", resp.headers["Access-Control-Allow-Methods"])

    def test_unknown_routes_are_404_json(self) -> None:
        self.error("GET", "/api/workflow/unknown", status=404, contains="no workflow route")
        self.error("GET", "/api/workflow/runs/run-1/pause", status=404)
        self.error("POST", "/api/workflow/definitions", {}, status=404)
        self.error("POST", "/api/workflow/runs/run-1/explode", {}, status=404)
        self.error("POST", "/api/other", {}, status=404)

    def test_internal_errors_are_500_json(self) -> None:
        with mock.patch.object(self.service, "list_runs", side_effect=RuntimeError("boom")), \
                self.assertLogs("agent_office.server", "ERROR"):
            self.error("GET", "/api/workflow/runs", status=500, contains="boom")

    def test_existing_state_api_still_served(self) -> None:
        code, data, _ = self.call("GET", "/api/state")
        self.assertEqual(code, 200)
        self.assertIn("agents", data)


class WorkflowNotConfiguredTests(ServerCase):
    with_workflow = False

    def test_workflow_api_reports_503_without_service(self) -> None:
        self.error("GET", "/api/workflow/definitions", status=503,
                   contains="not configured")


class BuildServiceTests(unittest.TestCase):
    def test_default_wiring_uses_fake_bridge_and_registers_release(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = build_workflow_service(Path(tmp) / "nested" / "workflow.sqlite3")
            try:
                self.assertEqual(service.bridge_kind, "fake")
                self.assertTrue((Path(tmp) / "nested" / "workflow-fake-bridge.sqlite3")
                                .exists())
                self.assertEqual(len(service.list_definitions()["definitions"]), 1)
            finally:
                service.close()

    def test_background_coordinator_submits_without_requests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = build_workflow_service(Path(tmp) / "workflow.sqlite3")
            try:
                with service.lock:
                    service.engine.start_run("run-bg", service.canonical_hash,
                                             {"goal": "g"})
                service.start(interval=0.01)
                for _ in range(200):
                    if service.get_run("run-bg")["current_attempt"]["task_id"]:
                        break
                    threading.Event().wait(0.01)
                self.assertEqual(service.get_run("run-bg")["current_attempt"]["status"],
                                 "submitted")
            finally:
                service.close()


if __name__ == "__main__":
    unittest.main()
