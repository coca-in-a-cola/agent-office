"""Security regression tests for Agent Office workflow and Process Studio.

Covers:
1. Forged payload and header identities, unverified Basic auth, loopback assumption rejection.
2. Full Origin/CSRF policy with structured 403 handling.
3. Definition vs. Artifact grant separation (PublishDefinition must not authorize PublishArtifact).
4. Immutable EvidenceRef provenance, digest fingerprinting, and independent reviewer self-review denial.
5. Exact-intent approval bindings (run/version/target/digest/params, expiry, revocation).
6. Fail-closed side-effect lifecycle and zero Bridge dispatch on invalid/missing authorization.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from typing import Any, Mapping

from agent_office.editor.service import EditorService
from agent_office.server import create_server, ROLE_GRANTS, ACTOR_GRANTS
from agent_office.storage import OfficeStorage
from agent_office.workflow import bridge_port as bp
from agent_office.workflow.bridge_port import FakeBridge
from agent_office.workflow.definitions import (
    NodeDefinition, Outcome, Transition, WorkflowDefinition,
)
from agent_office.workflow.engine import ApprovalError, WorkflowEngine
from agent_office.workflow.release_workflow import build_release_workflow
from agent_office.workflow.service import WorkflowService
from agent_office.workflow.storage import (
    ApprovalRecord, EvidenceRef, RepositoryError, SideEffectRecord,
    WorkflowRepository, compute_evidence_fingerprint, compute_intent_hash,
)

try:
    from test_workflow_engine import SHA1, Clock, evidence
except ImportError:
    from tests.test_workflow_engine import SHA1, Clock, evidence


class SecurityTestBase(unittest.TestCase):
    """Base fixture creating isolated scratch DBs, FakeBridge, and test server."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)

        self.storage = OfficeStorage(db_path=self.root / "office.sqlite3")
        self.addCleanup(self.storage.close)

        static_dir = self.root / "static"
        static_dir.mkdir(parents=True, exist_ok=True)
        (static_dir / "index.html").write_text("<html>SPA</html>")

        self.clock = Clock()
        self.bridge = FakeBridge(self.root / "fake-bridge.sqlite3")
        self.workflow_db = self.root / "workflow.sqlite3"
        self.service = WorkflowService(
            self.workflow_db, self.bridge, clock=self.clock, bridge_kind="fake",
        )
        self.addCleanup(self.service.close)

        self.editor = EditorService(self.root / "editor.sqlite3")

        self.server = create_server(
            host="127.0.0.1",
            port=0,
            storage=self.storage,
            static_dir=static_dir,
            workflow=self.service,
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

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        headers: Mapping[str, str] | None = None,
    ) -> tuple[int, dict[str, Any], Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=data,
            method=method,
        )
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
                parsed = json.loads(raw.decode("utf-8")) if raw else {}
                return resp.status, parsed, resp.headers
        except urllib.error.HTTPError as err:
            raw = err.read()
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except Exception:
                parsed = {"status": "error", "message": raw.decode("utf-8", errors="replace")}
            return err.code, parsed, err.headers

    def start_test_run(self, run_id: str = "sec-run-1") -> dict[str, Any]:
        """Start a test workflow run using valid local auth."""
        headers = {
            "Origin": f"http://127.0.0.1:{self.port}",
            "X-Actor-ID": "tyler",
            "X-Actor-Role": "managing_director",
            "Authorization": "Bearer trusted-local-token",
        }
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs",
            {"run_id": run_id, "inputs": {"goal": "verify security", "repo": "/tmp/sec"}},
            headers=headers,
        )
        self.assertEqual(code, 201, data)
        return data


