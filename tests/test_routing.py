"""Unit tests for Agent Office Decision Plane: Probabilistic Routing with Jev and Fallback.

Covers:
- Typed domain models and conversions
- Risk assessment boundaries and review gates
- Fail-open guarantees on risk evaluation
- Heuristic fallback routing for coding, devops, art, review, and planning tasks
- Strict decoupling of gamification metrics from operational routing scores
- Jev adapter with simulated successful, unconfigured, and failing responses
- Storage integration in SQLite (recording decisions and operational stats)
"""

from __future__ import annotations

import time
import unittest
from unittest.mock import MagicMock

from agent_office.routing import (
    AgentCandidate,
    GamificationStats,
    HeuristicFallbackRouter,
    JevAdapter,
    OperationalStats,
    ReviewGate,
    RiskAssessment,
    RiskAssessmentEngine,
    RiskLevel,
    RoutingDecision,
    TaskRoutingRequest,
    get_default_candidates,
)
from agent_office.storage import OfficeStorage


class TestDomainModels(unittest.TestCase):
    """Test domain model instantiation, serialization, and deserialization."""

    def test_task_routing_request_defaults_and_dict(self) -> None:
        req = TaskRoutingRequest(
            task_id="task_123",
            title="Implement OAuth2 handler",
            body="Create backend endpoint for Google auth",
            tags=["python", "auth", "backend"],
            estimated_difficulty=4.5,
            required_tools=["edit", "bash"],
        )
        d = req.to_dict()
        self.assertEqual(d["task_id"], "task_123")
        self.assertEqual(d["title"], "Implement OAuth2 handler")
        self.assertEqual(d["estimated_difficulty"], 4.5)
        self.assertEqual(d["tags"], ["python", "auth", "backend"])

        restored = TaskRoutingRequest.from_dict(d)
        self.assertEqual(restored.task_id, req.task_id)
        self.assertEqual(restored.title, req.title)
        self.assertEqual(restored.tags, req.tags)
        self.assertEqual(restored.estimated_difficulty, 4.5)
        self.assertEqual(restored.required_tools, req.required_tools)

    def test_risk_level_normalization(self) -> None:
        self.assertEqual(RiskLevel.from_str("low"), RiskLevel.LOW)
        self.assertEqual(RiskLevel.from_str("MEDIUM"), RiskLevel.MEDIUM)
        self.assertEqual(RiskLevel.from_str("High"), RiskLevel.HIGH)
        self.assertEqual(RiskLevel.from_str("critical"), RiskLevel.CRITICAL)
        self.assertEqual(RiskLevel.from_str("unknown_value"), RiskLevel.LOW)

    def test_risk_assessment_and_review_gate_dict(self) -> None:
        gate = ReviewGate(pre_approval_needed=True, auto_dispatch_allowed=False, post_review_required=True)
        assessment = RiskAssessment(
            level=RiskLevel.HIGH,
            score=0.78,
            review_gates=gate,
            reasons=["Production deploy pattern detected"],
        )
        d = assessment.to_dict()
        self.assertEqual(d["level"], "High")
        self.assertEqual(d["score"], 0.78)
        self.assertTrue(d["review_gates"]["pre_approval_needed"])
        self.assertFalse(d["review_gates"]["auto_dispatch_allowed"])
        self.assertTrue(d["review_gates"]["post_review_required"])

        restored = RiskAssessment.from_dict(d)
        self.assertEqual(restored.level, RiskLevel.HIGH)
        self.assertEqual(restored.score, 0.78)
        self.assertTrue(restored.review_gates.pre_approval_needed)

    def test_agent_candidate_operational_vs_gamification_models(self) -> None:
        candidate = AgentCandidate(
            agent_id="coder",
            profile_name="Coder",
            role="Coder",
            capabilities=["python", "algorithms"],
            operational_stats=OperationalStats(latency_ms=150.0, error_rate=0.02, cost_per_token=0.00002),
            gamification_stats=GamificationStats(xp=5000, level=10, badges=["ninja"]),
        )
        d = candidate.to_dict()
        self.assertEqual(d["agent_id"], "coder")
        self.assertEqual(d["operational_stats"]["latency_ms"], 150.0)
        self.assertEqual(d["gamification_stats"]["xp"], 5000)

        restored = AgentCandidate.from_dict(d)
        self.assertEqual(restored.operational_stats.error_rate, 0.02)
        self.assertEqual(restored.gamification_stats.level, 10)
        self.assertEqual(restored.gamification_stats.badges, ["ninja"])


