"""Tycoon View projection: Workflow Core runs -> /api/state workstations.

A real HTTP server serves /api/state next to a WorkflowService wired to a
FakeBridge; tests start runs, drive Bridge task states and coordinator ticks,
and check what each office desk shows. No timers or mock loops are involved:
every desk state comes from persisted runs, attempts and gates.
"""

from __future__ import annotations

import unittest
from unittest import mock

from agent_office.storage import apply_workflow_projection
from agent_office.workflow import bridge_port as bp

try:  # discovered with -s tests (top-level) or imported as tests.*
    from test_server_workflow import ServerCase, WorkflowCase
    from test_workflow_engine import evidence
except ImportError:
    from tests.test_server_workflow import ServerCase, WorkflowCase
    from tests.test_workflow_engine import evidence

WORKFLOW_FIELDS = ("current_task", "active_task_id", "workflow_run_id", "workflow_node")


class TycoonCase(WorkflowCase):
    def start(self, run_id: str = "run-1", title: str = "Release Run 1") -> dict:
        return self.ok("POST", "/api/workflow/runs",
                       {"run_id": run_id, "inputs": {"goal": "ship X", "title": title,
                                                     "repo": "/tmp/sandbox"}},
                       status=201)

    def state(self) -> dict:
        return self.ok("GET", "/api/state")

    def desks(self) -> dict[str, dict]:
        return {a["id"]: a for a in self.state()["agents"]}

    def approve(self, run_id: str = "run-1") -> dict:
        scope = self.run_detail(run_id)["pending_gate"]["scope"]
        return self.ok("POST", f"/api/workflow/runs/{run_id}/approve",
                       {"approver": "owner", "scope": scope})

    def assert_idle(self, desk: dict) -> None:
        self.assertEqual(desk["status"], "idle", desk["id"])
        for key in WORKFLOW_FIELDS:
            self.assertIsNone(desk[key], f"{desk['id']}.{key}")
        self.assertIsNone(desk["workflow_assignment"])


class IdleOfficeTests(TycoonCase):
    def test_no_runs_means_every_desk_idle(self) -> None:
        data = self.state()
        self.assertEqual(data["meta"]["workflow_projection"], "ok")
        self.assertEqual(data["meta"]["workflow_assignments"], 0)
        for desk in data["agents"]:
            self.assert_idle(desk)


class WorkingProjectionTests(TycoonCase):
    def test_started_run_puts_coder_to_work_on_implementation(self) -> None:
        self.start()
        coder = self.desks()["coder"]
        self.assertEqual(coder["status"], "working")
        self.assertEqual(coder["current_task"], "Release Run 1 — implementation")
        self.assertEqual(coder["active_task_id"], "fake-task-1")
        self.assertEqual(coder["workflow_run_id"], "run-1")
        self.assertEqual(coder["workflow_node"], "implementation")
        assignment = coder["workflow_assignment"]
        self.assertEqual(assignment["attempt_id"], "run-1/implementation/1/1")
        self.assertEqual(assignment["attempt_status"], "submitted")
        self.assertEqual(assignment["role"], "implementer")
        self.assertEqual(assignment["run_status"], "running")
        # Bridge task id is the real one Workflow Core persisted for the attempt.
        self.assertEqual(self.bridge.tasks()[0]["task_id"], coder["active_task_id"])
        for desk_id in ("qa", "devops", "tyler", "artist"):
            self.assert_idle(self.desks()[desk_id])

    def test_goal_is_title_when_run_has_no_title(self) -> None:
        self.ok("POST", "/api/workflow/runs", {"run_id": "run-9", "goal": "ship Y"},
                status=201)
        self.assertEqual(self.desks()["coder"]["current_task"], "ship Y — implementation")

    def test_desks_follow_the_run_through_its_nodes(self) -> None:
        self.start()
        self.finish()
        desks = self.desks()
        self.assert_idle(desks["coder"])
        self.assertEqual(desks["qa"]["status"], "working")
        self.assertEqual(desks["qa"]["workflow_node"], "acceptance")
        self.assertEqual(desks["qa"]["active_task_id"], "fake-task-2")
        self.finish()
        desks = self.desks()
        self.assert_idle(desks["qa"])
        self.assertEqual(desks["devops"]["workflow_node"], "build")
        self.assertEqual(desks["devops"]["active_task_id"], "fake-task-3")
        self.finish()
        self.assertEqual(self.desks()["qa"]["workflow_node"], "artifact_check")

    def test_queued_attempt_before_bridge_ack_is_working_without_task_id(self) -> None:
        self.bridge.inject("submit_reject")
        self.start()
        coder = self.desks()["coder"]
        self.assertEqual(coder["status"], "working")
        self.assertIsNone(coder["active_task_id"])
        self.assertEqual(coder["workflow_assignment"]["attempt_status"], "pending")


class ApprovalProjectionTests(TycoonCase):
    def test_approval_wait_shows_review_on_publisher_and_manager(self) -> None:
        self.start()
        self.advance_to_gate()
        desks = self.desks()
        for desk_id, role in (("devops", "performer"), ("tyler", "approver")):
            desk = desks[desk_id]
            self.assertEqual(desk["status"], "review", desk_id)
            self.assertEqual(desk["workflow_node"], "publication")
            self.assertEqual(desk["workflow_run_id"], "run-1")
            self.assertEqual(desk["current_task"], "Release Run 1 — publication")
            self.assertEqual(desk["workflow_assignment"]["assignment"], role)
            self.assertEqual(desk["workflow_assignment"]["gate_id"],
                             "run-1/publication/1/gate")
            self.assertIsNone(desk["active_task_id"])  # no Bridge task until approved
        self.assert_idle(desks["qa"])

    def test_approval_moves_publisher_back_to_work(self) -> None:
        self.start()
        self.advance_to_gate()
        self.approve()
        desks = self.desks()
        self.assertEqual(desks["devops"]["status"], "working")
        self.assertEqual(desks["devops"]["active_task_id"], "fake-task-5")
        self.assert_idle(desks["tyler"])