class TestHttpAuthAndGrants(SecurityTestBase):
    """Test identity validation, grant enforcement, and impersonation rejection."""

    def test_unverified_basic_auth_fails_closed(self) -> None:
        """Basic auth without password verification must never be treated as authenticated."""
        raw_creds = base64.b64encode(b"tyler:wrong-or-unverified").decode("ascii")
        headers = {
            "Authorization": f"Basic {raw_creds}",
            "Origin": f"http://127.0.0.1:{self.port}",
        }
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs",
            {"inputs": {"goal": "exploit basic"}},
            headers=headers,
        )
        # Must fail closed: either 401 unauthorized or 403 forbidden; not 201 created
        self.assertIn(code, (401, 403), f"Expected 401/403 for unverified basic auth, got {code}: {data}")
        self.assertEqual(data.get("status"), "error")

    def test_untrusted_header_privilege_escalation_rejected(self) -> None:
        """Client sending X-Actor-Role or X-Actor-Grants without trusted deployment token cannot elevate grants."""
        headers = {
            "Origin": f"http://127.0.0.1:{self.port}",
            "X-Actor-ID": "guest-user",
            "X-Actor-Role": "admin",
            "X-Actor-Grants": "publish_artifact,approve,admin",
        }
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs",
            {"inputs": {"goal": "privilege escalation attempt"}},
            headers=headers,
        )
        # Must fail closed: guest cannot create runs or perform admin actions
        self.assertIn(code, (401, 403), f"Expected 401/403 for forged headers, got {code}: {data}")

    def test_payload_impersonation_rejected(self) -> None:
        """Payload claiming an actor/approver different from verified request identity is rejected."""
        self.start_test_run("run-impersonate")

        # Advance to approval gate
        for _ in range(4):
            active = self.service.repo.active_attempt("run-impersonate")
            self.assertIsNotNone(active)
            ev = evidence(active["node"], SHA1)
            self.bridge.set_state(active["task_id"], bp.SUCCEEDED, evidence=ev, git_sha=SHA1)
            self.clock.advance(1)
            self.service.tick()

        detail = self.service.get_run("run-impersonate")
        self.assertEqual(detail["run"]["status"], "waiting_approval")
        gate = detail["pending_gate"]
        self.assertIsNotNone(gate)

        # Authenticate as operator, but claim in JSON payload approver='tyler'
        headers = {
            "Origin": f"http://127.0.0.1:{self.port}",
            "X-Actor-ID": "operator",
            "X-Actor-Role": "operator",
            "Authorization": "Bearer trusted-local-token",
        }
        payload = {
            "approver": "tyler",  # Forged approver payload
            "scope": gate["scope"],
            "gate_id": gate["gate_id"],
        }
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs/run-impersonate/approve",
            payload,
            headers=headers,
        )
        # Must reject payload impersonation: 403 forbidden
        self.assertEqual(code, 403, f"Expected 403 when payload approver mismatches verified actor, got {code}: {data}")
        self.assertEqual(data.get("status"), "error")

    def test_publish_definition_does_not_authorize_publish_artifact(self) -> None:
        """PublishDefinition grant must not authorize PublishArtifact."""
        # A user with role 'webdev' has publish_definition grant, but NOT publish_artifact or approve
        headers = {
            "Origin": f"http://127.0.0.1:{self.port}",
            "X-Actor-ID": "webdev",
            "X-Actor-Role": "webdev",
            "Authorization": "Bearer trusted-local-token",
        }

        # 1. Editor publish definition should succeed for webdev
        schema_path = Path(__file__).resolve().parent.parent / "schemas" / "valid-timeout-recovery.json"
        graph_def = json.loads(schema_path.read_text("utf-8"))
        code, data, _ = self.request(
            "POST",
            "/api/editor/publish",
            {"graph": graph_def},
            headers=headers,
        )
        self.assertEqual(code, 200, f"webdev should be allowed to publish definition, got {code}: {data}")
        self.assertEqual(data.get("type"), "definition")
        self.assertFalse(data.get("side_effects_authorized"))

        # 2. But webdev must NOT be allowed to approve or publish artifact
        self.start_test_run("run-artifact-sep")
        for _ in range(4):
            active = self.service.repo.active_attempt("run-artifact-sep")
            ev = evidence(active["node"], SHA1)
            self.bridge.set_state(active["task_id"], bp.SUCCEEDED, evidence=ev, git_sha=SHA1)
            self.clock.advance(1)
            self.service.tick()

        gate = self.service.get_run("run-artifact-sep")["pending_gate"]
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs/run-artifact-sep/approve",
            {"approver": "webdev", "scope": gate["scope"]},
            headers=headers,
        )
        self.assertEqual(code, 403, f"webdev must not have publish_artifact or approve grant, got {code}: {data}")
        self.assertEqual(data.get("status"), "error")

    def test_scoped_log_access_control(self) -> None:
        """Unauthenticated or guest callers cannot read sensitive task logs or monitor streams."""
        # Unauthenticated request for task log
        code, data, _ = self.request("GET", "/api/tasks/fake-task-1/log")
        self.assertIn(code, (401, 403), f"Expected 401/403 for unauthenticated log access, got {code}")


