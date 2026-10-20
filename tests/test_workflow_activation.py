"""Focused regression tests for AO-NE-05 activation boundary (activation01).

Validates:
1. Durable per-run activation receipts and pinned input snapshots.
2. Invariant: Graph version and input snapshots remain strictly pinned and immutable.
3. Idempotent Bridge submission: Duplicate activations deduplicate and never submit a second concrete task.
4. Crash-before-submit recovery: Reconciles empty Bridge state, submits exactly one task.
5. Crash-after-submit recovery: Lost acknowledgement / crash before recording task_id reconciles without re-submitting.
6. Single authority for workflow-owned successor: Bridge submissions are exclusively driven by the activation boundary.
"""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from agent_office.workflow import bridge_port as bp
from agent_office.workflow.bridge_port import FakeBridge, SubmitRequest
from agent_office.workflow.coordinator import Coordinator
from agent_office.workflow.definitions import (
    NodeDefinition,
    Outcome,
    Target,
    Transition,
    WorkflowDefinition,
)
from agent_office.workflow.engine import WorkflowEngine
from agent_office.workflow.release_workflow import build_release_workflow
from agent_office.workflow.storage import WorkflowRepository
from agent_office.workflow.activation import (
    ActivationBoundary,
    ActivationReceipt,
    DuplicateActivationError,
    PinnedInvariantError,
)


def _build_test_workflow() -> WorkflowDefinition:
    nodes = (
        NodeDefinition(
            name="step1",
            role="coder",
            allowed_executors=("omo", "claude"),
            allowed_models=("antigravity/gemini-3.8-flash-high",),
            goal="run step 1",
            timeout_seconds=60,
        ),
        NodeDefinition(
            name="step2",
            role="qa",
            allowed_executors=("omo", "claude"),
            allowed_models=("antigravity/gemini-3.8-flash-high",),
            goal="verify step 1",
            timeout_seconds=60,
        ),
    )
    transitions = (
        Transition("step1", Outcome.SUCCESS, "step2"),
        Transition("step1", Outcome.FAILURE, Target.BLOCKED.value),
        Transition("step1", Outcome.TIMEOUT, Target.BLOCKED.value),
        Transition("step1", Outcome.DEFECT, Target.BLOCKED.value),
        Transition("step1", Outcome.CANCEL, Target.CANCELLED.value),
        Transition("step1", Outcome.QUOTA, Target.QUOTA_WAIT.value),
        Transition("step1", Outcome.APPROVAL_WAIT, Target.APPROVAL.value),
        Transition("step2", Outcome.SUCCESS, Target.COMPLETED.value),
        Transition("step2", Outcome.FAILURE, Target.BLOCKED.value),
        Transition("step2", Outcome.TIMEOUT, Target.BLOCKED.value),
        Transition("step2", Outcome.DEFECT, Target.BLOCKED.value),
        Transition("step2", Outcome.CANCEL, Target.CANCELLED.value),
        Transition("step2", Outcome.QUOTA, Target.QUOTA_WAIT.value),
        Transition("step2", Outcome.APPROVAL_WAIT, Target.APPROVAL.value),
    )
    return WorkflowDefinition(
        name="test-activation-wf",
        version=1,
        start="step1",
        nodes=nodes,
        transitions=transitions,
    )


