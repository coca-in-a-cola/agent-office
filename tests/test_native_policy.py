"""Unit tests for the native delegation policy adapter (agent_office.native_policy).

Validates:
- Standard unittest temporary OfficeStorage fixture
- Exact primary and fallback route resolution contract
  (custom:antigravity/gemini-3.8-flash-high -> openai-codex/gpt-6.1-sol)
- Secrets exclusion from route and credentials_cfg
- Preserving agent role and read-only storage invariant
- AgentNotFoundError for missing agents
- EmptyPolicyError vs InvalidPolicyError handling (validation order: role -> revision -> strategy -> models)
- Explicit UnsupportedRoutingStrategyError for round_robin and other non-priority strategies
- InvalidPolicyError on extra api_key fields without leaking secret values
- Preservation of legitimate identifiers with case sensitivity and special characters (no normalization)
"""

import os
import tempfile
import unittest
from typing import Any, Dict, List

from agent_office.native_policy import (
    AgentNotFoundError,
    EmptyPolicyError,
    InvalidPolicyError,
    UnsupportedRoutingStrategyError,
    resolve_native_delegation_policy,
)
from agent_office.storage import OfficeStorage


class TestNativePolicy(unittest.TestCase):
    """Test suite for native delegation policy adapter."""

    def setUp(self) -> None:
        """Create a temporary directory and isolated OfficeStorage instance."""
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "office.sqlite3")
        self.storage = OfficeStorage(self.db_path)

    def tearDown(self) -> None:
        """Close storage connection and clean up temporary directory."""
        if hasattr(self.storage, "close"):
            self.storage.close()
        self.temp_dir.cleanup()

    def test_primary_and_fallback_route_resolution(self) -> None:
        """Resolve ordered primary and fallback routes with exact model configuration.

        Validates:
        - Primary model: custom:antigravity / gemini-3.8-flash-high
        - Fallback chain: openai-codex / gpt-6.1-sol
        - No secret fields in selected_route or credentials_cfg
        - Role remains unchanged
        - Storage state is untouched (read-only resolver invariant)
        """
        agent_id = "coder"
        self.storage.register_or_update_agent(agent_id, role="coder", last_seen_at=0)

        models = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
            {"provider": "openai-codex", "model": "gpt-6.1-sol"},
        ]
        self.storage.set_agent_policy(agent_id, models, "priority")

        pre_agent = self.storage.get_agent(agent_id)
        self.assertIsNotNone(pre_agent)

        res = resolve_native_delegation_policy(self.storage, agent_id)

        # Resolver returns dict with agent_id, role, revision, selected_route, credentials_cfg
        self.assertIsInstance(res, dict)
        self.assertEqual(res["agent_id"], agent_id)
        self.assertEqual(res["role"], "coder")
        self.assertIsInstance(res["revision"], int)
        self.assertGreaterEqual(res["revision"], 1)

        # Selected route contract: primary provider/model + fallback_providers list
        route: Dict[str, Any] = res["selected_route"]
        self.assertEqual(route["provider"], "custom:antigravity")
        self.assertEqual(route["model"], "gemini-3.8-flash-high")

        fallbacks: List[Dict[str, Any]] = route.get("fallback_providers", [])
        self.assertEqual(len(fallbacks), 1)
        fb = fallbacks[0]
        self.assertEqual(fb["provider"], "openai-codex")
        self.assertEqual(fb["model"], "gpt-6.1-sol")

        # Credentials configuration present and free of secret tokens
        creds_cfg: Dict[str, Any] = res.get("credentials_cfg", {})
        self.assertIsInstance(creds_cfg, dict)

        for obj in (route, creds_cfg, fb):
            for k in obj.keys():
                self.assertNotIn(k.lower(), ("api_key", "secret", "token", "password", "bearer"))

        # Storage must remain untouched (read-only resolver)
        post_agent = self.storage.get_agent(agent_id)
        self.assertEqual(pre_agent, post_agent)

    def test_missing_agent_raises_agent_not_found_error(self) -> None:
        """Resolving a non-existent agent raises AgentNotFoundError."""
        with self.assertRaises(AgentNotFoundError):
            resolve_native_delegation_policy(self.storage, "nonexistent-agent")

    def test_empty_agent_no_policy_raises_matching_error(self) -> None:
        """An agent registered without a policy raises InvalidPolicyError.

        Documenting validation order:
        In resolve_native_delegation_policy, fields are validated in order:
        1. agent_id and role bounds
        2. policy_revision (must be int >= 1) -> raises InvalidPolicyError if missing
        3. routing_strategy (must be 'priority') -> raises UnsupportedRoutingStrategyError
        4. models (must be non-empty list) -> raises EmptyPolicyError

        Because an unconfigured agent lacks 'policy_revision' in storage metadata,
        it raises InvalidPolicyError before reaching the models check.
        """
        agent_id = "empty_unconfigured_agent"
        self.storage.register_or_update_agent(agent_id, role="tester", last_seen_at=0)

        with self.assertRaises(InvalidPolicyError):
            resolve_native_delegation_policy(self.storage, agent_id)

    def test_empty_models_list_raises_empty_policy_error(self) -> None:
        """An agent with policy revision set but empty models list raises EmptyPolicyError."""
        agent_id = "empty_models_agent"
        self.storage.register_or_update_agent(agent_id, role="tester", last_seen_at=0)
        self.storage.set_agent_policy(agent_id, [], "priority")

        with self.assertRaises(EmptyPolicyError):
            resolve_native_delegation_policy(self.storage, agent_id)

    def test_round_robin_strategy_raises_unsupported_routing_strategy_error(self) -> None:
        """Requesting round_robin routing explicitly raises UnsupportedRoutingStrategyError."""
        agent_id = "rr_agent"
        self.storage.register_or_update_agent(agent_id, role="coder", last_seen_at=0)
        models = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
        ]
        self.storage.set_agent_policy(agent_id, models, "round_robin")

        with self.assertRaises(UnsupportedRoutingStrategyError) as ctx:
            resolve_native_delegation_policy(self.storage, agent_id)
        self.assertIn("round_robin", str(ctx.exception))

    def test_arbitrary_unsupported_strategy_raises_unsupported_routing_strategy_error(self) -> None:
        """Requesting an arbitrary unknown routing strategy raises UnsupportedRoutingStrategyError."""
        agent_id = "arbitrary_agent"
        self.storage.register_or_update_agent(agent_id, role="coder", last_seen_at=0)
        models = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
        ]
        self.storage.set_agent_policy(agent_id, models, "weighted_random")

        with self.assertRaises(UnsupportedRoutingStrategyError) as ctx:
            resolve_native_delegation_policy(self.storage, agent_id)
        self.assertIn("weighted_random", str(ctx.exception))

    def test_extra_api_key_field_raises_invalid_policy_without_leaking_secret(self) -> None:
        """Models entry with forbidden api_key field raises InvalidPolicyError without leaking value."""
        agent_id = "secret_agent"
        self.storage.register_or_update_agent(agent_id, role="coder", last_seen_at=0)
        synthetic_secret = "SYNTHETIC-NOT-SECRET"
        models = [
            {
                "provider": "custom:antigravity",
                "model": "gemini-3.8-flash-high",
                "api_key": synthetic_secret,
            }
        ]
        self.storage.set_agent_policy(agent_id, models, "priority")

        with self.assertRaises(InvalidPolicyError) as ctx:
            resolve_native_delegation_policy(self.storage, agent_id)

        error_message = str(ctx.exception)
        self.assertIn("api_key", error_message)
        self.assertNotIn(synthetic_secret, error_message)

    def test_malformed_ids_preserved_legitimate_case_no_normalization(self) -> None:
        """Legitimate identifier with mixed case and special characters is preserved exactly."""
        malformed_id = "Agent:Special/123_#Coder"
        self.storage.register_or_update_agent(malformed_id, role="Senior-Architect", last_seen_at=0)
        models = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
        ]
        self.storage.set_agent_policy(malformed_id, models, "priority")

        res = resolve_native_delegation_policy(self.storage, malformed_id)

        self.assertEqual(res["agent_id"], malformed_id)
        self.assertEqual(res["role"], "Senior-Architect")


if __name__ == "__main__":
    unittest.main()