class TestCsrfEnforcement(SecurityTestBase):
    """Test full Origin/CSRF verification with structured 403 responses."""

    def test_cross_site_fetch_site_rejected(self) -> None:
        headers = {
            "Sec-Fetch-Site": "cross-site",
            "Origin": f"http://127.0.0.1:{self.port}",
            "Authorization": "Bearer trusted-local-token",
        }
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs",
            {"inputs": {"goal": "cross site attack"}},
            headers=headers,
        )
        self.assertEqual(code, 403)
        self.assertEqual(data.get("status"), "error")
        self.assertIn("CSRF", data.get("message", ""))

    def test_untrusted_origin_rejected_with_structured_403(self) -> None:
        headers = {
            "Origin": "http://malicious-site.example.com",
            "Authorization": "Bearer trusted-local-token",
        }
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs",
            {"inputs": {"goal": "untrusted origin attack"}},
            headers=headers,
        )
        self.assertEqual(code, 403)
        self.assertEqual(data.get("status"), "error")
        self.assertIn("untrusted origin", data.get("message", "").lower())

    def test_origin_port_mismatch_rejected(self) -> None:
        headers = {
            "Origin": f"http://127.0.0.1:{self.port + 1}",
            "Authorization": "Bearer trusted-local-token",
        }
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs",
            {"inputs": {"goal": "wrong port origin"}},
            headers=headers,
        )
        self.assertEqual(code, 403)
        self.assertEqual(data.get("status"), "error")

    def test_untrusted_referer_rejected(self) -> None:
        headers = {
            "Referer": "http://evil-tracker.example.com/steal",
            "Authorization": "Bearer trusted-local-token",
        }
        code, data, _ = self.request(
            "POST",
            "/api/workflow/runs",
            {"inputs": {"goal": "untrusted referer attack"}},
            headers=headers,
        )
        self.assertEqual(code, 403)
        self.assertEqual(data.get("status"), "error")
        self.assertIn("untrusted referer", data.get("message", "").lower())


