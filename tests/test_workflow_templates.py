"""Registered Process Studio blueprint contracts and HTTP catalog."""
import unittest

try:
    from test_server_workflow import ServerCase
except ImportError:
    from tests.test_server_workflow import ServerCase


class WorkflowTemplatesCase(ServerCase):
    def test_catalog_http_and_registered_definitions(self):
        templates = self.ok("GET", "/api/workflow/templates")
        self.assertEqual({t["template_id"] for t in templates}, {
            "project-feature-lifecycle", "hotfix-fast-patch", "software-release"})
        self.assertEqual(templates, self.service.list_templates())
        registered = {d["definition_hash"] for d in
                      self.service.list_definitions()["definitions"]}
        for template in templates:
            self.assertIn(template["definition_hash"], registered)
            definition = self.ok("GET", "/api/workflow/definitions/" +
                                 template["definition_hash"])
            self.assertEqual(definition["nodes"], template["nodes"])

    def test_scopes_and_mandatory_publication(self):
        for template in self.service.list_templates():
            with self.subTest(template=template["name"]):
                nodes = template["nodes"]
                self.assertTrue(all(n["input_scope"] in
                                    {"project", "task", "batch"} for n in nodes))
                gates = [n for n in nodes if n["is_mandatory_publication"]]
                self.assertTrue(gates)
                for gate in gates:
                    self.assertTrue(gate["requires_approval"])
                    self.assertTrue(gate["side_effecting"])
                    self.assertTrue(gate["approval_scope"])
                # No successful route from the start to completion may bypass a gate.
                gate_names = {n["name"] for n in gates}
                pending, seen = [template["start"]], set()
                while pending:
                    node = pending.pop()
                    if node in seen or node in gate_names:
                        continue
                    self.assertNotEqual(node, "@completed")
                    seen.add(node)
                    pending.extend(t["target"] for t in template["allowed_transitions"]
                                   if t["source"] == node)
        feature = next(t for t in self.service.list_templates()
                       if t["name"] == "project-feature-lifecycle")
        scopes = {n["name"]: n["input_scope"] for n in feature["nodes"]}
        self.assertEqual(scopes["project_intake"], "project")
        self.assertEqual(scopes["task_implementation"], "task")
        self.assertEqual(scopes["task_acceptance"], "task")
        self.assertEqual(scopes["publish_release"], "project")

    def test_catalog_restart_is_idempotent(self):
        from agent_office.workflow.service import WorkflowService
        before = self.service.list_templates()
        other = WorkflowService(self.root / "workflow.sqlite3", self.bridge,
                                clock=self.clock)
        self.addCleanup(other.close)
        self.assertEqual(before, other.list_templates())


if __name__ == "__main__":
    unittest.main()