class TestWorkflowActivationBoundary(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.db_path = self.root / "workflow.sqlite3"
        self.bridge_path = self.root / "bridge.sqlite3"

        self.repo = WorkflowRepository(self.db_path)
        self.bridge = FakeBridge(self.bridge_path)
        self.engine = WorkflowEngine(self.repo)
        self.wf = _build_test_workflow()
        self.def_hash = self.engine.register(self.wf)

        self.boundary = ActivationBoundary(self.repo, self.engine, self.bridge)

    def tearDown(self) -> None:
        self.repo.close()

    def test_durable_activation_receipt_and_input_snapshot_pinned(self) -> None:
        """Receipt is stored durably; input snapshot and definition_hash are pinned."""
        inputs = {"goal": "build feature", "repo": "agent-office", "working_dir": "/tmp/work"}
        run_id = "run-snap-01"
        self.engine.start_run(run_id, self.def_hash, inputs)

        receipt = self.boundary.record_activation(run_id, "step1", iteration=1, attempt_no=1)
        self.assertIsNotNone(receipt)
        self.assertEqual(receipt.run_id, run_id)
        self.assertEqual(receipt.node, "step1")
        self.assertEqual(receipt.iteration, 1)
        self.assertEqual(receipt.attempt_no, 1)
        self.assertEqual(receipt.definition_hash, self.def_hash)
        self.assertEqual(receipt.input_snapshot, inputs)
        self.assertEqual(receipt.idempotency_key, f"agent-office-workflow:{run_id}/step1/1/1")
        self.assertEqual(receipt.status, "activated")

        # Reload boundary from DB to confirm persistence
        loaded = self.boundary.get_activation(receipt.activation_id)
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(loaded.activation_id, receipt.activation_id)
        self.assertEqual(loaded.input_snapshot, inputs)
        self.assertEqual(loaded.definition_hash, self.def_hash)

        # Modifying inputs on the run or attempting mismatched definition fails
        with self.assertRaises(PinnedInvariantError):
            self.boundary.record_activation(
                run_id, "step1", iteration=1, attempt_no=2, definition_hash="sha256:tampered"
            )

    def test_duplicate_activation_returns_duplicate_and_submits_no_second_task(self) -> None:
        """Duplicate activation of the same node iteration attempt is idempotent."""
        inputs = {"goal": "test idempotency", "repo": "agent-office"}
        run_id = "run-dup-01"
        self.engine.start_run(run_id, self.def_hash, inputs)

        # First activation
        receipt1 = self.boundary.record_activation(run_id, "step1", iteration=1, attempt_no=1)
        self.assertEqual(receipt1.status, "activated")

        # Second activation with identical keys returns duplicate disposition
        receipt2 = self.boundary.record_activation(run_id, "step1", iteration=1, attempt_no=1)
        self.assertEqual(receipt2.status, "duplicate")
        self.assertEqual(receipt2.activation_id, receipt1.activation_id)

        # Submit task through boundary
        task_id = self.boundary.submit_or_reconcile(receipt1.activation_id)
        self.assertIsNotNone(task_id)
        self.assertEqual(len(self.bridge.tasks()), 1)

        # Calling submit_or_reconcile again does not create a second task
        task_id_dup = self.boundary.submit_or_reconcile(receipt2.activation_id)
        self.assertEqual(task_id_dup, task_id)
        self.assertEqual(len(self.bridge.tasks()), 1)

    def test_crash_before_submit_reconciles_and_submits_single_task(self) -> None:
        """Crash before submit: Bridge has no task; recovery submits exactly one task."""
        inputs = {"goal": "crash before submit", "repo": "agent-office"}
        run_id = "run-cbs-01"
        self.engine.start_run(run_id, self.def_hash, inputs)

        receipt = self.boundary.record_activation(run_id, "step1", iteration=1, attempt_no=1)
        self.assertIsNone(receipt.task_id)
        self.assertEqual(len(self.bridge.tasks()), 0)

        # Simulate process restart by reloading repository and boundary
        self.repo.close()
        self.repo = WorkflowRepository(self.db_path)
        self.engine = WorkflowEngine(self.repo)
        self.boundary = ActivationBoundary(self.repo, self.engine, self.bridge)

        task_id = self.boundary.submit_or_reconcile(receipt.activation_id)
        self.assertIsNotNone(task_id)
        self.assertEqual(len(self.bridge.tasks()), 1)

        updated_receipt = self.boundary.get_activation(receipt.activation_id)
        self.assertIsNotNone(updated_receipt)
        assert updated_receipt is not None
        self.assertEqual(updated_receipt.task_id, task_id)
        self.assertEqual(updated_receipt.status, "submitted")

    def test_crash_after_submit_reconciles_without_submitting_second_task(self) -> None:
        """Crash after submit: Bridge received task but local record was not updated.

        Recovery reconciles using idempotency key and does NOT invoke submit_task again.
        """
        inputs = {"goal": "crash after submit", "repo": "agent-office"}
        run_id = "run-cas-01"
        self.engine.start_run(run_id, self.def_hash, inputs)

        receipt = self.boundary.record_activation(run_id, "step1", iteration=1, attempt_no=1)

        # Pre-seed Bridge with task matching receipt's idempotency_key (simulating submit succeeded in Bridge)
        bridge_task_id = self.bridge.submit_task(
            SubmitRequest(
                idempotency_key=receipt.idempotency_key,
                title="[run-cas-01] step1 #1.1",
                goal="run step 1",
                repo="agent-office",
                working_dir=None,
                executor="omo",
                model="antigravity/gemini-3.8-flash-high",
                timeout_seconds=60,
            )
        )
        self.assertEqual(len(self.bridge.tasks()), 1)
        self.assertIsNone(self.boundary.get_activation(receipt.activation_id).task_id)

        # Clear Bridge call log to strictly monitor new submit calls
        submit_calls_before = len(self.bridge.calls("submit"))

        # Reconcile after crash
        reconciled_task_id = self.boundary.submit_or_reconcile(receipt.activation_id)
        self.assertEqual(reconciled_task_id, bridge_task_id)

        # Verify NO new submit calls were made
        submit_calls_after = len(self.bridge.calls("submit"))
        self.assertEqual(submit_calls_after, submit_calls_before)
        self.assertEqual(len(self.bridge.tasks()), 1)

        # Receipt now durably records the reconciled task_id
        persisted = self.boundary.get_activation(receipt.activation_id)
        self.assertIsNotNone(persisted)
        assert persisted is not None
        self.assertEqual(persisted.task_id, bridge_task_id)
        self.assertEqual(persisted.status, "submitted")

    def test_single_authority_for_workflow_owned_successor(self) -> None:
        """Successor task is generated exclusively by the workflow activation boundary through runtime dispatch."""
        inputs = {"goal": "single authority test", "repo": "agent-office"}
        run_id = "run-auth-01"
        self.engine.start_run(run_id, self.def_hash, inputs)

        coordinator = Coordinator(self.engine, self.bridge, boundary=self.boundary)
        coordinator.run_until_idle()
        self.assertEqual(len(self.bridge.tasks()), 1)

        receipt1 = self.boundary.get_activation(f"act:{run_id}:step1:1:1")
        assert receipt1 is not None
        task_id1 = receipt1.task_id
        assert task_id1 is not None

        # Complete step 1
        self.bridge.set_state(task_id1, bp.SUCCEEDED, exit_code=0)
        coordinator.run_until_idle()

        # Step 2 activation via workflow authority
        self.assertEqual(len(self.bridge.tasks()), 2)
        receipt2 = self.boundary.get_activation(f"act:{run_id}:step2:1:1")
        assert receipt2 is not None
        task_id2 = receipt2.task_id
        assert task_id2 is not None
        self.assertNotEqual(task_id1, task_id2)

        # Verify both tasks carry distinct deterministic idempotency keys
        tasks = self.bridge.tasks()
        self.assertEqual(
            {t["idempotency_key"] for t in tasks},
            {f"agent-office-workflow:{run_id}/step1/1/1", f"agent-office-workflow:{run_id}/step2/1/1"},
        )

    def test_normal_runtime_dispatch_creates_durable_receipt_and_submits_single_task(self) -> None:
        """Normal runtime dispatch through Coordinator creates durable receipt and submits single task."""
        inputs = {"goal": "normal dispatch", "repo": "agent-office", "working_dir": "/tmp/test"}
        run_id = "run-dispatch-01"
        self.engine.start_run(run_id, self.def_hash, inputs)

        coordinator = Coordinator(self.engine, self.bridge)
        reports = coordinator.run_until_idle()
        self.assertTrue(any(r.submitted > 0 for r in reports))

        # Check durable activation receipt
        receipt = coordinator.boundary.get_activation(f"act:{run_id}:step1:1:1")
        self.assertIsNotNone(receipt)
        assert receipt is not None
        self.assertEqual(receipt.status, "submitted")
        self.assertEqual(receipt.definition_hash, self.def_hash)
        self.assertEqual(receipt.input_snapshot, inputs)
        self.assertEqual(receipt.idempotency_key, f"agent-office-workflow:{run_id}/step1/1/1")
        self.assertIsNotNone(receipt.task_id)

        # Check exactly one task in Bridge
        tasks = self.bridge.tasks()
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["task_id"], receipt.task_id)

        # Check role and model are preserved
        req = json.loads(tasks[0]["request_json"])
        self.assertEqual(req["executor"], "omo")
        self.assertEqual(req["model"], "antigravity/gemini-3.8-flash-high")
        self.assertIn("step 1", req["goal"])

    def test_runtime_dispatch_restart_and_lost_ack_reconciles_without_second_task(self) -> None:
        """Runtime dispatch with lost ack reconciles existing Bridge task without submitting duplicate."""
        inputs = {"goal": "restart lost ack", "repo": "agent-office"}
        run_id = "run-restart-01"
        self.engine.start_run(run_id, self.def_hash, inputs)

        idempotency_key = f"agent-office-workflow:{run_id}/step1/1/1"
        pre_task_id = self.bridge.submit_task(
            SubmitRequest(
                idempotency_key=idempotency_key,
                title="[run-restart-01] step1 #1.1",
                goal="run step 1",
                repo="agent-office",
                working_dir=None,
                executor="omo",
                model="antigravity/gemini-3.8-flash-high",
                timeout_seconds=60,
                acceptance_criteria=(),
                constraints=("role: coder",),
            )
        )
        self.assertEqual(len(self.bridge.tasks()), 1)

        coordinator = Coordinator(self.engine, self.bridge)
        reports = coordinator.run_until_idle()

        # Exactly one task exists in Bridge (no duplicate created)
        self.assertEqual(len(self.bridge.tasks()), 1)
        receipt = coordinator.boundary.get_activation(f"act:{run_id}:step1:1:1")
        self.assertIsNotNone(receipt)
        assert receipt is not None
        self.assertEqual(receipt.task_id, pre_task_id)
        self.assertEqual(receipt.status, "submitted")

        # Engine attempt reflects the reconciled task_id
        attempt = self.repo.get_attempt(f"{run_id}/step1/1/1")
        self.assertEqual(attempt["task_id"], pre_task_id)

    def test_runtime_dispatch_duplicate_event_and_completion_idempotent(self) -> None:
        """Completed task advances cleanly; duplicate event/ticks do not create duplicate tasks."""
        inputs = {"goal": "duplicate completion test", "repo": "agent-office"}
        run_id = "run-dup-comp-01"
        self.engine.start_run(run_id, self.def_hash, inputs)

        coordinator = Coordinator(self.engine, self.bridge)
        coordinator.run_until_idle()

        # Step 1 task submitted
        self.assertEqual(len(self.bridge.tasks()), 1)
        task1 = self.bridge.tasks()[0]
        task_id1 = task1["task_id"]

        # Complete step 1 in Bridge
        self.bridge.set_state(task_id1, bp.SUCCEEDED, exit_code=0)
        coordinator.run_until_idle()

        # Workflow advances to step 2; exactly 2 tasks across both steps
        tasks = self.bridge.tasks()
        self.assertEqual(len(tasks), 2)
        task_id2 = [t["task_id"] for t in tasks if t["task_id"] != task_id1][0]

        receipt2 = coordinator.boundary.get_activation(f"act:{run_id}:step2:1:1")
        self.assertIsNotNone(receipt2)
        assert receipt2 is not None
        self.assertEqual(receipt2.task_id, task_id2)

        # Duplicate ticks or events produce no additional tasks
        coordinator.run_until_idle()
        self.assertEqual(len(self.bridge.tasks()), 2)

    def test_runtime_dispatch_scratch_native_bridge_sandbox(self) -> None:
        """Runtime dispatch through native TaskBridge in scratch sandbox verifies single concrete task."""
        import sys
        stage2_src = Path("/home/tyler/workspaces/stage2-infra/src")
        if str(stage2_src) not in sys.path:
            sys.path.append(str(stage2_src))
        from task_bridge.bridge import TaskBridge
        from task_bridge.wake import ManagerWakeDispatcher

        sandbox = self.root / "native_bridge_sandbox"
        sandbox.mkdir(parents=True, exist_ok=True)
        native_bridge = TaskBridge(
            db_path=sandbox / "tasks.db",
            base_workdir=sandbox / "work",
            outbox_dir=sandbox / "outbox",
            artifacts_dir=sandbox / "artifacts",
        )
        native_bridge.wake_dispatcher = ManagerWakeDispatcher(
            native_bridge.storage,
            runner=lambda cmd: (0, "", ""),
        )
        native_bridge.defer_wake_dispatch = True
        native_adapter = bp.TaskBridgeAdapter(native_bridge)

        native_repo_path = self.root / "native_workflow.sqlite3"
        native_repo = WorkflowRepository(native_repo_path)
        self.addCleanup(native_repo.close)
        native_engine = WorkflowEngine(native_repo)
        native_def_hash = native_engine.register(self.wf)

        native_coordinator = Coordinator(native_engine, native_adapter)
        run_id = "run-native-01"
        inputs = {"goal": "test native bridge", "repo": "agent-office", "working_dir": str(sandbox / "work")}
        native_engine.start_run(run_id, native_def_hash, inputs)

        native_coordinator.run_until_idle()

        # Verify durable receipt exists in activation_receipts table
        receipt = native_coordinator.boundary.get_activation(f"act:{run_id}:step1:1:1")
        self.assertIsNotNone(receipt)
        assert receipt is not None
        self.assertEqual(receipt.status, "submitted")
        self.assertEqual(receipt.definition_hash, native_def_hash)
        self.assertEqual(receipt.input_snapshot, inputs)
        self.assertIsNotNone(receipt.task_id)

        # Verify native bridge contains exactly one task
        tasks = native_bridge.list_tasks()
        self.assertEqual(len(tasks), 1)
        task = native_bridge.get_task(receipt.task_id)
        assert task is not None
        self.assertEqual(task.id, receipt.task_id)
        self.assertEqual(task.idempotency_key, f"agent-office-workflow:{run_id}/step1/1/1")
        self.assertEqual(task.executor, "omo")
        self.assertEqual(task.requested_model, "antigravity/gemini-3.8-flash-high")
        self.assertEqual(task.role, "coder")


if __name__ == "__main__":
    unittest.main()