class TestEvidenceRefAndIndependentReviewer(SecurityTestBase):
    """Test EvidenceRef provenance, fingerprint hash, and independent reviewer constraints."""

    def test_evidence_ref_fingerprint_computation(self) -> None:
        repo = self.service.repo
        now = 1700000000.0
        with repo.transaction():
            repo.insert_run("run-ev", self.service.canonical_hash, {"goal": "ev test"}, now)
            repo.insert_attempt("run-ev/impl/1/1", "run-ev", "implementation", 1, 1, "submitted", now)
            ev = repo.insert_evidence(
                run_id="run-ev",
                attempt_id="run-ev/impl/1/1",
                bridge_task_id="task-1",
                producer="coder-agent",
                role="implementer",
                input_sha="sha256:abc",
                output_digests={"code": "sha256:def"},
                criteria=["tests pass"],
                reviewer=None,
                now=now,
            )
            self.assertTrue(ev.fingerprint_hash.startswith("sha256:"))
            expected_fp = compute_evidence_fingerprint(
                run_id="run-ev",
                attempt_id="run-ev/impl/1/1",
                bridge_task_id="task-1",
                producer="coder-agent",
                role="implementer",
                input_sha="sha256:abc",
                output_digests={"code": "sha256:def"},
                criteria=("tests pass",),
                reviewer=None,
                created_at=now,
            )
            self.assertEqual(ev.fingerprint_hash, expected_fp)

    def test_evidence_ref_database_immutability(self) -> None:
        """Direct SQL UPDATE or DELETE on evidence_records table must be aborted by SQLite trigger."""
        repo = self.service.repo
        now = 1700000000.0
        with repo.transaction():
            repo.insert_run("run-imm", self.service.canonical_hash, {"goal": "imm test"}, now)
            repo.insert_attempt("run-imm/impl/1/1", "run-imm", "implementation", 1, 1, "submitted", now)
            ev = repo.insert_evidence(
                run_id="run-imm",
                attempt_id="run-imm/impl/1/1",
                bridge_task_id="task-1",
                producer="coder-agent",
                role="implementer",
                input_sha="sha256:abc",
                output_digests={},
                criteria=[],
                reviewer=None,
                now=now,
            )

        # Attempt direct SQL update
        with self.assertRaises(sqlite3.IntegrityError):
            repo.db.execute(
                "UPDATE evidence_records SET producer='hacked' WHERE evidence_id=?",
                (ev.evidence_id,),
            )

        # Attempt direct SQL delete
        with self.assertRaises(sqlite3.IntegrityError):
            repo.db.execute(
                "DELETE FROM evidence_records WHERE evidence_id=?",
                (ev.evidence_id,),
            )

    def test_self_review_denial(self) -> None:
        """Producer cannot act as independent reviewer for their own work."""
        repo = self.service.repo
        now = 1700000000.0
        with repo.transaction():
            repo.insert_run("run-self", self.service.canonical_hash, {"goal": "self review test"}, now)
            repo.insert_attempt("run-self/impl/1/1", "run-self", "implementation", 1, 1, "submitted", now)

            # 1. In repo: reviewer == producer must fail
            with self.assertRaises(RepositoryError):
                repo.insert_evidence(
                    run_id="run-self",
                    attempt_id="run-self/impl/1/1",
                    bridge_task_id="task-1",
                    producer="agent-smith",
                    role="independent_reviewer",
                    input_sha="sha256:abc",
                    output_digests={},
                    criteria=[],
                    reviewer="agent-smith",  # Same as producer!
                    now=now,
                )

        # 2. In engine: approver who produced prior work cannot approve independent acceptance
        self.start_test_run("run-self-engine")
        active = self.service.repo.active_attempt("run-self-engine")
        ev = dict(evidence("implementation", SHA1), producer="developer-bob")
        self.bridge.set_state(active["task_id"], bp.SUCCEEDED, evidence=ev, git_sha=SHA1)
        self.clock.advance(1)
        self.service.tick()

        # Implementation completed by developer-bob.
        # Advance to acceptance gate
        engine = self.service.engine
        run = repo.get_run("run-self-engine")
        definition = engine.definition_for(run)
        node = definition.node("acceptance")

        # Open acceptance gate
        with repo.transaction():
            repo.insert_gate(
                gate_id="run-self-engine/acceptance/1/gate",
                run_id="run-self-engine",
                node="acceptance",
                iteration=1,
                scope="acceptance:test",
                evidence_digest="sha256:digest",
                expires_at=self.clock() + 3600,
                now=self.clock(),
            )
            repo.update_run("run-self-engine", self.clock(), status="waiting_approval", current_node="acceptance")

        # developer-bob attempts to approve their own acceptance
        with self.assertRaises(ApprovalError):
            engine.approve("run-self-engine/acceptance/1/gate", approver="developer-bob", scope="acceptance:test")


