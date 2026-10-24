"""Decision Plane: Probabilistic Routing with Jev and Fallback for Agent Office.

Implements typed domain models, risk assessment, deterministic heuristic fallback routing,
Jev probabilistic routing adapter, and strict decoupling of gamification from operational routing.
"""

from __future__ import annotations

from contextlib import contextmanager
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
        agent_id="webdev",
        profile_name="WebDev",
        role="Web Engineer",
        capabilities=["react", "typescript", "tailwind", "vite", "web_apis", "browser_testing", "performance", "frontend", "ui_design", "coding", "code_writing"],
        operational_stats=OperationalStats(latency_ms=190.0, error_rate=0.018, cost_per_token=0.00002, success_rate=0.98),
        gamification_stats=GamificationStats(xp=3500, level=7, badges=["component_architect", "pixel_perfect"]),
        metadata={"desk": "frontend", "position": [2, 0]},
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
        "webdev": [
            "react", "typescript", "tailwind", "vite", "frontend", "ui", "web",
            "component", "dom", "css", "browser", "html", "javascript", "web_apis",
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


# ---------------------------------------------------------------------------
# Model and Role Dispatch Routing (AO-NE-02 / AO-NODE-EDITOR-SPEC-v1 §2, §8)
# ---------------------------------------------------------------------------


class FailureKind(str, Enum):
    """Classification of attempt failure for routing policy decisions."""

    QUOTA = "quota"
    AUTH = "auth"
    PRODUCT_DEFECT = "product_defect"
    TIMEOUT = "timeout"
    UNKNOWN = "unknown"


def classify_failure(
    error_msg: str,
    exit_code: Optional[int] = None,
    is_test_failure: bool = False,
) -> FailureKind:
    """Classify failure string and exit code into FailureKind.

    Invariants:
    1. Product defects and test failures NEVER trigger provider roulette.
    2. Quota / 429 / session limits place provider in cooldown and fail over.
    3. Auth errors (401/403) are NOT quota: require explicit credential-route, else block.
    4. Timeouts fence worker and inspect partial results.
    """
    if is_test_failure:
        return FailureKind.PRODUCT_DEFECT

    text = (error_msg or "").strip().lower()

    # 1. Product defect heuristics (assertions, test frameworks, syntax errors)
    if re.search(r"\b(?:assertionerror|failed test|failures=|tests failed|pytest|unittest|defect)\b", text):
        return FailureKind.PRODUCT_DEFECT

    # 2. Quota and rate limiting heuristics
    if re.search(
        r"\b(?:session limit|usage limit|hit your session limit|usage limit has been reached|"
        r"rate limit|rate_limit_error|quota|insufficient_quota|resource_exhausted|overloaded|429)\b",
        text,
    ):
        return FailureKind.QUOTA

    # 3. Authentication and authorization heuristics
    if re.search(
        r"\b(?:401|403|unauthorized|forbidden|authentication_error|invalid_api_key|"
        r"invalid api key|bad_token|permission_denied)\b",
        text,
    ):
        return FailureKind.AUTH

    # 4. Timeout heuristics
    if re.search(r"\b(?:timeout|timed out|deadline exceeded|execution_timeout)\b", text):
        return FailureKind.TIMEOUT

    # Exit code analysis
    if exit_code is not None and exit_code > 0:
        return FailureKind.PRODUCT_DEFECT

    return FailureKind.UNKNOWN


@dataclass
class RouteCandidate:
    """Candidate execution route combining model, provider, and adapter."""

    route_id: str
    provider: str
    model: str
    executor: str  # "omo" | "claude"
    priority: int = 1
    enabled: bool = True
    capabilities: list[str] = field(default_factory=lambda: ["code_writing", "text"])
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "route_id": self.route_id,
            "provider": self.provider,
            "model": self.model,
            "executor": self.executor,
            "priority": self.priority,
            "enabled": self.enabled,
            "capabilities": list(self.capabilities),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RouteCandidate:
        return cls(
            route_id=str(data.get("route_id") or data.get("id") or str(uuid.uuid4())),
            provider=str(data.get("provider", "unknown")),
            model=str(data.get("model", "")),
            executor=str(data.get("executor", "omo")),
            priority=int(data.get("priority", 1)),
            enabled=bool(data.get("enabled", True)),
            capabilities=list(data.get("capabilities", ["code_writing", "text"])),
            metadata=dict(data.get("metadata", {})),
        )


@dataclass
class ModelPolicy:
    """Ordered model dispatch policy supporting priority and provider round-robin."""

    policy_id: str
    revision: str = "v1"
    strategy: str = "priority"  # "priority" | "round_robin"
    routes: list[RouteCandidate] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "revision": self.revision,
            "strategy": self.strategy,
            "routes": [r.to_dict() for r in self.routes],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ModelPolicy:
        raw_routes = data.get("routes", [])
        routes = [RouteCandidate.from_dict(r) for r in raw_routes]
        return cls(
            policy_id=str(data.get("policy_id", "default_policy")),
            revision=str(data.get("revision", "v1")),
            strategy=str(data.get("strategy", "priority")).lower(),
            routes=routes,
        )


@dataclass
class RouteResolution:
    """Resolved execution route for a specific attempt."""

    route_id: str
    provider: str
    requested_model: str
    executor: str
    role: str
    policy_id: str
    policy_strategy: str
    actual_model: Optional[str] = None
    model_evidence: Optional[str] = None
    reservation_id: Optional[str] = None
    attempt_no: int = 1
    fallback_reasons: list[str] = field(default_factory=list)

    def record_actual_model(self, actual: Optional[str], evidence: Optional[str] = None) -> None:
        """Record verified actual model or mark explicitly as unknown."""
        act_str = str(actual or "").strip()
        if act_str:
            self.actual_model = act_str
            self.model_evidence = evidence or "executor_reported"
        else:
            self.actual_model = "unknown"
            self.model_evidence = "unverified"

    def to_dict(self) -> dict[str, Any]:
        return {
            "route_id": self.route_id,
            "provider": self.provider,
            "requested_model": self.requested_model,
            "executor": self.executor,
            "role": self.role,
            "policy_id": self.policy_id,
            "policy_strategy": self.policy_strategy,
            "actual_model": self.actual_model,
            "model_evidence": self.model_evidence,
            "reservation_id": self.reservation_id,
            "attempt_no": self.attempt_no,
            "fallback_reasons": list(self.fallback_reasons),
        }


def intersect_capabilities(
    role_capabilities: list[str],
    route_capabilities: list[str],
    executor_capabilities: list[str],
    required_capabilities: list[str],
    model: str = "",
    executor: str = "omo",
) -> tuple[bool, list[str]]:
    """Verify orthogonal capability intersection and architectural compatibility.

    Invariants:
    1. 3D/image generators never serve as fallback routes for code-writing tasks.
    2. Claude models must run via Claude CLI adapter, not OMO.
    3. Non-Claude models must not be submitted to Claude CLI adapter.
    """
    reasons: list[str] = []
    req_set = {c.lower() for c in required_capabilities}

    # 1. Reject 3D / visual generators for code tasks
    is_code_task = bool(req_set & {"code_writing", "coding", "python", "typescript", "bugfix", "refactor"})
    is_3d_route = any("3d" in c.lower() or "visual" in c.lower() for c in route_capabilities)
    if is_code_task and is_3d_route and not any(c.lower() in ("code_writing", "coding") for c in route_capabilities):
        reasons.append("3D/image generator cannot serve as fallback for code-writing task")
        return False, reasons

    # 2. Executor / Model compatibility matrix
    m_lower = model.lower()
    if executor == "omo" and "claude" in m_lower:
        reasons.append(f"Claude model '{model}' cannot run on OMO executor")
        return False, reasons
    if executor == "claude" and not ("claude" in m_lower or "anthropic" in m_lower):
        reasons.append(f"Non-Claude model '{model}' cannot run on Claude executor")
        return False, reasons

    # 3. Required capabilities check against union of role, route, executor
    # Route must provide core capabilities (e.g. text/code)
    for rc in required_capabilities:
        rc_lower = rc.lower()
        has_in_route = any(rc_lower in c.lower() or c.lower() in rc_lower for c in route_capabilities)
        has_in_role = any(rc_lower in c.lower() or c.lower() in rc_lower for c in role_capabilities)
        if not (has_in_route or has_in_role):
            reasons.append(f"Required capability '{rc}' not satisfied by route or role")
            return False, reasons

    return True, []


class DurableRouteStore:
    """Thread-safe SQLite store for provider cooldowns, cursors, and route reservations."""

    def __init__(self, db_path: str = ":memory:") -> None:
        import sqlite3
        import threading

        self.db_path = db_path
        self._sqlite3 = sqlite3
        self._lock = threading.RLock()
        if db_path == ":memory:":
            self._mem_conn = sqlite3.connect(":memory:", check_same_thread=False, timeout=30.0)
            self._mem_conn.row_factory = sqlite3.Row
        else:
            self._mem_conn = None
        self._init_schema()

    @contextmanager
    def _get_connection(self):
        with self._lock:
            conn = self._mem_conn
            owned = conn is None
            if owned:
                conn = self._sqlite3.connect(self.db_path, timeout=30.0)
                conn.row_factory = self._sqlite3.Row
            try:
                with conn:
                    yield conn
            finally:
                if owned:
                    conn.close()

    def _init_schema(self) -> None:
        with self._get_connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS provider_cooldowns (
                    provider TEXT PRIMARY KEY,
                    cooldown_until REAL NOT NULL,
                    reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS provider_cursors (
                    policy_key TEXT PRIMARY KEY,
                    cursor INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS route_reservations (
                    reservation_key TEXT PRIMARY KEY,
                    run_id TEXT,
                    activation_id TEXT,
                    attempt_no INTEGER,
                    route_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    requested_model TEXT NOT NULL,
                    executor TEXT NOT NULL,
                    role TEXT NOT NULL,
                    policy_id TEXT,
                    created_at TEXT NOT NULL
                );
                """
            )
            # Add admission lifecycle fields to the existing reservation store.
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(route_reservations)")}
            for name, definition in (
                ("reservation_state", "TEXT"),
                ("cursor_position", "INTEGER"),
                ("cursor_modulo", "INTEGER"),
            ):
                if name not in columns:
                    conn.execute(f"ALTER TABLE route_reservations ADD COLUMN {name} {definition}")
            conn.commit()

    def reserve_round_robin(self, policy_key: str, routes: list[dict[str, str]], role: str) -> dict[str, Any]:
        """Persist a provisional choice without consuming a turn.

        Concurrent reservations may select the same position. Only the first
        successful commit wins; stale callers must reserve again AND repeat host
        authorization. Abandoned reservations never block or advance the cursor.
        Use a revision-scoped policy_key and an immutable ordered route list.
        """
        if not policy_key or not routes:
            raise ValueError("A policy key and routes are required")
        token = uuid.uuid4().hex
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._lock, self._get_connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT cursor FROM provider_cursors WHERE policy_key = ?", (policy_key,)).fetchone()
            position = int(row["cursor"]) if row else 0
            index = position % len(routes)
            route = routes[index]
            conn.execute(
                """INSERT INTO route_reservations
                (reservation_key, route_id, provider, requested_model, executor, role,
                 policy_id, created_at, reservation_state, cursor_position, cursor_modulo)
                VALUES (?, ?, ?, ?, 'native', ?, ?, ?, 'pending', ?, ?)""",
                (token, str(index), route["provider"], route["model"], role,
                 policy_key, now, position, len(routes)),
            )
            return dict(conn.execute("SELECT * FROM route_reservations WHERE reservation_key = ?", (token,)).fetchone())

    def commit_round_robin(self, token: str, policy_key: str) -> bool:
        """Commit exactly once after host admission; False means reselect/reapprove.

        The host must not construct a child if this returns False. Idempotent
        True on a committed token is for reconciliation, NOT a second spawn.
        Cursor values are monotonic to prevent ABA after a full rotation.
        """
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._lock, self._get_connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM route_reservations WHERE reservation_key = ?", (token,)).fetchone()
            if not row or row["policy_id"] != policy_key:
                return False
            if row["reservation_state"] == "committed":
                return True
            if row["reservation_state"] != "pending":
                return False
            cursor = conn.execute("SELECT cursor FROM provider_cursors WHERE policy_key = ?", (policy_key,)).fetchone()
            position = int(cursor["cursor"]) if cursor else 0
            if position != row["cursor_position"]:
                conn.execute("UPDATE route_reservations SET reservation_state = 'stale' WHERE reservation_key = ?", (token,))
                return False
            conn.execute(
                """INSERT INTO provider_cursors (policy_key, cursor, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(policy_key) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at""",
                (policy_key, position + 1, now),
            )
            conn.execute("UPDATE route_reservations SET reservation_state = 'committed' WHERE reservation_key = ?", (token,))
            return True

    def release_round_robin(self, token: str) -> bool:
        """Cancel a pending/stale selection. Never undo an admitted turn."""
        with self._lock, self._get_connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            result = conn.execute(
                """UPDATE route_reservations SET reservation_state = 'released'
                WHERE reservation_key = ? AND reservation_state IN ('pending', 'stale')""", (token,)
            )
            return result.rowcount == 1

    def set_provider_cooldown(self, provider: str, duration_seconds: float = 1800.0, reason: str = "") -> None:
        cooldown_until = time.time() + duration_seconds
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO provider_cooldowns (provider, cooldown_until, reason, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                    cooldown_until = excluded.cooldown_until,
                    reason = excluded.reason,
                    updated_at = excluded.updated_at;
                """,
                (provider, cooldown_until, reason, now, now),
            )
            conn.commit()

    def get_provider_cooldown(self, provider: str) -> Optional[float]:
        now = time.time()
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT cooldown_until FROM provider_cooldowns WHERE provider = ?;",
                (provider,),
            ).fetchone()
            if row:
                until = float(row["cooldown_until"])
                if until > now:
                    return until
                conn.execute("DELETE FROM provider_cooldowns WHERE provider = ?;", (provider,))
                conn.commit()
            return None

    def is_provider_in_cooldown(self, provider: str) -> bool:
        return self.get_provider_cooldown(provider) is not None

    def clear_provider_cooldown(self, provider: str) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM provider_cooldowns WHERE provider = ?;", (provider,))
            conn.commit()

    def get_provider_cursor(self, policy_key: str) -> int:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT cursor FROM provider_cursors WHERE policy_key = ?;",
                (policy_key,),
            ).fetchone()
            if row:
                return int(row["cursor"])
            return 0

    def set_provider_cursor(self, policy_key: str, cursor: int) -> None:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO provider_cursors (policy_key, cursor, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(policy_key) DO UPDATE SET
                    cursor = excluded.cursor,
                    updated_at = excluded.updated_at;
                """,
                (policy_key, cursor, now),
            )
            conn.commit()

    def advance_cursor_atomic(self, policy_key: str, modulo: int) -> int:
        if modulo <= 0:
            return 0
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._lock:
            with self._get_connection() as conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(
                    "SELECT cursor FROM provider_cursors WHERE policy_key = ?;",
                    (policy_key,),
                ).fetchone()
                current = int(row["cursor"]) if row else 0
                selected = current % modulo
                nxt = (selected + 1) % modulo
                conn.execute(
                    """
                    INSERT INTO provider_cursors (policy_key, cursor, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(policy_key) DO UPDATE SET
                        cursor = excluded.cursor,
                        updated_at = excluded.updated_at;
                    """,
                    (policy_key, nxt, now),
                )
                conn.commit()
                return selected

    def get_reservation(self, reservation_key: str) -> Optional[dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM route_reservations WHERE reservation_key = ?;",
                (reservation_key,),
            ).fetchone()
            if row:
                return dict(row)
            return None

    def save_reservation(
        self,
        reservation_key: str,
        run_id: str,
        activation_id: str,
        attempt_no: int,
        route_id: str,
        provider: str,
        requested_model: str,
        executor: str,
        role: str,
        policy_id: str = "",
    ) -> bool:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO route_reservations (
                    reservation_key, run_id, activation_id, attempt_no,
                    route_id, provider, requested_model, executor, role, policy_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(reservation_key) DO NOTHING;
                """,
                (
                    reservation_key,
                    run_id,
                    activation_id,
                    attempt_no,
                    route_id,
                    provider,
                    requested_model,
                    executor,
                    role,
                    policy_id,
                    now,
                ),
            )
            conn.commit()
            return True


class ModelDispatchRouter:
    """Normative Model & Role Dispatch Router implementing AO-NODE-EDITOR-SPEC-v1 §2 & §8."""

    def __init__(self, store: Optional[DurableRouteStore] = None) -> None:
        self.store = store or DurableRouteStore(":memory:")

    def resolve_route(
        self,
        role: str,
        policy: ModelPolicy,
        required_capabilities: Optional[list[str]] = None,
        role_capabilities: Optional[list[str]] = None,
        executor_capabilities: Optional[dict[str, list[str]]] = None,
        allowed_executors: Optional[list[str]] = None,
        allowed_models: Optional[list[str]] = None,
        run_id: Optional[str] = None,
        activation_id: Optional[str] = None,
        attempt_no: int = 1,
        policy_key: Optional[str] = None,
    ) -> tuple[Optional[RouteResolution], list[str]]:
        """Resolve candidate route from policy with durable cursor, reservation, and cooldown checks."""
        req_caps = required_capabilities or ["code_writing"]
        role_caps = role_capabilities or []
        exec_caps = executor_capabilities or {"omo": ["code_writing", "text"], "claude": ["code_writing", "text"]}
        p_key = policy_key or (f"role:{role}" if role else "default_policy")

        # 1. Check existing reservation for this exact attempt (Idempotent continuation)
        reservation_key = None
        if run_id and activation_id:
            reservation_key = f"{run_id}:{activation_id}:{attempt_no}"
            existing = self.store.get_reservation(reservation_key)
            if existing:
                res = RouteResolution(
                    route_id=existing["route_id"],
                    provider=existing["provider"],
                    requested_model=existing["requested_model"],
                    executor=existing["executor"],
                    role=existing["role"],  # Role preserved
                    policy_id=existing["policy_id"],
                    policy_strategy=policy.strategy,
                    reservation_id=reservation_key,
                    attempt_no=attempt_no,
                    fallback_reasons=["Restored from durable route reservation"],
                )
                return res, []

        reasons: list[str] = []
        enabled_routes = [r for r in policy.routes if r.enabled]
        if not enabled_routes:
            return None, ["Policy contains no enabled routes"]

        # Filter candidates by allowlists and capability intersection
        compatible_routes: list[RouteCandidate] = []
        for cand in enabled_routes:
            if allowed_executors and cand.executor not in allowed_executors:
                reasons.append(f"Route '{cand.route_id}' executor '{cand.executor}' not in allowed_executors")
                continue
            if allowed_models and cand.model not in allowed_models:
                reasons.append(f"Route '{cand.route_id}' model '{cand.model}' not in allowed_models")
                continue

            ex_caps = exec_caps.get(cand.executor, ["code_writing", "text"])
            ok, cap_reasons = intersect_capabilities(
                role_capabilities=role_caps,
                route_capabilities=cand.capabilities,
                executor_capabilities=ex_caps,
                required_capabilities=req_caps,
                model=cand.model,
                executor=cand.executor,
            )
            if not ok:
                reasons.extend(cap_reasons)
                continue

            compatible_routes.append(cand)

        if not compatible_routes:
            return None, reasons or ["No compatible routes match capability intersection"]

        chosen: Optional[RouteCandidate] = None

        # Strategy 1: Provider Round Robin
        if policy.strategy == "round_robin":
            providers: list[str] = []
            for r in compatible_routes:
                if r.provider not in providers:
                    providers.append(r.provider)

            n_prov = len(providers)
            start_idx = self.store.advance_cursor_atomic(p_key, n_prov)

            for step in range(n_prov):
                idx = (start_idx + step) % n_prov
                prov = providers[idx]
                if self.store.is_provider_in_cooldown(prov):
                    reasons.append(f"Provider '{prov}' is in cooldown")
                    continue

                prov_cands = [r for r in compatible_routes if r.provider == prov]
                prov_cands.sort(key=lambda r: r.priority)
                chosen = prov_cands[0]
                break

        # Strategy 2: Priority (default)
        else:
            sorted_routes = sorted(compatible_routes, key=lambda r: r.priority)
            for cand in sorted_routes:
                if self.store.is_provider_in_cooldown(cand.provider):
                    reasons.append(f"Provider '{cand.provider}' is in cooldown (route '{cand.route_id}')")
                    continue
                chosen = cand
                break

        if not chosen:
            return None, reasons or ["All candidate routes exhausted due to cooldown or filters"]

        # Commit reservation if run_id / activation_id present
        if reservation_key:
            self.store.save_reservation(
                reservation_key=reservation_key,
                run_id=str(run_id),
                activation_id=str(activation_id),
                attempt_no=attempt_no,
                route_id=chosen.route_id,
                provider=chosen.provider,
                requested_model=chosen.model,
                executor=chosen.executor,
                role=role,  # Strictly preserve role
                policy_id=policy.policy_id,
            )

        resolution = RouteResolution(
            route_id=chosen.route_id,
            provider=chosen.provider,
            requested_model=chosen.model,
            executor=chosen.executor,
            role=role,
            policy_id=policy.policy_id,
            policy_strategy=policy.strategy,
            reservation_id=reservation_key,
            attempt_no=attempt_no,
            fallback_reasons=reasons,
        )
        return resolution, reasons

