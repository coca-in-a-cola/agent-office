"""Operator controls on Workflow Core: pause/resume and authorized retry."""

from __future__ import annotations

import unittest

from agent_office.workflow import bridge_port as bp
from agent_office.workflow.engine import ControlError

try:  # discovered with -s tests (top-level) or imported as tests.*
    from test_workflow_engine import SHA2, EngineCase, evidence
except ImportError:
    from tests.test_workflow_engine import SHA2, EngineCase, evidence


class PauseResumeTests(EngineCase):
    def test_paused_run_is_not_submitted_until_resumed(self) -> None:
        self.h.engine.start_run("run-1", self.v1, {"goal": "g", "repo": "/tmp/r"})
        self.h.engine.pause_run("run-1", "owner", "inspect graph")
        self.h.tick()
        self.assertEqual(self.h.bridge.tasks(), [])
        self.assertEqual(self.h.active()["status"], "pending")
        self.h.engine.resume_run("run-1", "owner")
        self.h.tick()
        self.assertEqual(self.h.active()["status"], "submitted")
        outcomes = [t["outcome"] for t in self.h.repo.transitions("run-1")]
        self.assertIn("paused", outcomes)
        self.assertIn("resumed", outcomes)

    def test_paused_run_does_not_observe_bridge_outcome(self) -> None:
        self.start()
        self.h.engine.pause_run("run-1", "owner")
        self.h.finish()
        self.assertEqual(self.h.active()["node"], "implementation")
        self.h.engine.resume_run("run-1", "owner")
        self.h.tick()
        self.assertEqual(self.h.active()["node"], "acceptance")

    def test_pause_only_affects_its_own_run(self) -> None:
        self.start("run-1")
        self.start("run-2")
        self.h.engine.pause_run("run-1", "owner")
        self.h.finish("run-2")
        self.assertEqual(self.h.active("run-2")["node"], "acceptance")

    def test_cancel_reaches_bridge_while_paused(self) -> None:
        self.start()
        self.h.engine.pause_run("run-1", "owner")
        self.h.engine.request_cancel("run-1", "stop")
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "cancelled")
        self.assertEqual(self.h.bridge.tasks()[0]["state"], bp.CANCELLED)

    def test_invalid_pause_resume_fail_closed(self) -> None:
        self.start()
        with self.assertRaises(ControlError):
            self.h.engine.resume_run("run-1", "owner")
        self.h.engine.pause_run("run-1", "owner")
        with self.assertRaises(ControlError):
            self.h.engine.pause_run("run-1", "owner")
        self.h.engine.request_cancel("run-1", "stop")
        self.h.tick()
        self.h.engine.resume_run("run-1", "owner")
        with self.assertRaises(ControlError):
            self.h.engine.pause_run("run-1", "owner")


class AuthorizedRetryTests(EngineCase):
    def exhaust(self) -> None:
        self.start()
        self.h.finish(state=bp.FAILED, error="tests red")
        self.h.finish(state=bp.FAILED, error="tests red")
        self.assertEqual(self.h.run()["status"], "blocked")

    def test_retry_reopens_failed_node_once(self) -> None:
        self.exhaust()
        attempt_id = self.h.engine.authorize_retry("run-1", "owner", "flaky CI")
        self.assertEqual(attempt_id, "run-1/implementation/1/3")
        self.h.tick()
        self.assertEqual(self.h.run()["status"], "running")
        self.h.finish()
        self.assertEqual(self.h.active()["node"], "acceptance")
        journal = [t for t in self.h.repo.transitions("run-1")
                   if t["outcome"] == "retry_authorized"]
        self.assertEqual(len(journal), 1)
        self.assertIn("owner", journal[0]["reason"])

    def test_retry_is_bounded(self) -> None:
        self.exhaust()
        self.h.engine.authorize_retry("run-1", "owner")
        self.h.tick()
        self.h.finish(state=bp.FAILED, error="tests red")
        self.assertEqual(self.h.run()["status"], "blocked")
        with self.assertRaisesRegex(ControlError, "bound reached"):
            self.h.engine.authorize_retry("run-1", "owner")

    def test_retry_requires_blocked_failure(self) -> None:
        self.start()
        with self.assertRaisesRegex(ControlError, "not blocked"):
            self.h.engine.authorize_retry("run-1", "owner")
        self.advance_to("acceptance")
        self.h.finish(ev=dict(evidence("acceptance"), verdict="defect"))
        self.h.finish(sha=SHA2)
        self.h.finish(ev=dict(evidence("acceptance", SHA2), verdict="defect"))
        self.assertEqual(self.h.run()["status"], "blocked")
        with self.assertRaisesRegex(ControlError, "not failed"):
            self.h.engine.authorize_retry("run-1", "owner")

    def test_side_effecting_retry_needs_confirmation(self) -> None:
        self.start()
        self.advance_to("publication")
        self.h.finish(state=bp.FAILED, error="upload 500")
        self.assertEqual(self.h.run()["status"], "blocked")
        with self.assertRaisesRegex(ControlError, "side-effecting"):
            self.h.engine.authorize_retry("run-1", "owner")
        self.h.engine.authorize_retry("run-1", "owner", "receipt absent",
                                      confirm_side_effect=True)
        self.h.tick()
        self.assertEqual(self.nodes_submitted().count("publication"), 2)

    def test_unconfirmed_submission_is_not_retried(self) -> None:
        self.h.engine.start_run("run-1", self.v1, {"goal": "g", "repo": "/tmp/r"})
        self.h.bridge.inject(*["submit_reject"] * 4)
        for _ in range(4):
            self.h.tick()
            self.clock.advance(10)
        self.assertEqual(self.h.run()["status"], "blocked")
        with self.assertRaisesRegex(ControlError, "reconcile"):
            self.h.engine.authorize_retry("run-1", "owner")


if __name__ == "__main__":
    unittest.main()