class TestRiskAssessmentEngine(unittest.TestCase):
    """Test risk classification boundaries, review gate policies, and fail-open guarantees."""

    def setUp(self) -> None:
        self.engine = RiskAssessmentEngine()

    def test_low_risk_classification(self) -> None:
        # Documentation or CSS styling tasks
        req = TaskRoutingRequest(
            task_id="t_low",
            title="Update README documentation for API endpoints",
            body="Clarify markdown examples and formatting",
            tags=["docs", "markdown"],
            estimated_difficulty=1.0,
        )
        risk = self.engine.assess_risk(req)
        self.assertEqual(risk.level, RiskLevel.LOW)
        self.assertLess(risk.score, 0.35)
        self.assertFalse(risk.review_gates.pre_approval_needed)
        self.assertTrue(risk.review_gates.auto_dispatch_allowed)
        self.assertFalse(risk.review_gates.post_review_required)

    def test_medium_risk_classification(self) -> None:
        # Refactoring internal component logic or updating dependencies
        req = TaskRoutingRequest(
            task_id="t_med",
            title="Refactor internal cache schema and update dependencies",
            body="Modernize dependency update configuration and schema validation",
            tags=["refactor", "config"],
            estimated_difficulty=4.0,
            required_tools=["file_writer"],
        )
        risk = self.engine.assess_risk(req)
        self.assertEqual(risk.level, RiskLevel.MEDIUM)
        self.assertGreaterEqual(risk.score, 0.35)
        self.assertLess(risk.score, 0.70)
        self.assertFalse(risk.review_gates.pre_approval_needed)
        self.assertTrue(risk.review_gates.auto_dispatch_allowed)
        self.assertTrue(risk.review_gates.post_review_required)

    def test_high_risk_classification(self) -> None:
        # Production deployment or database migration
        req = TaskRoutingRequest(
            task_id="t_high",
            title="Deploy new release to production cluster with sudo",
            body="Run database migration and update production secrets token",
            tags=["deploy", "production", "migration"],
            estimated_difficulty=7.0,
            required_tools=["bash", "ssh"],
        )
        risk = self.engine.assess_risk(req)
        self.assertEqual(risk.level, RiskLevel.HIGH)
        self.assertGreaterEqual(risk.score, 0.70)
        self.assertTrue(risk.review_gates.pre_approval_needed)
        self.assertFalse(risk.review_gates.auto_dispatch_allowed)
        self.assertTrue(risk.review_gates.post_review_required)

    def test_critical_risk_classification(self) -> None:
        # Destruction, wipe, or drop database
        req = TaskRoutingRequest(
            task_id="t_crit",
            title="Drop database production tables and rm -rf old storage",
            body="Bypass auth to wipe and delete credentials",
            tags=["database", "wipe"],
            estimated_difficulty=9.0,
            required_tools=["prod_database_admin", "bash"],
        )
        risk = self.engine.assess_risk(req)
        self.assertEqual(risk.level, RiskLevel.CRITICAL)
        self.assertGreaterEqual(risk.score, 0.90)
        self.assertTrue(risk.review_gates.pre_approval_needed)
        self.assertFalse(risk.review_gates.auto_dispatch_allowed)
        self.assertTrue(risk.review_gates.post_review_required)

    def test_fail_open_guarantee_on_error(self) -> None:
        # If an unexpected exception occurs inside risk engine, fail-open returns a safe assessment
        broken_req = MagicMock()
        broken_req.title = None  # None causes regex / string join errors if unhandled
        broken_req.body = None
        broken_req.tags = None

        risk = self.engine.assess_risk(broken_req)
        self.assertIsInstance(risk, RiskAssessment)
        # In fail-open mode, it conservatively requires pre-approval
        self.assertTrue(risk.review_gates.pre_approval_needed)
        self.assertFalse(risk.review_gates.auto_dispatch_allowed)
        self.assertIn("Fail-open", risk.reasons[0])


