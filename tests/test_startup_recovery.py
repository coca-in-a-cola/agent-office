import dataclasses
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

from agent_office.workflow.bridge_port import FakeBridge
from agent_office.workflow.definitions import (
    NodeDefinition, Outcome, Target, Transition, WorkflowDefinition,
)
from agent_office.workflow.release_workflow import (
    RELEASE_WORKFLOW_NAME, build_release_workflow,
)
from agent_office.workflow.service import WorkflowService
from agent_office.workflow.storage import WorkflowRepository


class TestStartupRecovery(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.db_path = self.root / "workflow.sqlite3"
        self.bridge_path = self.root / "bridge.sqlite3"
        self.bridge = FakeBridge(self.bridge_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _create_old_v1_definition(self) -> WorkflowDefinition:
        curr = build_release_workflow(1)
        old_nodes = []
        for n in curr.nodes:
            if n.name == curr.start:
                old_nodes.append(dataclasses.replace(n, goal="Old historical v1 goal"))
            else:
                old_nodes.append(n)
        return WorkflowDefinition(
            name=RELEASE_WORKFLOW_NAME,
            version=1,
            start=curr.start,
            nodes=tuple(old_nodes),
            transitions=curr.transitions,
        )

    def test_startup_recovers_from_changed_canonical_and_second_startup_is_noop(self) -> None:
        repo = WorkflowRepository(self.db_path)
        old_v1 = self._create_old_v1_definition()
        with repo.transaction():
            old_hash = repo.register_definition(old_v1, now=100.0)
            repo.insert_run("run-old-v1", old_hash, {"goal": "old task"}, now=100.0)
        repo.close()

        current_canonical = build_release_workflow(1)
        self.assertNotEqual(old_hash, current_canonical.definition_hash)

        clock_time = 200.0
        service = WorkflowService(self.db_path, self.bridge, clock=lambda: clock_time,
                                  bridge_kind="fake")
        self.addCleanup(service.close)

        canonical_v2_hash = service.canonical_hash
        self.assertNotEqual(canonical_v2_hash, old_hash)

        defs_resp = service.list_definitions()
        self.assertEqual(len(defs_resp["definitions"]), 2)
        v2_meta = next(d for d in defs_resp["definitions"] if d["definition_hash"] == canonical_v2_hash)
        self.assertEqual(v2_meta["version"], 2)
        self.assertTrue(v2_meta["canonical"])

        v1_meta = next(d for d in defs_resp["definitions"] if d["definition_hash"] == old_hash)
        self.assertEqual(v1_meta["version"], 1)
        self.assertFalse(v1_meta["canonical"])

        run_detail = service.get_run("run-old-v1")
        self.assertEqual(run_detail["run"]["definition_hash"], old_hash)
        self.assertEqual(run_detail["run"]["definition_version"], 1)

        service.close()

        service2 = WorkflowService(self.db_path, self.bridge, clock=lambda: 300.0,
                                   bridge_kind="fake")
        self.addCleanup(service2.close)

        self.assertEqual(service2.canonical_hash, canonical_v2_hash)
        defs_resp2 = service2.list_definitions()
        self.assertEqual(len(defs_resp2["definitions"]), 2)
        service2.close()

    def test_concurrent_canonical_registration(self) -> None:
        repo = WorkflowRepository(self.db_path)
        old_v1 = self._create_old_v1_definition()
        with repo.transaction():
            repo.register_definition(old_v1, now=100.0)
        repo.close()

        canonical = build_release_workflow(1)
        results = []
        errors = []

        def worker() -> None:
            r = WorkflowRepository(self.db_path)
            try:
                with r.transaction():
                    h = r.register_canonical_definition(canonical, now=200.0)
                    results.append(h)
            except Exception as e:
                errors.append(e)
            finally:
                r.close()

        threads = [threading.Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        self.assertEqual(len(results), 5)
        self.assertTrue(all(h == results[0] for h in results))

    def test_explicit_register_definition_remains_strict(self) -> None:
        repo = WorkflowRepository(self.db_path)
        old_v1 = self._create_old_v1_definition()
        with repo.transaction():
            repo.register_definition(old_v1, now=100.0)

        diff_v1 = build_release_workflow(1)
        with self.assertRaises(sqlite3.IntegrityError):
            with repo.transaction():
                repo.register_definition(diff_v1, now=101.0)
        repo.close()


if __name__ == "__main__":
    unittest.main()
