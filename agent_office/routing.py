"""Decision Plane: Probabilistic Routing with Jev and Fallback for Agent Office.

Implements typed domain models, risk assessment, deterministic heuristic fallback routing,
Jev probabilistic routing adapter, and strict decoupling of gamification from operational routing.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
import json
import logging
import math
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union
import uuid

logger = logging.getLogger("agent_office.routing")


# ---------------------------------------------------------------------------
# Enums and Domain Models
# ---------------------------------------------------------------------------


class RiskLevel(str, Enum):
    """Classified risk level for incoming tasks."""

    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"

    @classmethod
    def from_str(cls, val: Union[str, RiskLevel]) -> RiskLevel:
        """Parse string or RiskLevel into standard RiskLevel safely."""
        if isinstance(val, RiskLevel):
            return val
        if not val or not isinstance(val, str):
            return cls.LOW
        normalized = val.strip().capitalize()
        for member in cls:
            if member.value.lower() == normalized.lower():
                return member
        return cls.LOW


@dataclass
class ReviewGate:
    """Review gate flags determined by risk assessment."""

    pre_approval_needed: bool = False
    auto_dispatch_allowed: bool = True
    post_review_required: bool = False

    def to_dict(self) -> dict[str, bool]:
        return {
            "pre_approval_needed": self.pre_approval_needed,
            "auto_dispatch_allowed": self.auto_dispatch_allowed,
            "post_review_required": self.post_review_required,
        }

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> ReviewGate:
        if not data or not isinstance(data, dict):
            return cls()
        return cls(
            pre_approval_needed=bool(data.get("pre_approval_needed", False)),
            auto_dispatch_allowed=bool(data.get("auto_dispatch_allowed", True)),
            post_review_required=bool(data.get("post_review_required", False)),
        )


@dataclass
class RiskAssessment:
    """Detailed risk assessment outcome for a task specification."""

    level: RiskLevel
    score: float
    review_gates: ReviewGate
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "level": self.level.value if isinstance(self.level, RiskLevel) else str(self.level),
            "score": round(self.score, 4),
            "review_gates": self.review_gates.to_dict(),
            "reasons": list(self.reasons),
        }

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> RiskAssessment:
        if not data or not isinstance(data, dict):
            return RiskAssessment(
                level=RiskLevel.LOW,
                score=0.0,
                review_gates=ReviewGate(),
                reasons=["Default fallback risk assessment"],
            )
        lvl_raw = data.get("level", RiskLevel.LOW)
        lvl = RiskLevel.from_str(lvl_raw)
        score = float(data.get("score", 0.0))
        gates_raw = data.get("review_gates")
        review_gates = ReviewGate.from_dict(gates_raw)
        reasons = list(data.get("reasons", []))
        return cls(level=lvl, score=score, review_gates=review_gates, reasons=reasons)


@dataclass
class OperationalStats:
    """Operational reliability and performance metrics used for routing."""

    latency_ms: float = 0.0
    error_rate: float = 0.0  # 0.0 to 1.0
    cost_per_token: float = 0.0
    success_rate: float = 1.0  # 0.0 to 1.0
    active_tasks: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "latency_ms": self.latency_ms,
            "error_rate": self.error_rate,
            "cost_per_token": self.cost_per_token,
            "success_rate": self.success_rate,
            "active_tasks": self.active_tasks,
        }

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> OperationalStats:
        if not data or not isinstance(data, dict):
            return cls()
        return cls(
            latency_ms=float(data.get("latency_ms", 0.0)),
            error_rate=float(data.get("error_rate", 0.0)),
            cost_per_token=float(data.get("cost_per_token", 0.0)),
            success_rate=float(data.get("success_rate", 1.0)),
            active_tasks=int(data.get("active_tasks", 0)),
        )


@dataclass
class GamificationStats:
    """Gamification metrics (XP, level, badges) cleanly decoupled from operational routing."""

    xp: int = 0
    level: int = 1
    badges: list[str] = field(default_factory=list)
    streak_days: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "xp": self.xp,
            "level": self.level,
            "badges": list(self.badges),
            "streak_days": self.streak_days,
        }

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> GamificationStats:
        if not data or not isinstance(data, dict):
            return cls()
        return cls(
            xp=int(data.get("xp", 0)),
            level=int(data.get("level", 1)),
            badges=list(data.get("badges", [])),
            streak_days=int(data.get("streak_days", 0)),
        )


@dataclass
class AgentCandidate:
    """Candidate profile eligible for task routing."""

    agent_id: str
    profile_name: str
    role: str
    capabilities: list[str] = field(default_factory=list)
    operational_stats: OperationalStats = field(default_factory=OperationalStats)
    gamification_stats: GamificationStats = field(default_factory=GamificationStats)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "profile_name": self.profile_name,
            "role": self.role,
            "capabilities": list(self.capabilities),
            "operational_stats": self.operational_stats.to_dict(),
            "gamification_stats": self.gamification_stats.to_dict(),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AgentCandidate:
        ops = OperationalStats.from_dict(data.get("operational_stats"))
        gam = GamificationStats.from_dict(data.get("gamification_stats"))
        return cls(
            agent_id=str(data.get("agent_id") or data.get("id", "")),
            profile_name=str(data.get("profile_name") or data.get("name", "")),
            role=str(data.get("role", "agent")),
            capabilities=list(data.get("capabilities", [])),
            operational_stats=ops,
            gamification_stats=gam,
            metadata=dict(data.get("metadata", {})),
        )


@dataclass
class TaskRoutingRequest:
    """Incoming task specification requiring routing evaluation and agent assignment."""

    task_id: str
    title: str
    body: str = ""
    tags: list[str] = field(default_factory=list)
    estimated_difficulty: float = 1.0  # Normalized scale or numeric 1-10
    required_tools: list[str] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "title": self.title,
            "body": self.body,
            "tags": list(self.tags),
            "estimated_difficulty": self.estimated_difficulty,
            "required_tools": list(self.required_tools),
            "context": dict(self.context),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskRoutingRequest:
        task_id = str(data.get("task_id") or data.get("id") or str(uuid.uuid4()))
        title = str(data.get("title", ""))
        body = str(data.get("body") or data.get("description", ""))
        tags = [str(t) for t in data.get("tags", [])]

        raw_diff = data.get("estimated_difficulty", 1.0)
        try:
            diff = float(raw_diff)
        except (ValueError, TypeError):
            diff = 1.0

        required_tools = [str(tool) for tool in data.get("required_tools", [])]
        context = dict(data.get("context", {}))
        metadata = dict(data.get("metadata", {}))

        return cls(
            task_id=task_id,
            title=title,
            body=body,
            tags=tags,
            estimated_difficulty=diff,
            required_tools=required_tools,
            context=context,
            metadata=metadata,
        )


@dataclass
class RoutingDecision:
    """Decision outcome containing selected agent, candidate scoring, risk assessment, and rationale."""

    decision_id: str
    task_id: str
    selected_agent_id: str
    selected_profile_name: str
    candidate_scores: dict[str, float]
    risk_assessment: RiskAssessment
    router_used: str  # "jev" | "heuristic" | "fallback"
    confidence: float  # 0.0 to 1.0
    rationale: str
    timestamp: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "task_id": self.task_id,
            "selected_agent_id": self.selected_agent_id,
            "selected_profile_name": self.selected_profile_name,
            "candidate_scores": {k: round(v, 4) for k, v in self.candidate_scores.items()},
            "risk_assessment": self.risk_assessment.to_dict(),
            "router_used": self.router_used,
            "confidence": round(self.confidence, 4),
            "rationale": self.rationale,
            "timestamp": self.timestamp,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RoutingDecision:
        risk = RiskAssessment.from_dict(data.get("risk_assessment"))
        return cls(
            decision_id=str(data.get("decision_id", str(uuid.uuid4()))),
            task_id=str(data.get("task_id", "")),
            selected_agent_id=str(data.get("selected_agent_id", "")),
            selected_profile_name=str(data.get("selected_profile_name", "")),
            candidate_scores={str(k): float(v) for k, v in data.get("candidate_scores", {}).items()},
            risk_assessment=risk,
            router_used=str(data.get("router_used", "heuristic")),
            confidence=float(data.get("confidence", 0.0)),
            rationale=str(data.get("rationale", "")),
            timestamp=float(data.get("timestamp", time.time())),
            metadata=dict(data.get("metadata", {})),
        )


# ---------------------------------------------------------------------------
# Standard Candidate Profiles (Tyler, Artist, Coder, DevOps, QA)
# ---------------------------------------------------------------------------

DEFAULT_CANDIDATES: list[AgentCandidate] = [
    AgentCandidate(
        agent_id="tyler",
        profile_name="Tyler",
        role="Managing Director",
        capabilities=["leadership", "planning", "coordination", "strategy", "management", "architecture_review", "orchestration"],
        operational_stats=OperationalStats(latency_ms=120.0, error_rate=0.01, cost_per_token=0.00003, success_rate=0.99),
        gamification_stats=GamificationStats(xp=5000, level=10, badges=["founding_director", "strategist"]),
        metadata={"desk": "executive", "position": [0, 0]},
    ),
    AgentCandidate(
        agent_id="artist",
        profile_name="Artist",
        role="Artist",
        capabilities=["3d_modeling", "textures", "concept_art", "rigging", "blender", "visual", "art", "ui_design", "rendering"],
        operational_stats=OperationalStats(latency_ms=450.0, error_rate=0.04, cost_per_token=0.00005, success_rate=0.96),
        gamification_stats=GamificationStats(xp=2800, level=6, badges=["master_sculptor"]),
        metadata={"desk": "creative", "position": [1, 0]},
    ),
    AgentCandidate(
        agent_id="coder",
        profile_name="Coder",
        role="Coder",
        capabilities=["python", "typescript", "architecture", "algorithms", "backend", "frontend", "coding", "refactoring", "bugfix"],
        operational_stats=OperationalStats(latency_ms=210.0, error_rate=0.02, cost_per_token=0.00002, success_rate=0.98),
        gamification_stats=GamificationStats(xp=4200, level=8, badges=["code_wizard", "algorithm_king"]),
        metadata={"desk": "engineering", "position": [0, 1]},
    ),
    AgentCandidate(
        agent_id="devops",
        profile_name="DevOps",
        role="DevOps",
        capabilities=["infrastructure", "docker", "ci_cd", "observability", "deployment", "deploy", "kubernetes", "linux", "cloud"],
        operational_stats=OperationalStats(latency_ms=180.0, error_rate=0.03, cost_per_token=0.00001, success_rate=0.97),
        gamification_stats=GamificationStats(xp=3100, level=7, badges=["cloud_pilot", "pipeline_hero"]),
        metadata={"desk": "operations", "position": [1, 1]},
    ),
    AgentCandidate(
        agent_id="qa",
        profile_name="QA",
        role="QA",
        capabilities=["testing", "regression", "verification", "security", "audit", "qa", "review", "unit_test", "integration_test"],
        operational_stats=OperationalStats(latency_ms=150.0, error_rate=0.015, cost_per_token=0.00002, success_rate=0.985),
        gamification_stats=GamificationStats(xp=3600, level=7, badges=["bug_hunter", "gatekeeper"]),
        metadata={"desk": "quality", "position": [2, 1]},
    ),
]


def get_default_candidates() -> list[AgentCandidate]:
    """Return fresh copy of standard candidate profiles."""
    return [AgentCandidate.from_dict(c.to_dict()) for c in DEFAULT_CANDIDATES]


# ---------------------------------------------------------------------------
# Risk Assessment Engine
# ---------------------------------------------------------------------------


class RiskAssessmentEngine:
    """Classifies task risk level (Low, Medium, High, Critical) and establishes review gates.

    Strict fail-open guarantees: parsing anomalies or unexpected errors never crash,
    falling back to safe assessments.
    """

    # Keyword dictionaries with associated risk points
    CRITICAL_PATTERNS = [
        r"\brm\s+-rf\b",
        r"\bdrop\s+(database|table|schema)\b",
        r"\bwipe\b",
        r"\bformat\s+disk\b",
        r"\broot\s+password\b",
        r"\bbypass\s+(auth|authentication|mfa)\b",
        r"\bexfiltrat(e|ion)\b",
        r"\bwire\s+transfer\b",
        r"\bcredit\s+card\b",
        r"\bfinancial\s+transaction\b",
    ]

    HIGH_PATTERNS = [
        r"\bdeploy\b",
        r"\bproduction\b",
        r"\bprod\b",
        r"\bsecret\b",
        r"\bcredential(s)?\b",
        r"\bprivate_key\b",
        r"\bapi_key\b",
        r"\btoken\b",
        r"\bdelete\b",
        r"\bdrop\b",
        r"\btruncate\b",
        r"\bsudo\b",
        r"\bchmod\s+777\b",
        r"\bgrant\s+all\b",
        r"\bauth\b",
        r"\bpayment\b",
        r"\bbilling\b",
        r"\bmigration\b",
    ]

    MEDIUM_PATTERNS = [
        r"\brefactor\b",
        r"\barchitecture\b",
        r"\bschema\b",
        r"\brelease\b",
        r"\bdependency\s+update\b",
        r"\bupgrade\b",
        r"\bconfig\b",
        r"\binstall\b",
        r"\bexecute\b",
        r"\beval\b",
        r"\bnetwork\b",
        r"\bwrite\b",
    ]

    LOW_PATTERNS = [
        r"\bread\b",
        r"\bquery\b",
        r"\binspect\b",
        r"\bui\b",
        r"\bstyle\b",
        r"\bcss\b",
        r"\bdoc(s)?\b",
        r"\bdocumentation\b",
        r"\bmock\b",
        r"\blint\b",
        r"\bformat\b",
        r"\btest\b",
        r"\bunit\s+test\b",
    ]

    RISK_TOOLS_CRITICAL: Set[str] = {"prod_database_admin", "root_shell", "credential_store", "financial_api"}
    RISK_TOOLS_HIGH: Set[str] = {"bash", "terminal", "ssh", "docker_exec", "database_exec", "deploy_tool", "rm", "sudo"}
    RISK_TOOLS_MEDIUM: Set[str] = {"git_push", "file_writer", "edit", "http_post", "api_call"}

    def assess_risk(self, request: TaskRoutingRequest) -> RiskAssessment:
        """Evaluate task parameters and produce RiskAssessment with fail-open guarantee."""
        try:
            return self._compute_risk(request)
        except Exception as exc:
            logger.warning("Agent Office: Risk assessment failed (fail-open): %s", exc)
            # Safe fail-open response: High risk with pre-approval required to protect system
            return RiskAssessment(
                level=RiskLevel.HIGH,
                score=0.75,
                review_gates=ReviewGate(
                    pre_approval_needed=True,
                    auto_dispatch_allowed=False,
                    post_review_required=True,
                ),
                reasons=[f"Fail-open fallback triggered due to evaluation error: {exc}"],
            )

    def _compute_risk(self, request: TaskRoutingRequest) -> RiskAssessment:
        reasons: list[str] = []
        raw_score = 0.0
        has_critical_indicator = False

        # Combine text content
        combined_text = f"{request.title} {request.body} {' '.join(request.tags)}".lower()

        # 1. Critical pattern checks
        for pat in self.CRITICAL_PATTERNS:
            if re.search(pat, combined_text, re.IGNORECASE):
                reasons.append(f"Matched critical pattern '{pat}'")
                has_critical_indicator = True
                raw_score += 0.95

        # Check critical tools
        for tool in request.required_tools:
            if tool.lower() in self.RISK_TOOLS_CRITICAL:
                reasons.append(f"Requires critical tool: {tool}")
                has_critical_indicator = True
                raw_score += 0.95

        # 2. High risk checks
        high_matches = 0
        for pat in self.HIGH_PATTERNS:
            if re.search(pat, combined_text, re.IGNORECASE):
                high_matches += 1
                reasons.append(f"Matched high risk pattern '{pat}'")
        if high_matches > 0:
            raw_score += min(0.35 + high_matches * 0.15, 0.85)

        for tool in request.required_tools:
            if tool.lower() in self.RISK_TOOLS_HIGH:
                reasons.append(f"Requires elevated risk tool: {tool}")
                raw_score += 0.35

        # 3. Medium risk checks
        med_matches = 0
        for pat in self.MEDIUM_PATTERNS:
            if re.search(pat, combined_text, re.IGNORECASE):
                med_matches += 1
        if med_matches > 0:
            raw_score += min(0.15 + med_matches * 0.08, 0.40)
            reasons.append(f"Matched {med_matches} medium-impact pattern(s)")

        for tool in request.required_tools:
            if tool.lower() in self.RISK_TOOLS_MEDIUM:
                reasons.append(f"Requires write tool: {tool}")
                raw_score += 0.15

        # 4. Estimated difficulty impact
        diff = max(0.0, request.estimated_difficulty)
        # Normalize: if diff is 1-10, scale to 0.0-0.30
        diff_scaled = (diff / 10.0) if diff > 1.0 else (diff * 0.30)
        raw_score += min(diff_scaled * 0.25, 0.25)
        if diff >= 7.0:
            reasons.append(f"High task difficulty estimated ({diff})")

        # 5. Low risk mitigating patterns (only discount if not already critical/high)
        if raw_score < 0.70:
            low_matches = sum(1 for pat in self.LOW_PATTERNS if re.search(pat, combined_text, re.IGNORECASE))
            if low_matches > 0 and not request.required_tools:
                raw_score = max(0.05, raw_score - (low_matches * 0.05))

        if not has_critical_indicator:
            raw_score = min(raw_score, 0.88)

        final_score = max(0.0, min(raw_score, 1.0))

        # Classify risk level and review gates
        if final_score >= 0.90:
            level = RiskLevel.CRITICAL
            gates = ReviewGate(
                pre_approval_needed=True,
                auto_dispatch_allowed=False,
                post_review_required=True,
            )
        elif final_score >= 0.70:
            level = RiskLevel.HIGH
            gates = ReviewGate(
                pre_approval_needed=True,
                auto_dispatch_allowed=False,
                post_review_required=True,
            )
        elif final_score >= 0.35:
            level = RiskLevel.MEDIUM
            gates = ReviewGate(
                pre_approval_needed=False,
                auto_dispatch_allowed=True,
                post_review_required=True,
            )
        else:
            level = RiskLevel.LOW
            gates = ReviewGate(
                pre_approval_needed=False,
                auto_dispatch_allowed=True,
                post_review_required=False,
            )

        if not reasons:
            reasons.append("Standard low-risk operational task")

        return RiskAssessment(
            level=level,
            score=final_score,
            review_gates=gates,
            reasons=reasons,
        )


# ---------------------------------------------------------------------------
# Deterministic Heuristic Fallback Router
# ---------------------------------------------------------------------------


class HeuristicFallbackRouter:
    """Deterministic rule-engine for candidate scoring and agent selection.

    Operates with zero external dependencies and guarantees strict separation of concerns:
    Gamification stats (XP, level, badges) NEVER influence routing decisions.
    Only capabilities, latency, error rate, cost, and load are considered.
    """

    # Domain keyword affinity mappings
    PROFILE_KEYWORDS: dict[str, list[str]] = {
        "coder": [
            "python", "typescript", "javascript", "code", "coding", "algorithm",
            "backend", "frontend", "api", "endpoint", "bug", "fix", "feature",
            "refactor", "function", "class", "syntax", "logic", "database",
            "async", "model", "service", "handler", "controller",
        ],
        "devops": [
            "docker", "dockerfile", "container", "kubernetes", "k8s", "ci", "cd",
            "pipeline", "github actions", "infra", "infrastructure", "terraform",
            "aws", "cloud", "server", "linux", "bash", "deploy", "deployment",
            "nginx", "monitoring", "metrics", "prometheus", "grafana", "systemd",
        ],
        "artist": [
            "3d", "model", "modeling", "texture", "textures", "concept", "concept_art",
            "art", "visual", "blender", "mesh", "rigging", "shader", "render",
            "rendering", "illustration", "sprite", "icon", "drawing", "assets",
        ],
        "qa": [
            "test", "testing", "unit_test", "integration_test", "regression",
            "verification", "verify", "security", "audit", "qa", "review",
            "code_review", "coverage", "assert", "validation", "e2e", "cypress",
        ],
        "tyler": [
            "plan", "planning", "strategy", "roadmap", "coordination", "leadership",
            "management", "executive", "triage", "breakdown", "delegate", "orchestrate",
            "prioritize", "manage", "overview", "direction", "milestone",
        ],
    }

    def __init__(self, candidates: Optional[list[AgentCandidate]] = None) -> None:
        self.candidates = candidates or get_default_candidates()

    def score_candidate(self, candidate: AgentCandidate, request: TaskRoutingRequest) -> float:
        """Compute operational fitness score for candidate on a 0.0 - 1.0 scale.

        NOTE: Strictly ignores gamification_stats (xp, level, badges).
        """
        cid = candidate.agent_id.lower()
        text = f"{request.title} {request.body} {' '.join(request.tags)}".lower()
        words = set(re.findall(r"\w+", text))

        # 1. Capability & Keyword Affinity Matching (Weight: 0.65)
        keywords = self.PROFILE_KEYWORDS.get(cid, [])
        kw_hits = sum(1 for kw in keywords if kw in text)

        # Check explicit capabilities
        cap_hits = sum(1 for cap in candidate.capabilities if cap.lower() in text or cap.lower() in request.tags)

        # Check required tools match with candidate capabilities
        tool_hits = 0
        for tool in request.required_tools:
            tl = tool.lower()
            if any(tl in cap.lower() or cap.lower() in tl for cap in candidate.capabilities):
                tool_hits += 1

        raw_match = (kw_hits * 1.5) + (cap_hits * 2.0) + (tool_hits * 2.5)
        affinity_score = 1.0 - math.exp(-raw_match / 4.0)

        # 2. Operational Stats Fitness (Weight: 0.35)
        ops = candidate.operational_stats
        # Error rate penalty (0.0 to 1.0)
        err_penalty = max(0.0, 1.0 - min(ops.error_rate * 2.0, 0.95))

        # Latency factor (higher latency slightly reduces score)
        lat_factor = 1.0 / (1.0 + max(0.0, ops.latency_ms) / 1000.0)

        # Success rate factor
        success_factor = max(0.1, min(ops.success_rate, 1.0))

        # Active load penalty
        load_penalty = 1.0 / (1.0 + ops.active_tasks * 0.15)

        operational_score = (err_penalty * 0.40) + (lat_factor * 0.20) + (success_factor * 0.25) + (load_penalty * 0.15)

        # 3. Combined Final Score
        final_score = (affinity_score * 0.65) + (operational_score * 0.35)
        return max(0.0, min(round(final_score, 4), 1.0))

    def route(
        self,
        request: TaskRoutingRequest,
        risk_assessment: Optional[RiskAssessment] = None,
    ) -> RoutingDecision:
        """Route task deterministically using operational scoring."""
        if risk_assessment is None:
            engine = RiskAssessmentEngine()
            risk_assessment = engine.assess_risk(request)

        scores: dict[str, float] = {}
        candidate_map: dict[str, AgentCandidate] = {}

        for cand in self.candidates:
            cid = cand.agent_id
            score = self.score_candidate(cand, request)
            scores[cid] = score
            candidate_map[cid] = cand

        # Select highest scoring candidate
        sorted_candidates = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        best_id, best_score = sorted_candidates[0]
        selected = candidate_map[best_id]

        # Calculate confidence
        if len(sorted_candidates) > 1:
            runner_up_score = sorted_candidates[1][1]
            diff = best_score - runner_up_score
            confidence = min(1.0, max(0.40, 0.50 + diff))
        else:
            confidence = 0.90

        rationale = (
            f"Heuristic router selected {selected.profile_name} ({selected.role}) "
            f"with score {best_score:.3f} based on capability affinity and operational reliability."
        )

        return RoutingDecision(
            decision_id=str(uuid.uuid4()),
            task_id=request.task_id,
            selected_agent_id=selected.agent_id,
            selected_profile_name=selected.profile_name,
            candidate_scores=scores,
            risk_assessment=risk_assessment,
            router_used="heuristic",
            confidence=confidence,
            rationale=rationale,
            timestamp=time.time(),
        )


# ---------------------------------------------------------------------------
# Jev Probabilistic Routing Adapter
# ---------------------------------------------------------------------------


class JevAdapter:
    """Adapter for Jev probabilistic routing with structured prompts/schemas and fallback.

    Gracefully activates deterministic HeuristicFallbackRouter when Jev is unavailable,
    unconfigured, or encounters any error during invocation.
    """

    def __init__(
        self,
        client: Optional[Any] = None,
        invoker: Optional[Callable[[dict[str, Any]], dict[str, Any]]] = None,
        fallback_router: Optional[HeuristicFallbackRouter] = None,
        risk_engine: Optional[RiskAssessmentEngine] = None,
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
    ) -> None:
        self.client = client
        self.invoker = invoker
        self.fallback_router = fallback_router or HeuristicFallbackRouter()
        self.risk_engine = risk_engine or RiskAssessmentEngine()
        self.api_key = api_key or os.environ.get("JEV_API_KEY")
        self.endpoint = endpoint or os.environ.get("JEV_ENDPOINT")

    def build_structured_prompt(
        self,
        request: TaskRoutingRequest,
        candidates: list[AgentCandidate],
        risk: RiskAssessment,
    ) -> dict[str, Any]:
        """Construct structured schema payload for Jev probabilistic router."""
        return {
            "schema_version": "1.0",
            "instruction": (
                "You are the Jev probabilistic routing engine for Agent Office. "
                "Analyze task requirements, risk assessment, and candidate capabilities. "
                "Assign probability scores (0.0 to 1.0) to candidates and select the optimal agent. "
                "Return valid JSON matching the schema."
            ),
            "task": {
                "id": request.task_id,
                "title": request.title,
                "description": request.body,
                "tags": request.tags,
                "estimated_difficulty": request.estimated_difficulty,
                "required_tools": request.required_tools,
                "risk_level": risk.level.value,
                "risk_score": risk.score,
            },
            "candidates": [
                {
                    "id": c.agent_id,
                    "name": c.profile_name,
                    "role": c.role,
                    "capabilities": c.capabilities,
                    "operational_stats": c.operational_stats.to_dict(),
                    # Gamification intentionally excluded from Jev operational routing prompt
                }
                for c in candidates
            ],
            "response_schema": {
                "selected_agent_id": "string",
                "confidence": "number (0.0 - 1.0)",
                "candidate_scores": "object mapping agent_id -> number",
                "rationale": "string",
            },
        }

    def is_configured(self) -> bool:
        """Check whether Jev client or invoker is available and configured."""
        return bool(self.invoker is not None or self.client is not None or (self.api_key and self.endpoint))

    def route(
        self,
        request: TaskRoutingRequest,
        candidates: Optional[list[AgentCandidate]] = None,
        risk_assessment: Optional[RiskAssessment] = None,
    ) -> RoutingDecision:
        """Route task using Jev with automatic fail-open heuristic fallback."""
        active_candidates = candidates or self.fallback_router.candidates
        if risk_assessment is None:
            risk_assessment = self.risk_engine.assess_risk(request)

        # 1. If unconfigured, immediately invoke heuristic fallback
        if not self.is_configured():
            logger.info("Jev adapter is unconfigured; activating deterministic heuristic fallback.")
            decision = self.fallback_router.route(request, risk_assessment)
            decision.router_used = "heuristic_fallback"
            decision.rationale = f"Jev unconfigured. {decision.rationale}"
            return decision

        # 2. Build structured prompt
        payload = self.build_structured_prompt(request, active_candidates, risk_assessment)

        # 3. Attempt Jev invocation with exception isolation
        try:
            raw_response = self._invoke_jev(payload)
            decision = self._parse_jev_response(raw_response, request, active_candidates, risk_assessment)
            return decision
        except Exception as exc:
            logger.warning("Agent Office: Jev routing failed (%s); activating heuristic fallback.", exc)
            fallback_decision = self.fallback_router.route(request, risk_assessment)
            fallback_decision.router_used = "heuristic_fallback"
            fallback_decision.rationale = (
                f"Jev invocation failed ({exc.__class__.__name__}: {exc}). "
                f"Activated heuristic fallback: {fallback_decision.rationale}"
            )
            return fallback_decision

    def _invoke_jev(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Execute request against invoker or client."""
        if self.invoker is not None:
            res = self.invoker(payload)
            if isinstance(res, str):
                return json.loads(res)
            return res

        if self.client is not None:
            # Polymorphic client handling
            if hasattr(self.client, "route_task"):
                res = self.client.route_task(payload)
            elif hasattr(self.client, "predict"):
                res = self.client.predict(payload)
            elif callable(self.client):
                res = self.client(payload)
            else:
                raise ValueError("Jev client does not provide a callable route_task or predict method")

            if isinstance(res, str):
                return json.loads(res)
            return res

        raise RuntimeError("No invoker or active client configured for Jev adapter")

    def _parse_jev_response(
        self,
        response: Any,
        request: TaskRoutingRequest,
        candidates: list[AgentCandidate],
        risk_assessment: RiskAssessment,
    ) -> RoutingDecision:
        """Validate and construct RoutingDecision from Jev response schema."""
        if not isinstance(response, dict):
            raise ValueError(f"Jev response must be a JSON dictionary, got {type(response)}")

        selected_id = str(response.get("selected_agent_id", "")).strip().lower()
        candidate_ids = {c.agent_id.lower(): c for c in candidates}

        if not selected_id or selected_id not in candidate_ids:
            raise ValueError(f"Invalid selected_agent_id '{selected_id}' from Jev (valid: {list(candidate_ids.keys())})")

        selected_candidate = candidate_ids[selected_id]
        confidence = float(response.get("confidence", 0.85))
        confidence = max(0.0, min(confidence, 1.0))

        raw_scores = response.get("candidate_scores", {})
        scores: dict[str, float] = {}
        if isinstance(raw_scores, dict):
            for cid in candidate_ids:
                if cid in raw_scores:
                    try:
                        scores[cid] = float(raw_scores[cid])
                    except (ValueError, TypeError):
                        scores[cid] = 0.0
                else:
                    scores[cid] = 0.1
        else:
            scores = {cid: (0.9 if cid == selected_id else 0.1) for cid in candidate_ids}

        scores[selected_id] = max(scores.get(selected_id, 0.0), confidence)
        rationale = str(response.get("rationale") or f"Jev probabilistic router selected {selected_candidate.profile_name}")

        return RoutingDecision(
            decision_id=str(uuid.uuid4()),
            task_id=request.task_id,
            selected_agent_id=selected_candidate.agent_id,
            selected_profile_name=selected_candidate.profile_name,
            candidate_scores=scores,
            risk_assessment=risk_assessment,
            router_used="jev",
            confidence=confidence,
            rationale=rationale,
            timestamp=time.time(),
        )


# Global default instances
_GLOBAL_ROUTER: Optional[Union[HeuristicFallbackRouter, JevAdapter]] = None


def get_default_router() -> JevAdapter:
    """Return default JevAdapter instance."""
    global _GLOBAL_ROUTER
    if _GLOBAL_ROUTER is None:
        _GLOBAL_ROUTER = JevAdapter()
    return _GLOBAL_ROUTER