class TestHeuristicFallbackRouter(unittest.TestCase):
    """Test heuristic routing for coding, devops, art, review, and planning profiles."""

    def setUp(self) -> None:
        self.router = HeuristicFallbackRouter()

    def test_routes_coding_task_to_coder(self) -> None:
        req = TaskRoutingRequest(
            task_id="t_code",
            title="Implement recursive tree search algorithm in Python",
            body="Optimize backend AST parser function and fix type annotations",
            tags=["python", "algorithms", "backend"],
        )
        decision = self.router.route(req)
        self.assertEqual(decision.selected_agent_id, "coder")
        self.assertEqual(decision.selected_profile_name, "Coder")
        self.assertEqual(decision.router_used, "heuristic")
        self.assertGreater(decision.confidence, 0.5)
        self.assertIn("coder", decision.candidate_scores)
        self.assertGreater(decision.candidate_scores["coder"], decision.candidate_scores["artist"])

    def test_routes_devops_task_to_devops(self) -> None:
        req = TaskRoutingRequest(
            task_id="t_ops",
            title="Configure Dockerfile and Kubernetes deployment pipeline",
            body="Set up CI/CD GitHub Actions workflow for container build and server monitoring",
            tags=["docker", "kubernetes", "ci_cd", "infra"],
            required_tools=["bash", "docker"],
        )
        decision = self.router.route(req)
        self.assertEqual(decision.selected_agent_id, "devops")
        self.assertEqual(decision.selected_profile_name, "DevOps")
        self.assertGreater(decision.candidate_scores["devops"], decision.candidate_scores["coder"])

    def test_routes_art_task_to_artist(self) -> None:
        req = TaskRoutingRequest(
            task_id="t_art",
            title="Model 3D low-poly office desk in Blender",
            body="Create textured mesh with UV mapping and visual rendering assets",
            tags=["3d_modeling", "blender", "textures", "art"],
        )
        decision = self.router.route(req)
        self.assertEqual(decision.selected_agent_id, "artist")
        self.assertEqual(decision.selected_profile_name, "Artist")
        self.assertGreater(decision.candidate_scores["artist"], decision.candidate_scores["coder"])

    def test_routes_review_and_qa_task_to_qa(self) -> None:
        req = TaskRoutingRequest(
            task_id="t_qa",
            title="Write regression test suite and conduct security audit",
            body="Verify test coverage and run end-to-end integration tests for payment endpoints",
            tags=["testing", "verification", "security", "qa"],
        )
        decision = self.router.route(req)
        self.assertEqual(decision.selected_agent_id, "qa")
        self.assertEqual(decision.selected_profile_name, "QA")
        self.assertGreater(decision.candidate_scores["qa"], decision.candidate_scores["artist"])

    def test_routes_planning_and_strategy_task_to_tyler(self) -> None:
        req = TaskRoutingRequest(
            task_id="t_plan",
            title="Define Q3 technical roadmap and cross-team coordination",
            body="Establish strategic milestones, triage incoming epics, and orchestrate deliverables",
            tags=["planning", "strategy", "leadership", "coordination"],
        )
        decision = self.router.route(req)
        self.assertEqual(decision.selected_agent_id, "tyler")
        self.assertEqual(decision.selected_profile_name, "Tyler")
        self.assertGreater(decision.candidate_scores["tyler"], decision.candidate_scores["artist"])


class TestGamificationDecoupling(unittest.TestCase):
    """Test strict separation of concerns between gamification metrics and operational routing."""

    def test_gamification_metrics_do_not_affect_routing_scores(self) -> None:
        router = HeuristicFallbackRouter()
        task = TaskRoutingRequest(
            task_id="t_decouple",
            title="Optimize Python database connection pool",
            body="Refactor backend pool algorithm",
            tags=["python", "database"],
        )

        candidate_fresh = AgentCandidate(
            agent_id="coder",
            profile_name="Coder",
            role="Coder",
            capabilities=["python", "backend", "algorithms"],
            operational_stats=OperationalStats(latency_ms=100.0, error_rate=0.01, success_rate=0.99),
            gamification_stats=GamificationStats(xp=0, level=1, badges=[], streak_days=0),
        )

        candidate_maxed_gamification = AgentCandidate(
            agent_id="coder",
            profile_name="Coder",
            role="Coder",
            capabilities=["python", "backend", "algorithms"],
            operational_stats=OperationalStats(latency_ms=100.0, error_rate=0.01, success_rate=0.99),
            gamification_stats=GamificationStats(
                xp=1_000_000,
                level=100,
                badges=["legendary_overlord", "mythic_architect", "diamond_coder"],
                streak_days=999,
            ),
        )

        score_fresh = router.score_candidate(candidate_fresh, task)
        score_maxed = router.score_candidate(candidate_maxed_gamification, task)

        # Gamification metrics must have ZERO influence on the candidate score
        self.assertEqual(score_fresh, score_maxed)

    def test_operational_stats_influence_routing_scores(self) -> None:
        router = HeuristicFallbackRouter()
        task = TaskRoutingRequest(
            task_id="t_ops_impact",
            title="Fix Python algorithm bug",
            body="Resolve race condition in service",
            tags=["python"],
        )

        reliable_candidate = AgentCandidate(
            agent_id="coder",
            profile_name="Coder",
            role="Coder",
            capabilities=["python", "algorithms"],
            operational_stats=OperationalStats(latency_ms=50.0, error_rate=0.005, success_rate=0.995, active_tasks=0),
            gamification_stats=GamificationStats(xp=10, level=1),
        )

        degraded_candidate = AgentCandidate(
            agent_id="coder",
            profile_name="Coder",
            role="Coder",
            capabilities=["python", "algorithms"],
            operational_stats=OperationalStats(latency_ms=3000.0, error_rate=0.60, success_rate=0.40, active_tasks=8),
            gamification_stats=GamificationStats(xp=999999, level=50),  # High XP cannot compensate for degradation
        )

        score_reliable = router.score_candidate(reliable_candidate, task)
        score_degraded = router.score_candidate(degraded_candidate, task)

        self.assertGreater(score_reliable, score_degraded)