class TestApprovalAndSideEffectBindings(SecurityTestBase):
    """Test approval exact-intent bindings, expiry, revocation, and digest tampering."""

    def test_approval_record_exact_intent_binding(self) -> None:
        repo = self.service.repo
        now = 1700000000.0
        with repo.transaction():
            repo.insert_run("run-intent", self.service.canonical_hash, {"goal": "intent"}, now)
            appr = repo.insert_approval_record(
                approval_id="appr-1",
                run_id="run-intent",
                version=1,
                target="publication",
                digest="sha256:approved-digest",
                params={"scope": "publish:test"},
                approver="tyler",
                granted_scope="publish:test",
                expiry_at=now + 3600,
                now=now,
            )
            self.assertEqual(appr.status, "active")
            expected_hash = compute_intent_hash(
                run_id="run-intent",
                version=1,
                target="publication",
                digest="sha256:approved-digest",
                params={"scope": "publish:test"},
            )
            self.assertEqual(appr.intent_hash, expected_hash)

            # active_approval_for_target matches exact intent
            matched = repo.active_approval_for_target("run-intent", "publication", "sha256:approved-digest", now)
            self.assertIsNotNone(matched)
            self.assertEqual(matched.approval_id, "appr-1")

    def test_tampered_digest_or_params_invalidates_approval(self) -> None:
        repo = self.service.repo
        now = 1700000000.0
        with repo.transaction():
            repo.insert_run("run-tamper", self.service.canonical_hash, {"goal": "tamper"}, now)
            repo.insert_approval_record(
                approval_id="appr-tamper",
                run_id="run-tamper",
                version=1,
                target="publication",
                digest="sha256:original-digest",
                params={"scope": "publish:test"},
                approver="tyler",
                granted_scope="publish:test",
                expiry_at=now + 3600,
                now=now,
            )

            # 1. Changed digest does not match
            self.assertIsNone(repo.active_approval_for_target("run-tamper", "publication", "sha256:changed-digest", now))

            # 2. Side effect transition to in_flight fails on digest mismatch
            repo.insert_attempt("run-tamper/pub/1/1", "run-tamper", "publication", 1, 1, "pending", now)
            se = repo.prepare_side_effect(
                effect_id="se-tamper",
                run_id="run-tamper",
                attempt_id="run-tamper/pub/1/1",
                approval_id="appr-tamper",
                target="publication",
                action_key="act-1",
                digest="sha256:tampered-digest",
                now=now,
            )
            with self.assertRaises(RepositoryError):
                repo.transition_side_effect("se-tamper", "in_flight", now)

    def test_expired_or_revoked_approval_fails_closed(self) -> None:
        repo = self.service.repo
        now = 1700000000.0
        with repo.transaction():
            repo.insert_run("run-exp", self.service.canonical_hash, {"goal": "exp"}, now)
            repo.insert_approval_record(
                approval_id="appr-exp",
                run_id="run-exp",
                version=1,
                target="publication",
                digest="sha256:exp-digest",
                params={},
                approver="tyler",
                granted_scope="pub",
                expiry_at=now + 100,
                now=now,
            )
            repo.insert_attempt("run-exp/pub/1/1", "run-exp", "publication", 1, 1, "pending", now)
            repo.prepare_side_effect(
                effect_id="se-exp",
                run_id="run-exp",
                attempt_id="run-exp/pub/1/1",
                approval_id="appr-exp",
                target="publication",
                action_key="act-exp",
                digest="sha256:exp-digest",
                now=now,
            )

            # At now + 200, approval has expired
            with self.assertRaises(RepositoryError):
                repo.transition_side_effect("se-exp", "in_flight", now + 200)

            # When revoked
            repo.insert_approval_record(
                approval_id="appr-rev",
                run_id="run-exp",
                version=1,
                target="publication",
                digest="sha256:rev-digest",
                params={},
                approver="tyler",
                granted_scope="pub",
                expiry_at=now + 3600,
                now=now,
            )
            repo.revoke_approval("appr-rev", now)
            repo.prepare_side_effect(
                effect_id="se-rev",
                run_id="run-exp",
                attempt_id="run-exp/pub/1/1",
                approval_id="appr-rev",
                target="publication",
                action_key="act-rev",
                digest="sha256:rev-digest",
                now=now,
            )
            with self.assertRaises(RepositoryError):
                repo.transition_side_effect("se-rev", "in_flight", now)


class TestZeroDispatchOnInvalidAuthorization(SecurityTestBase):
    """Test that Bridge dispatch NEVER occurs without verified exact-intent approval."""

    def test_missing_approval_blocks_bridge_dispatch(self) -> None:
        """When side-effecting node has no approval, Coordinator tick must dispatch zero tasks to Bridge."""
        repo = self.service.repo
        engine = self.service.engine
        coordinator = self.service.coordinator
        now = self.clock()

        # Create a run with a side-effecting publication attempt having approval_id=None
        with repo.transaction():
            repo.insert_run("run-zero", self.service.canonical_hash, {"goal": "zero dispatch"}, now)
            attempt_id = "run-zero/publication/1/1"
            repo.insert_attempt(attempt_id, "run-zero", "publication", 1, 1, "pending", now)
            # Side effect prepared WITHOUT approval_id
            repo.prepare_side_effect(
                effect_id=f"se-{attempt_id}",
                run_id="run-zero",
                attempt_id=attempt_id,
                approval_id=None,
                target="publication",
                action_key=f"act-{attempt_id}",
                digest="sha256:sample",
                now=now,
            )
            repo.insert_intent("run-zero", attempt_id, "submit", now)

        initial_submits = len(self.bridge.calls("submit"))

        # Run coordinator tick
        with self.assertRaises(Exception):
            coordinator.run_once()

        # Bridge must NOT have received any new submission
        current_submits = len(self.bridge.calls("submit"))
        self.assertEqual(
            current_submits,
            initial_submits,
            "Zero dispatch invariant violated: task was dispatched to Bridge without approval!",
        )

        # Attempt must not be marked 'submitted'
        attempt = repo.get_attempt(attempt_id)
        self.assertNotEqual(attempt["status"], "submitted")


if __name__ == "__main__":
    unittest.main()
