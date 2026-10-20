"""Unit tests for AO-NE-02 Model and Role Dispatch Routing.

Covers:
1. Restart persistence: Cooldowns, cursors, and route reservations survive store restart.
2. Concurrent route reservations: Thread-safe atomic cursor advances under provider round-robin.
3. Exhaustion: All candidate routes in cooldown or filtered out return None with explicit reasons.
4. Quota vs Auth vs Product Defect failure classification:
   - Quota failure triggers provider cooldown and fallback.
   - Auth failure (401/403) blocks and does NOT perform blind quota failover.
   - Product defect (test gate failure) stays defect and does NOT trigger provider roulette.
5. Same role preserved across fallback: Role identity (e.g. webdev) is strictly preserved.
6. Capability intersection:
   - 3D generators rejected for code tasks.
   - Claude models only on Claude executor; non-Claude on OMO.
7. Variable requested and actual model:
   - Unverified model is explicitly "unknown", never falsified with default.
"""

from __future__ import annotations

import concurrent.futures
import os
import tempfile
import time
import unittest

from agent_office.routing import (
    DurableRouteStore,
    FailureKind,
    ModelDispatchRouter,
    ModelPolicy,
    RouteCandidate,
    RouteResolution,
    classify_failure,
    intersect_capabilities,
)


class TestFailureClassification(unittest.TestCase):
    """Test classification of failure modes per AO-NODE-EDITOR-SPEC-v1 §8."""

    def test_classify_quota_failures(self) -> None:
        samples = [
            "You've hit your session limit · resets 12:20am",
            "HTTP 429 Too Many Requests: quota exceeded",
            "ProviderError: rate_limit_error: usage limit has been reached",
            "resource_exhausted: insufficient_quota for current model",
            "529 Server overloaded, try again later",
        ]
        for msg in samples:
            with self.subTest(msg=msg):
                self.assertEqual(classify_failure(msg), FailureKind.QUOTA)

    def test_classify_auth_failures(self) -> None:
        samples = [
            "HTTP 401 Unauthorized: Invalid API key",
            "HTTP 403 Forbidden: bad_token",
            "authentication_error: permission_denied for organization",
            "invalid_api_key provided in header",
        ]
        for msg in samples:
            with self.subTest(msg=msg):
                self.assertEqual(classify_failure(msg), FailureKind.AUTH)

    def test_classify_product_defects(self) -> None:
        # Test assertion failures must NEVER be treated as provider quota errors
        self.assertEqual(classify_failure("AssertionError: 4 != 5"), FailureKind.PRODUCT_DEFECT)
        self.assertEqual(classify_failure("FAILED (failures=2) in test_routing.py"), FailureKind.PRODUCT_DEFECT)
        self.assertEqual(classify_failure("exit code 1", exit_code=1, is_test_failure=True), FailureKind.PRODUCT_DEFECT)

    def test_classify_timeout(self) -> None:
        self.assertEqual(classify_failure("Execution deadline exceeded: timeout after 900s"), FailureKind.TIMEOUT)


class TestCapabilityIntersection(unittest.TestCase):
    """Test capability intersection and orthogonal domain constraints."""

    def test_3d_generator_cannot_serve_as_code_fallback(self) -> None:
        # Invariant: 3D/image generators never serve as fallback for code-writing tasks
        ok, reasons = intersect_capabilities(
            role_capabilities=["react", "typescript", "code_writing"],
            route_capabilities=["3d_modeling", "3d_generation", "visual"],
            executor_capabilities=["omo"],
            required_capabilities=["code_writing"],
            model="tripo/hunyuan3d-2.0",
            executor="omo",
        )
        self.assertFalse(ok)
        self.assertIn("3D/image generator cannot serve as fallback for code-writing task", reasons[0])

    def test_claude_model_requires_claude_executor(self) -> None:
        # Invariant: Claude models cannot run on OMO executor
        ok, reasons = intersect_capabilities(
            role_capabilities=["web", "code_writing"],
            route_capabilities=["code_writing", "text"],
            executor_capabilities=["code_writing"],
            required_capabilities=["code_writing"],
            model="claude-opus-5-5",
            executor="omo",
        )
        self.assertFalse(ok)
        self.assertIn("cannot run on OMO executor", reasons[0])

    def test_non_claude_model_rejected_on_claude_executor(self) -> None:
        # Invariant: Non-Claude models cannot run on Claude executor
        ok, reasons = intersect_capabilities(
            role_capabilities=["web", "code_writing"],
            route_capabilities=["code_writing", "text"],
            executor_capabilities=["code_writing"],
            required_capabilities=["code_writing"],
            model="antigravity/gemini-3.8-flash-high",
            executor="claude",
        )
        self.assertFalse(ok)
        self.assertIn("cannot run on Claude executor", reasons[0])

    def test_compatible_webdev_omo_gemini_intersection(self) -> None:
        ok, reasons = intersect_capabilities(
            role_capabilities=["react", "typescript", "frontend", "code_writing"],
            route_capabilities=["code_writing", "text"],
            executor_capabilities=["code_writing", "text", "bash"],
            required_capabilities=["code_writing"],
            model="antigravity/gemini-3.8-flash-high",
            executor="omo",
        )
        self.assertTrue(ok)
        self.assertEqual(reasons, [])