class TestJevAdapter(unittest.TestCase):
    """Test Jev probabilistic routing adapter, structured schemas, and fallback behavior."""

    def test_unconfigured_jev_triggers_heuristic_fallback(self) -> None:
        adapter = JevAdapter(invoker=None, client=None, api_key=None, endpoint=None)
        req = TaskRoutingRequest(
            task_id="t_jev_unconf",
            title="Create 3D asset texture in Blender",
            tags=["3d_modeling", "blender"],
        )
        decision = adapter.route(req)
        self.assertEqual(decision.selected_agent_id, "artist")
        self.assertEqual(decision.router_used, "heuristic_fallback")
        self.assertIn("Jev unconfigured", decision.rationale)

    def test_successful_jev_invocation(self) -> None:
        def simulated_jev_invoker(payload: dict) -> dict:
            # Verify payload contains structured schema properties
            self.assertEqual(payload["schema_version"], "1.0")
            self.assertIn("task", payload)
            self.assertIn("candidates", payload)
            return {
                "selected_agent_id": "coder",
                "confidence": 0.94,
                "candidate_scores": {"coder": 0.94, "qa": 0.45, "devops": 0.30},
                "rationale": "Jev probabilistic analysis confirmed high Python algorithm match for Coder.",
            }

        adapter = JevAdapter(invoker=simulated_jev_invoker)
        req = TaskRoutingRequest(
            task_id="t_jev_ok",
            title="Build complex Python service",
            tags=["python"],
        )
        decision = adapter.route(req)
        self.assertEqual(decision.selected_agent_id, "coder")
        self.assertEqual(decision.selected_profile_name, "Coder")
        self.assertEqual(decision.router_used, "jev")
        self.assertEqual(decision.confidence, 0.94)
        self.assertIn("Jev probabilistic analysis", decision.rationale)

    def test_failing_jev_invocation_falls_back_gracefully(self) -> None:
        def crashing_jev_invoker(payload: dict) -> dict:
            raise ConnectionError("Simulated network timeout to Jev service")

        adapter = JevAdapter(invoker=crashing_jev_invoker)
        req = TaskRoutingRequest(
            task_id="t_jev_fail",
            title="Setup CI/CD deployment pipeline for Docker container",
            tags=["docker", "ci_cd", "deploy"],
        )
        decision = adapter.route(req)
        # Graceful fallback selects DevOps without throwing exception
        self.assertEqual(decision.selected_agent_id, "devops")
        self.assertEqual(decision.router_used, "heuristic_fallback")
        self.assertIn("ConnectionError", decision.rationale)

    def test_malformed_jev_response_falls_back_gracefully(self) -> None:
        def malformed_jev_invoker(payload: dict) -> dict:
            # Return invalid selected_agent_id not in candidate list
            return {
                "selected_agent_id": "non_existent_alien_agent",
                "confidence": 0.99,
            }

        adapter = JevAdapter(invoker=malformed_jev_invoker)
        req = TaskRoutingRequest(
            task_id="t_jev_malformed",
            title="Write unit tests for authentication module",
            tags=["testing", "verification"],
        )
        decision = adapter.route(req)
        self.assertEqual(decision.selected_agent_id, "qa")
        self.assertEqual(decision.router_used, "heuristic_fallback")