class FailureProjectionTests(TycoonCase):
    def test_timed_out_attempt_blocks_the_desk_while_inspecting(self) -> None:
        self.start()
        self.bridge.set_state("fake-task-1", bp.FAILED, error="executor timed out")
        with self.service.lock:  # one tick: timeout applied, inspection not yet run
            self.service.coordinator.run_once()
        coder = self.desks()["coder"]
        self.assertEqual(coder["status"], "blocked")
        self.assertEqual(coder["workflow_assignment"]["run_status"], "inspecting")
        self.assertEqual(coder["workflow_assignment"]["attempt_status"], "timed_out")
        self.assertEqual(coder["active_task_id"], "fake-task-1")

    def test_exhausted_defect_loop_shows_defect(self) -> None:
        self.start()
        for _ in range(2):  # implementation max_iterations == 2
            self.finish(ev=dict(evidence("implementation"), verdict="defect"))
        coder = self.desks()["coder"]
        self.assertEqual(coder["status"], "defect")
        self.assertEqual(coder["workflow_assignment"]["run_status"], "blocked")
        self.assertEqual(coder["workflow_node"], "implementation")

    def test_exhausted_failures_show_blocked(self) -> None:
        self.start()
        for _ in range(2):  # implementation max_attempts == 2
            self.finish(state=bp.FAILED, error="executor crashed")
        coder = self.desks()["coder"]
        self.assertEqual(coder["status"], "blocked")
        self.assertEqual(coder["workflow_assignment"]["attempt_status"], "failed")
        self.assertIn("attempts exhausted", coder["workflow_assignment"]["status_reason"])

    def test_retry_after_block_returns_desk_to_work(self) -> None:
        self.start()
        for _ in range(2):
            self.finish(state=bp.FAILED, error="executor crashed")
        self.ok("POST", "/api/workflow/runs/run-1/retry", {"reason": "flaky"})
        coder = self.desks()["coder"]
        self.assertEqual(coder["status"], "working")
        self.assertEqual(coder["active_task_id"], "fake-task-3")


class TerminalProjectionTests(TycoonCase):
    def test_cancelled_run_frees_the_desk(self) -> None:
        self.start()
        self.ok("POST", "/api/workflow/runs/run-1/cancel", {})
        self.assert_idle(self.desks()["coder"])

    def test_completed_run_leaves_office_idle(self) -> None:
        self.start()
        self.advance_to_gate()
        self.approve()
        self.finish()  # publication
        self.finish()  # delivery
        self.assertEqual(self.run_detail()["run"]["status"], "completed")
        for desk in self.state()["agents"]:
            self.assert_idle(desk)

    def test_most_recently_updated_run_is_primary(self) -> None:
        self.start("run-1", "Release Run 1")
        self.clock.advance(5)
        self.start("run-2", "Release Run 2")
        coder = self.desks()["coder"]
        self.assertEqual(coder["workflow_run_id"], "run-2")
        self.assertEqual(coder["current_task"], "Release Run 2 — implementation")
        self.assertEqual([a["run_id"] for a in coder["workflow_assignments"]],
                         ["run-2", "run-1"])


class ProjectionResilienceTests(TycoonCase):
    def test_projection_failure_is_fail_open(self) -> None:
        self.start()
        with mock.patch.object(self.service, "workstation_assignments",
                               side_effect=RuntimeError("db locked")):
            data = self.state()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["meta"]["workflow_projection"], "error")
        self.assert_idle({a["id"]: a for a in data["agents"]}["coder"])

    def test_workflow_projection_overrides_hook_status(self) -> None:
        self.storage.register_or_update_agent(agent_id="coder", status="researching")
        self.assertEqual(self.desks()["coder"]["status"], "researching")
        self.start()
        self.assertEqual(self.desks()["coder"]["status"], "working")


class NoWorkflowTests(ServerCase):
    with_workflow = False

    def test_projection_disabled_without_workflow_service(self) -> None:
        code, data, _ = self.call("GET", "/api/state")
        self.assertEqual(code, 200)
        self.assertEqual(data["meta"]["workflow_projection"], "disabled")
        for desk in data["agents"]:
            self.assertIsNone(desk["workflow_run_id"])


class ApplyProjectionUnitTests(unittest.TestCase):
    def test_unknown_workstation_is_added_and_first_assignment_wins(self) -> None:
        agents = {"coder": {"id": "coder", "status": "idle"}}
        items = [
            {"workstation": "Translator", "status": "working", "current_task": "R — n",
             "task_id": "t-2", "run_id": "r2", "node": "n"},
            {"workstation": "translator", "status": "blocked", "current_task": "R — m",
             "task_id": "t-1", "run_id": "r1", "node": "m"},
        ]
        apply_workflow_projection(agents, items)
        self.assertEqual(agents["translator"]["status"], "working")
        self.assertEqual(agents["translator"]["active_task_id"], "t-2")
        self.assertEqual(len(agents["translator"]["workflow_assignments"]), 2)
        self.assertEqual(agents["coder"]["status"], "idle")
        self.assertIsNone(agents["coder"]["workflow_node"])


if __name__ == "__main__":
    unittest.main()
