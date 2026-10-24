"""Resolver contract tests only: no native child launches or live activation."""
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import agent_office
from agent_office.delegation_plugin import OfficeRouteResolutionError, make_office_route_resolver
from agent_office.storage import OfficeStorage
import agent_office.storage as storage_module


class LegacyContext:
    strict_hermes = True

    def __init__(self):
        self.hooks = {}

    def register_hook(self, name, callback):
        self.hooks[name] = callback
        return name


class RoutingContext(LegacyContext):
    def register_delegation_route_resolver(self, resolver):
        self.resolver = resolver


class TestDelegationPlugin(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db_path = Path(self.directory.name) / "office.sqlite3"
        self.storage = OfficeStorage(self.db_path)
        self.storage.register_or_update_agent("employee-7", role="engineer", last_seen_at=0)
        self.models = [
            {"provider": "custom:alpha", "model": "Model-A"},
            {"provider": "openai-codex", "model": "Model-B"},
            {"provider": "custom:beta", "model": "Model-C"},
        ]
        self.storage.set_agent_policy("employee-7", self.models, "priority")
        self.resolver = make_office_route_resolver(self.storage)
        self.request = SimpleNamespace(employee_id="employee-7", role="untrusted-role", session_id="session-1")

    def tearDown(self):
        self.storage.close()
        self.directory.cleanup()

    def test_saved_priority_exact_detached_payload_and_role_unchanged(self):
        before = self.storage.get_agent("employee-7")
        expected = {
            "provider": "custom:alpha", "model": "Model-A",
            "fallback_providers": self.models[1:],
            "employee_id": "employee-7", "policy_revision": before["policy_revision"],
        }
        self.assertEqual(self.resolver(self.request), expected)
        self.assertEqual(self.storage.get_agent("employee-7"), before)
        self.assertEqual(before["role"], "engineer")
        result = self.resolver(self.request)
        assert result is not None
        result["fallback_providers"].clear()
        self.assertEqual(self.resolver(self.request), expected)
        # Prove policy persistence independently of this connection.
        reopened = OfficeStorage(self.db_path)
        try:
            self.assertEqual(make_office_route_resolver(reopened)(self.request), expected)
        finally:
            reopened.close()

    def test_unbound_is_inactive_even_with_matching_role(self):
        storage = Mock()
        resolve = make_office_route_resolver(storage)
        self.assertIsNone(resolve(None))
        self.assertIsNone(resolve(SimpleNamespace(employee_id=None, role="engineer", session_id="s")))
        storage.get_agent.assert_not_called()

    def test_missing_or_malformed_binding_denies(self):
        for employee_id in ("absent-employee", "", " employee-7", 7):
            with self.subTest(employee_id=employee_id):
                with self.assertRaises(OfficeRouteResolutionError):
                    self.resolver(SimpleNamespace(employee_id=employee_id))

    def test_missing_empty_invalid_and_round_robin_policy_deny(self):
        self.storage.register_or_update_agent("unconfigured", role="engineer")
        with self.assertRaises(OfficeRouteResolutionError):
            self.resolver(SimpleNamespace(employee_id="unconfigured"))
        for models, strategy in (([], "priority"), (self.models, "round_robin"),
                                 ([{"provider": "bad secret-value", "model": "Model-A"}], "priority")):
            with self.subTest(strategy=strategy, models=models):
                self.storage.set_agent_policy("employee-7", models, strategy)
                with self.assertRaises(OfficeRouteResolutionError) as caught:
                    self.resolver(self.request)
                self.assertNotIn("secret-value", str(caught.exception))
                self.assertTrue(caught.exception.__suppress_context__)

    def test_outputs_and_errors_never_include_credentials_or_request_extras(self):
        policy = self.storage.get_agent("employee-7")
        policy["credentials_cfg"] = {"api_key": "sensitive-token", "nested": {"private": "sensitive-token"}}
        resolve = make_office_route_resolver(SimpleNamespace(get_agent=lambda _: policy))
        with self.assertNoLogs("agent_office", level="DEBUG"):
            self.assertNotIn("sensitive-token", json.dumps(resolve(self.request)))
        broken = Mock()
        broken.get_agent.side_effect = RuntimeError("sensitive-token")
        with self.assertNoLogs("agent_office", level="DEBUG"):
            with self.assertRaisesRegex(OfficeRouteResolutionError, "^Office delegation policy unavailable or invalid[.]$"):
                make_office_route_resolver(broken)(self.request)
        # Only the binding is read, never role, prompt, credentials, or parent.
        class MinimalRequest:
            employee_id = "employee-7"

            def __getattr__(self, name):
                raise AssertionError("unexpected request access")
        minimal_result = resolve(MinimalRequest())
        assert minimal_result is not None
        self.assertEqual(minimal_result["employee_id"], "employee-7")

    def test_isolated_sdk_accepts_payload_and_denies_selected_failure(self):
        try:
            from hermes_cli.delegation_routing import (
                DelegationRoutingDenialError, RouteRequest, resolve_delegation_route,
            )
        except ImportError:
            self.skipTest("isolated Hermes routing SDK not on PYTHONPATH")
        request = RouteRequest(session_id="session-1", employee_id="employee-7", role="untrusted-role")
        self.assertEqual(resolve_delegation_route([self.resolver], request), self.resolver(request))
        self.assertIsNone(resolve_delegation_route([self.resolver], RouteRequest(session_id="session-1")))
        with self.assertRaises(DelegationRoutingDenialError):
            resolve_delegation_route([self.resolver], RouteRequest(session_id="session-1", employee_id="absent-employee"))

    def test_registration_uses_operator_default_storage(self):
        ctx = RoutingContext()
        # Real default storage factory, isolated environment and singleton state.
        with patch.dict(os.environ, {"AGENT_OFFICE_DB_PATH": str(self.db_path)}), \
             patch.object(storage_module, "_GLOBAL_STORAGE", None), \
             patch.object(agent_office, "get_default_sink") as sink:
            result = agent_office.register(ctx)
            selected_storage = storage_module.get_default_storage()
            try:
                self.assertEqual(storage_module.get_default_db_path(), self.db_path)
                self.assertEqual(ctx.resolver(self.request), self.resolver(self.request))
                sink.return_value.attach.assert_called_once_with()
                self.assertTrue(result["capabilities"]["delegation_route_resolver"])
                self.assertEqual(len(ctx.hooks), 6)
            finally:
                selected_storage.close()

    def test_old_sdk_retains_telemetry_and_reports_routing_inactive(self):
        ctx = LegacyContext()
        with patch.object(agent_office, "get_default_sink") as sink, \
             patch.object(agent_office, "get_default_storage") as get_storage:
            sink.return_value.attach.side_effect = OSError("telemetry unavailable")
            result = agent_office.register(ctx)
            self.assertEqual(len(ctx.hooks), 6)
            self.assertFalse(result["capabilities"]["delegation_route_resolver"])
            get_storage.assert_not_called()

    def test_sdk_registration_failure_not_swallowed(self):
        ctx = RoutingContext()
        ctx.register_delegation_route_resolver = Mock(side_effect=RuntimeError("registration failed"))
        with patch.object(agent_office, "get_default_sink"), \
             patch.object(agent_office, "get_default_storage", return_value=self.storage):
            with self.assertRaises(RuntimeError):
                agent_office.register(ctx)


if __name__ == "__main__":
    unittest.main()