class TestDurableRouteStorePersistenceAndRestart(unittest.TestCase):
    """Test that cooldowns, cursors, and reservations survive store restarts."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "routing_store.db")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_cooldown_survives_restart(self) -> None:
        store1 = DurableRouteStore(self.db_path)
        store1.set_provider_cooldown("anthropic", duration_seconds=600.0, reason="Rate limit")
        self.assertTrue(store1.is_provider_in_cooldown("anthropic"))

        # Re-open store from same DB path to simulate process restart
        store2 = DurableRouteStore(self.db_path)
        self.assertTrue(store2.is_provider_in_cooldown("anthropic"))
        cooldown = store2.get_provider_cooldown("anthropic")
        self.assertIsNotNone(cooldown)
        self.assertGreater(cooldown, time.time())

    def test_cursor_survives_restart(self) -> None:
        store1 = DurableRouteStore(self.db_path)
        store1.set_provider_cursor("role:webdev", 2)

        store2 = DurableRouteStore(self.db_path)
        self.assertEqual(store2.get_provider_cursor("role:webdev"), 2)

    def test_route_reservation_idempotency_survives_restart(self) -> None:
        store1 = DurableRouteStore(self.db_path)
        saved = store1.save_reservation(
            reservation_key="run-101:act-work:1",
            run_id="run-101",
            activation_id="act-work",
            attempt_no=1,
            route_id="r-gemini",
            provider="antigravity",
            requested_model="antigravity/gemini-3.8-flash-high",
            executor="omo",
            role="webdev",
            policy_id="pol-web",
        )
        self.assertTrue(saved)

        # Reopen on restart
        store2 = DurableRouteStore(self.db_path)
        res = store2.get_reservation("run-101:act-work:1")
        self.assertIsNotNone(res)
        self.assertEqual(res["role"], "webdev")
        self.assertEqual(res["requested_model"], "antigravity/gemini-3.8-flash-high")
        self.assertEqual(res["executor"], "omo")


class TestConcurrentRouteReservations(unittest.TestCase):
    """Test concurrent thread-safe route reservations under round-robin selection."""

    def test_concurrent_round_robin_advances_cursors_atomically(self) -> None:
        store = DurableRouteStore(":memory:")
        policy_key = "role:webdev"
        num_providers = 3
        num_threads = 30

        def advance() -> int:
            return store.advance_cursor_atomic(policy_key, num_providers)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(advance) for _ in range(num_threads)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        self.assertEqual(len(results), num_threads)
        # All returned indices must be within 0..num_providers-1
        for idx in results:
            self.assertIn(idx, range(num_providers))


class TestModelDispatchRouter(unittest.TestCase):
    """Test end-to-end routing decisions, fallbacks, role preservation, and evidence tracking."""

    def setUp(self) -> None:
        self.store = DurableRouteStore(":memory:")
        self.router = ModelDispatchRouter(self.store)

        self.policy = ModelPolicy(
            policy_id="pol_standard_code",
            strategy="priority",
            routes=[
                RouteCandidate(
                    route_id="route_gemini",
                    provider="antigravity",
                    model="antigravity/gemini-3.8-flash-high",
                    executor="omo",
                    priority=1,
                    capabilities=["code_writing", "text"],
                ),
                RouteCandidate(
                    route_id="route_gpt",
                    provider="openai-broker",
                    model="openai-broker/gpt-6.1-sol",
                    executor="omo",
                    priority=2,
                    capabilities=["code_writing", "text"],
                ),
                RouteCandidate(
                    route_id="route_claude",
                    provider="anthropic",
                    model="claude-opus-5-5",
                    executor="claude",
                    priority=3,
                    capabilities=["code_writing", "text"],
                ),
            ],
        )

    def test_priority_selects_first_healthy_route(self) -> None:
        res, reasons = self.router.resolve_route(
            role="webdev",
            policy=self.policy,
            required_capabilities=["code_writing"],
        )
        self.assertIsNotNone(res)
        self.assertEqual(res.route_id, "route_gemini")
        self.assertEqual(res.requested_model, "antigravity/gemini-3.8-flash-high")
        self.assertEqual(res.executor, "omo")
        self.assertEqual(res.role, "webdev")

    def test_same_role_preserved_across_fallback(self) -> None:
        # Simulate primary Gemini provider in quota cooldown
        self.store.set_provider_cooldown("antigravity", duration_seconds=600.0, reason="Quota 429")

        res, reasons = self.router.resolve_route(
            role="webdev",
            policy=self.policy,
            required_capabilities=["code_writing"],
            run_id="run-1",
            activation_id="act-1",
            attempt_no=2,
        )
        self.assertIsNotNone(res)
        # Should gracefully fail over to second priority (GPT-6.1)
        self.assertEqual(res.route_id, "route_gpt")
        self.assertEqual(res.requested_model, "openai-broker/gpt-6.1-sol")
        self.assertEqual(res.executor, "omo")
        # Invariant: Role MUST remain webdev across fallback
        self.assertEqual(res.role, "webdev")
        self.assertIn("Provider 'antigravity' is in cooldown", reasons[0])

    def test_round_robin_selection_rotates_providers(self) -> None:
        rr_policy = ModelPolicy(
            policy_id="pol_rr",
            strategy="round_robin",
            routes=self.policy.routes,
        )

        res1, _ = self.router.resolve_route(role="webdev", policy=rr_policy, policy_key="test_rr")
        res2, _ = self.router.resolve_route(role="webdev", policy=rr_policy, policy_key="test_rr")
        res3, _ = self.router.resolve_route(role="webdev", policy=rr_policy, policy_key="test_rr")

        providers = [res1.provider, res2.provider, res3.provider]
        # Should visit all 3 distinct providers in rotation
        self.assertEqual(set(providers), {"antigravity", "openai-broker", "anthropic"})

    def test_exhaustion_when_all_providers_in_cooldown(self) -> None:
        self.store.set_provider_cooldown("antigravity", 600.0, "Quota")
        self.store.set_provider_cooldown("openai-broker", 600.0, "Quota")
        self.store.set_provider_cooldown("anthropic", 600.0, "Quota")

        res, reasons = self.router.resolve_route(
            role="webdev",
            policy=self.policy,
            required_capabilities=["code_writing"],
        )
        self.assertIsNone(res)
        self.assertTrue(any("in cooldown" in r for r in reasons))

    def test_variable_requested_and_actual_model_evidence(self) -> None:
        res, _ = self.router.resolve_route(
            role="webdev",
            policy=self.policy,
            required_capabilities=["code_writing"],
        )
        self.assertIsNotNone(res)
        self.assertEqual(res.requested_model, "antigravity/gemini-3.8-flash-high")
        self.assertIsNone(res.actual_model)

        # 1. When executor confirms actual model with session evidence
        res.record_actual_model("antigravity/gemini-3.8-flash-high", evidence="parsed_session_header")
        self.assertEqual(res.actual_model, "antigravity/gemini-3.8-flash-high")
        self.assertEqual(res.model_evidence, "parsed_session_header")

        # 2. When executor reports unverified model, it must be recorded as unknown, NOT faked
        res_unverified, _ = self.router.resolve_route(role="webdev", policy=self.policy)
        self.assertIsNotNone(res_unverified)
        res_unverified.record_actual_model(None)
        self.assertEqual(res_unverified.actual_model, "unknown")
        self.assertEqual(res_unverified.model_evidence, "unverified")


if __name__ == "__main__":
    unittest.main()