class TestStorageRoutingIntegration(unittest.TestCase):
    """Test recording routing decisions and updating agent operational stats in SQLite."""

    def setUp(self) -> None:
        self.storage = OfficeStorage(db_path=":memory:")

    def tearDown(self) -> None:
        self.storage.close()

    def test_record_and_get_routing_decision(self) -> None:
        risk = RiskAssessment(
            level=RiskLevel.MEDIUM,
            score=0.45,
            review_gates=ReviewGate(pre_approval_needed=False, auto_dispatch_allowed=True, post_review_required=True),
            reasons=["Refactor pattern"],
        )
        decision = RoutingDecision(
            decision_id="dec_001",
            task_id="task_999",
            selected_agent_id="coder",
            selected_profile_name="Coder",
            candidate_scores={"coder": 0.88, "qa": 0.42},
            risk_assessment=risk,
            router_used="heuristic",
            confidence=0.85,
            rationale="Best capability match",
            timestamp=time.time(),
            metadata={"priority": "high"},
        )

        ok = self.storage.record_routing_decision(decision)
        self.assertTrue(ok)

        stored = self.storage.get_routing_decision("dec_001")
        self.assertIsNotNone(stored)
        self.assertEqual(stored["id"], "dec_001")
        self.assertEqual(stored["task_id"], "task_999")
        self.assertEqual(stored["selected_agent_id"], "coder")
        self.assertEqual(stored["selected_profile_name"], "Coder")
        self.assertEqual(stored["router_used"], "heuristic")
        self.assertEqual(stored["confidence"], 0.85)
        self.assertEqual(stored["risk_level"], "Medium")
        self.assertEqual(stored["candidate_scores"]["coder"], 0.88)
        self.assertEqual(stored["risk_assessment"]["level"], "Medium")

    def test_list_routing_decisions_filtering(self) -> None:
        for i in range(3):
            self.storage.record_routing_decision({
                "id": f"dec_a_{i}",
                "task_id": "task_a",
                "selected_agent_id": "coder",
                "selected_profile_name": "Coder",
                "timestamp": time.time() + i,
            })
        self.storage.record_routing_decision({
            "id": "dec_b_0",
            "task_id": "task_b",
            "selected_agent_id": "artist",
            "selected_profile_name": "Artist",
            "timestamp": time.time() + 10,
        })

        all_decs = self.storage.list_routing_decisions()
        self.assertEqual(len(all_decs), 4)

        task_a_decs = self.storage.list_routing_decisions(task_id="task_a")
        self.assertEqual(len(task_a_decs), 3)

        artist_decs = self.storage.list_routing_decisions(agent_id="artist")
        self.assertEqual(len(artist_decs), 1)
        self.assertEqual(artist_decs[0]["id"], "dec_b_0")

    def test_update_and_get_agent_operational_stats(self) -> None:
        agent_id = "coder"
        # Initial stats
        self.storage.update_agent_operational_stats(agent_id=agent_id, latency_ms=100.0, success=True, cost=0.002)
        stats = self.storage.get_agent_operational_stats(agent_id)
        self.assertEqual(stats["total_calls"], 1)
        self.assertEqual(stats["latency_ms"], 100.0)
        self.assertEqual(stats["error_count"], 0)
        self.assertEqual(stats["error_rate"], 0.0)
        self.assertEqual(stats["success_rate"], 1.0)
        self.assertAlmostEqual(stats["total_cost"], 0.002)

        # Record a second call that failed with high latency
        self.storage.update_agent_operational_stats(agent_id=agent_id, latency_ms=300.0, error_occurred=True, cost=0.003)
        stats2 = self.storage.get_agent_operational_stats(agent_id)
        self.assertEqual(stats2["total_calls"], 2)
        # Average of 100.0 and 300.0 is 200.0
        self.assertEqual(stats2["latency_ms"], 200.0)
        self.assertEqual(stats2["error_count"], 1)
        self.assertEqual(stats2["error_rate"], 0.5)
        self.assertEqual(stats2["success_rate"], 0.5)
        self.assertAlmostEqual(stats2["total_cost"], 0.005)

    def test_fail_open_on_closed_storage(self) -> None:
        self.storage.close()
        # Storage operations must fail open without raising exceptions
        res = self.storage.record_routing_decision({"id": "d1"})
        self.assertFalse(res)
        dec = self.storage.get_routing_decision("d1")
        self.assertIsNone(dec)
        decs = self.storage.list_routing_decisions()
        self.assertEqual(decs, [])
        stats = self.storage.get_agent_operational_stats("coder")
        self.assertIsInstance(stats, dict)


if __name__ == "__main__":
    unittest.main()
