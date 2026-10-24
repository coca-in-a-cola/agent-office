"""Lightweight HTTP server and state API for Agent Office.

Serves /api/state containing current agents, task snapshots, and activity events
from SQLite storage with fail-open fallback, the Process Studio workflow API under
/api/workflow/ (fail-closed, backed by Workflow Core), and static web assets for
the frontend.
"""

from __future__ import annotations

import argparse
import base64
import hmac
from http import HTTPStatus
from http.cookies import SimpleCookie, CookieError
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import mimetypes
import os
from pathlib import Path
import sys
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Union
from urllib.parse import parse_qs, unquote, urlparse

from .storage import (
    OfficeStorage,
    TaskBridgeReader,
    apply_bridge_projection,
    apply_workflow_projection,
    get_default_storage,
)
from .auth import SessionStore, telegram_role, validate_telegram_init_data
from .editor import EditorApiError, EditorService
from .workflow.service import WorkflowApiError, WorkflowService

logger = logging.getLogger("agent_office.server")

MAX_JSON_BODY = 1024 * 1024
WORKFLOW_PREFIX = "/api/workflow"
EDITOR_PREFIX = "/api/editor"
RUN_COMMANDS = ("pause", "resume", "cancel", "approve", "retry")
MONITOR_TAIL_LINES = 100
MONITOR_TAIL_MAX = 1000

ROLE_GRANTS: dict[str, set[str]] = {
    "managing_director": {"create_run", "pause", "resume", "cancel", "retry", "approve", "publish_artifact", "publish_definition", "read_logs"},
    "admin": {"create_run", "pause", "resume", "cancel", "retry", "approve", "publish_artifact", "publish_definition", "read_logs"},
    "operator": {"create_run", "pause", "resume", "cancel", "retry", "publish_definition", "read_logs"},
    "qa": {"publish_definition", "read_logs"},
    "webdev": {"publish_definition", "read_logs"},
    "coder": {"publish_definition", "read_logs"},
    "guest": set(),
}
ROLE_GRANTS["owner"] = ROLE_GRANTS["managing_director"].copy()
ACTOR_GRANTS: dict[str, set[str]] = {
    "tyler": {"create_run", "pause", "resume", "cancel", "retry", "approve", "publish_artifact", "publish_definition", "read_logs"},
    "owner": {"create_run", "pause", "resume", "cancel", "retry", "approve", "publish_artifact", "publish_definition", "read_logs"},
    "operator": {"create_run", "pause", "resume", "cancel", "retry", "publish_definition", "read_logs"},
}


class ApiError(Exception):
    """Non-workflow API failure carrying an HTTP status."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message

# Standard workstation profiles for the isometric office layout
DEFAULT_WORKSTATIONS: list[dict[str, Any]] = [
    {
        "id": "tyler",
        "profile_name": "Tyler",
        "role": "Managing Director",
        "status": "idle",
        "current_model": "anthropic/claude-3-7-sonnet",
        "models": [
            {"model": "antigravity/gemini-3.8-flash-high", "provider": "antigravity", "priority": 1},
            {"model": "openai-broker/gpt-6.1-sol", "provider": "openai-broker", "priority": 2},
            {"model": "claude-opus-5-5", "provider": "anthropic", "priority": 3},
        ],
        "routing_strategy": "priority",
        "capabilities": ["leadership", "planning", "coordination", "strategy"],
        "metadata": {"desk": "executive", "position": [0, 0], "avatar": "tyler"},
    },
    {
        "id": "artist",
        "profile_name": "Artist",
        "role": "Artist",
        "status": "idle",
        "current_model": "tripo/hunyuan3d-2.0",
        "models": [
            {"model": "antigravity/gemini-3.8-flash-high", "provider": "antigravity", "priority": 1},
            {"model": "tripo/hunyuan3d-2.0", "provider": "tripo", "priority": 2},
        ],
        "routing_strategy": "priority",
        "capabilities": ["3d_modeling", "textures", "concept_art", "rigging"],
        "metadata": {"desk": "creative", "position": [1, 0], "avatar": "artist"},
    },
    {
        "id": "coder",
        "profile_name": "Coder",
        "role": "Game Developer (Godot)",
        "status": "idle",
        "current_model": "anthropic/claude-3-5-sonnet",
        "models": [
            {"model": "antigravity/gemini-3.8-flash-high", "provider": "antigravity", "priority": 1},
            {"model": "openai-broker/gpt-6.1-sol", "provider": "openai-broker", "priority": 2},
            {"model": "claude-opus-5-5", "provider": "anthropic", "priority": 3},
        ],
        "routing_strategy": "priority",
        "capabilities": ["godot4", "gdscript", "c_sharp", "shaders", "physics", "rendering"],
        "metadata": {"desk": "engineering", "position": [0, 1], "avatar": "coder"},
    },
    {
        "id": "webdev",
        "profile_name": "WebDev",
        "role": "Web Engineer",
        "status": "idle",
        "current_model": "anthropic/claude-3-5-sonnet",
        "models": [
            {"model": "antigravity/gemini-3.8-flash-high", "provider": "antigravity", "priority": 1},
            {"model": "openai-broker/gpt-6.1-sol", "provider": "openai-broker", "priority": 2},
            {"model": "claude-opus-5-5", "provider": "anthropic", "priority": 3},
        ],
        "routing_strategy": "priority",
        "capabilities": ["react", "typescript", "tailwind", "vite", "web_apis",
                         "browser_testing", "performance"],
        "metadata": {"desk": "frontend", "position": [2, 0], "avatar": "webdev"},
    },
    {
        "id": "devops",
        "profile_name": "DevOps",
        "role": "DevOps",
        "status": "idle",
        "current_model": "anthropic/claude-3-5-haiku",
        "models": [
            {"model": "antigravity/gemini-3.8-flash-high", "provider": "antigravity", "priority": 1},
            {"model": "openai-broker/gpt-6.1-sol", "provider": "openai-broker", "priority": 2},
            {"model": "claude-opus-5-5", "provider": "anthropic", "priority": 3},
        ],
        "routing_strategy": "priority",
        "capabilities": ["infrastructure", "docker", "ci_cd", "observability"],
        "metadata": {"desk": "operations", "position": [1, 1], "avatar": "devops"},
    },
    {
        "id": "qa",
        "profile_name": "QA",
        "role": "QA",
        "status": "idle",
        "current_model": "anthropic/claude-3-5-sonnet",
        "models": [
            {"model": "antigravity/gemini-3.8-flash-high", "provider": "antigravity", "priority": 1},
            {"model": "openai-broker/gpt-6.1-sol", "provider": "openai-broker", "priority": 2},
            {"model": "claude-opus-5-5", "provider": "anthropic", "priority": 3},
        ],
        "routing_strategy": "priority",
        "capabilities": ["testing", "regression", "verification", "security"],
        "metadata": {"desk": "quality", "position": [2, 1], "avatar": "qa"},
    },
]

VALID_STATUSES = {
    "working",
    "researching",
    "review",
    "blocked",
    "awaiting_human",
    "defect",
    "idle",
}


def normalize_status(status: Optional[str]) -> str:
    """Normalize arbitrary status strings into standard visual profile status badges."""
    if not status:
        return "idle"
    s = status.strip().lower().replace("-", "_").replace(" ", "_")
    if s in ("working", "coding", "typing", "in_progress", "running", "executing"):
        return "working"
    if s in ("researching", "planning", "exploring", "searching"):
        return "researching"
    if s in ("review", "reviewing", "testing", "evaluating"):
        return "review"
    if s in ("blocked", "error", "failed", "crash", "timed_out", "timeout"):
        return "blocked"
    if s == "defect":
        return "defect"
    if s in ("awaiting_human", "human_input", "paused", "waiting_approval", "prompt"):
        return "awaiting_human"
    return "idle"


def get_default_static_dir() -> Path:
    """Determine the default location of frontend static build assets."""
    # Priority: web/dist -> dist -> ui/dist
    base_dir = Path(__file__).resolve().parent.parent
    candidates = [
        base_dir / "web" / "dist",
        base_dir / "dist",
        base_dir / "ui" / "dist",
    ]
    for c in candidates:
        if c.is_dir() and (c / "index.html").exists():
            return c
    # Return first candidate path even if not yet created
    return candidates[0]


def get_office_state(
    storage: Optional[OfficeStorage] = None,
    workflow: Optional[WorkflowService] = None,
    bridge: Optional[TaskBridgeReader] = None,
) -> dict[str, Any]:
    """Retrieve full office state with fail-open fallback.

    Merges persisted agent entities with standard workstation profiles,
    attaches active task snapshots and recent activity logs, then projects
    live Workflow Core runs (node attempts, Bridge task ids, approval gates)
    onto the workstation that performs each node. When a Task Bridge reader
    is configured, running Bridge tasks are reflected on the workstation
    they belong to (workflow assignments keep precedence).
    """
    store = storage if storage is not None else get_default_storage()
    now = time.time()

    stored_agents: list[dict[str, Any]] = []
    stored_tasks: list[dict[str, Any]] = []
    stored_activities: list[dict[str, Any]] = []
    is_fallback = False

    try:
        stored_agents = store.list_agents(limit=100)
    except Exception as exc:
        logger.warning("Failed to query agents (fail-open): %s", exc)
        is_fallback = True

    try:
        stored_tasks = store.list_recent_tasks(limit=100)
    except Exception as exc:
        logger.warning("Failed to query tasks (fail-open): %s", exc)
        is_fallback = True

    try:
        stored_activities = store.list_activity_events(limit=100)
    except Exception as exc:
        logger.warning("Failed to query activity events (fail-open): %s", exc)
        is_fallback = True

    # Build agent map indexed by normalized ID and profile_name
    agent_map: dict[str, dict[str, Any]] = {}

    # Seed with standard workstation defaults
    for default_ws in DEFAULT_WORKSTATIONS:
        ws = dict(default_ws)
        ws["last_seen_at"] = now
        agent_map[ws["id"].lower()] = ws

    # Merge or insert stored agents
    for sa in stored_agents:
        aid = str(sa.get("id") or "").lower()
        if not aid:
            continue
        existing = agent_map.get(aid, {})
        merged = dict(existing)
        merged.update({k: v for k, v in sa.items() if v is not None})
        merged["id"] = sa.get("id") or aid
        merged["profile_name"] = sa.get("profile_name") or merged.get("profile_name") or aid.capitalize()
        merged["role"] = sa.get("role") or merged.get("role") or "Agent"
        merged["status"] = normalize_status(sa.get("status") or merged.get("status"))
        merged["current_model"] = (
            sa.get("current_model")
            if sa.get("current_model") is not None
            else "unknown"
            if isinstance(sa.get("metadata"), dict) and (sa.get("metadata") or {}).get("policy_only")
            else (merged.get("current_model") or "unknown")
        )
        merged["capabilities"] = sa.get("capabilities") or merged.get("capabilities") or []
        merged["metadata"] = sa.get("metadata") or merged.get("metadata") or {}
        merged["last_seen_at"] = sa.get("last_seen_at") if sa.get("last_seen_at") is not None else now
        merged["models"] = sa.get("models") or merged.get("models") or []
        merged["routing_strategy"] = sa.get("routing_strategy") or merged.get("routing_strategy") or "priority"
        agent_map[aid] = merged

    # Map active tasks to agents
    # Task assignees can match agent id, profile_name, or role (case-insensitive)
    for agent in agent_map.values():
        agent["status"] = normalize_status(agent.get("status"))
        aid = str(agent.get("id") or "").lower()
        name = str(agent.get("profile_name") or "").lower()
        role = str(agent.get("role") or "").lower()

        # Find first matching active task
        agent_tasks = [
            t
            for t in stored_tasks
            if str(t.get("assignee") or "").lower() in (aid, name, role)
            and t.get("status") in ("todo", "in_progress", "doing", "review", "blocked")
        ]
        agent["active_task"] = agent_tasks[0] if agent_tasks else None

        # Find recent tool calls / activities for this agent
        agent_activities = [
            act
            for act in stored_activities
            if str(act.get("agent_id") or "").lower() in (aid, name, role)
        ]
        agent["recent_activities"] = agent_activities[:5]
        agent["last_tool_call"] = agent_activities[0] if agent_activities else None

    # Project workflow runs onto workstations (genuine Workflow Core state)
    projection = "disabled"
    assignments: list[dict[str, Any]] = []
    if workflow is not None:
        try:
            assignments = workflow.workstation_assignments()
            projection = "ok"
        except Exception as exc:
            logger.warning("Failed to project workflow runs (fail-open): %s", exc)
            projection = "error"
    apply_workflow_projection(agent_map, assignments)

    # Ingest Task Bridge worker tasks directly (read-only)
    bridge_ingestion = "disabled"
    bridge_tasks: list[dict[str, Any]] = []
    bridge_active = 0
    if bridge is not None:
        try:
            bridge_tasks = bridge.list_tasks(limit=50)
            bridge_ingestion = "ok"
        except Exception as exc:
            logger.warning("Failed to read Task Bridge tasks (fail-open): %s", exc)
            bridge_ingestion = "error"
    bridge_active = apply_bridge_projection(agent_map, bridge_tasks)

    agents_list = list(agent_map.values())
    # Sort with Tyler first, then by profile_name
    def sort_key(a: dict[str, Any]) -> tuple[int, str]:
        is_tyler = 0 if str(a.get("id", "")).lower() == "tyler" else 1
        return (is_tyler, str(a.get("profile_name", "")))

    agents_list.sort(key=sort_key)

    return {
        "status": "ok",
        "timestamp": now,
        "agents": agents_list,
        "tasks": stored_tasks,
        "recent_activities": stored_activities[:30],
        "meta": {
            "is_fallback": is_fallback or (len(stored_agents) == 0),
            "db_path": str(getattr(store, "db_path", "")),
            "total_agents": len(agents_list),
            "total_tasks": len(stored_tasks),
            "total_activities": len(stored_activities),
            "workflow_projection": projection,
            "workflow_assignments": len(assignments),
            "bridge_ingestion": bridge_ingestion,
            "bridge_tasks": len(bridge_tasks),
            "bridge_active_tasks": bridge_active,
        },
    }


def _activity_line(act: dict[str, Any]) -> str:
    ts = act.get("timestamp")
    stamp = time.strftime("%H:%M:%S", time.localtime(ts)) if isinstance(ts, (int, float)) else "--:--:--"
    parts = [str(act.get("event_type") or "event")]
    if act.get("tool_name"):
        parts.append(str(act["tool_name"]))
    if act.get("status"):
        parts.append(f"[{act['status']}]")
    preview = act.get("tool_output_preview") or act.get("tool_input_preview")
    if preview:
        parts.append(str(preview).replace("\n", " ")[:200])
    return f"[{stamp}] " + " ".join(parts)


def get_agent_monitor(
    agent_id: str,
    storage: Optional[OfficeStorage] = None,
    workflow: Optional[WorkflowService] = None,
    bridge: Optional[TaskBridgeReader] = None,
    tail: int = MONITOR_TAIL_LINES,
) -> dict[str, Any]:
    """Workstation Monitor: what an agent is doing right now, as a terminal tail.

    Source precedence: the agent's active Task Bridge task (workflow attempt
    or direct Bridge ingestion), then its most recent Bridge task, then the
    agent's own activity events. Raises ApiError(404) for unknown agents.
    """
    state = get_office_state(storage, workflow, bridge)
    wanted = agent_id.lower()
    agent = next((a for a in state["agents"] if str(a.get("id") or "").lower() == wanted), None)
    if agent is None:
        raise ApiError(HTTPStatus.NOT_FOUND, f"unknown agent {agent_id!r}")

    task: Optional[dict[str, Any]] = None
    is_active = False
    active_id = agent.get("active_task_id")
    if bridge is not None:
        try:
            if active_id:
                task = bridge.get_task(str(active_id))
                is_active = task is not None
            if task is None and agent.get("bridge_tasks"):
                task = agent["bridge_tasks"][0]
        except Exception as exc:
            logger.warning("Monitor could not read Task Bridge (fail-open): %s", exc)
            task = None

    stdout_tail: list[str] = []
    stderr_tail: list[str] = []
    activity: list[str] = []
    if task is not None and bridge is not None:
        source = "task_bridge"
        stdout_tail = bridge.tail_log(task, "stdout", tail)
        stderr_tail = bridge.tail_log(task, "stderr", tail)
    else:
        events: list[dict[str, Any]] = []
        store = storage if storage is not None else get_default_storage()
        try:
            events = store.list_activity_events(agent_id=str(agent.get("id")), limit=tail)
        except Exception as exc:
            logger.warning("Monitor could not read activity events (fail-open): %s", exc)
        activity = [_activity_line(e) for e in reversed(events)]
        source = "activity" if activity else "idle"

    return {
        "status": "ok",
        "timestamp": time.time(),
        "agent": {
            key: agent.get(key)
            for key in ("id", "profile_name", "role", "status", "current_model", "current_task",
                        "active_task_id", "workflow_run_id", "workflow_node")
        },
        "source": source,
        "task": task,
        "is_active": is_active,
        "is_live": bool(task and task.get("is_live")),
        "tail_lines": tail,
        "stdout_tail": stdout_tail,
        "stderr_tail": stderr_tail,
        "activity": activity,
    }


def get_task_log(task_id: str, bridge: Optional[TaskBridgeReader]) -> dict[str, Any]:
    """Task Bridge drill-down: raw stdout/stderr, artifacts and execution status."""
    if bridge is None:
        raise ApiError(HTTPStatus.SERVICE_UNAVAILABLE, "task bridge is not configured")
    try:
        task = bridge.get_task(task_id)
    except Exception as exc:
        raise ApiError(HTTPStatus.SERVICE_UNAVAILABLE, f"task bridge unavailable: {exc}")
    if task is None:
        raise ApiError(HTTPStatus.NOT_FOUND, f"unknown task {task_id!r}")
    return {
        "status": "ok",
        "timestamp": time.time(),
        "task": task,
        "is_live": bool(task.get("is_live")),
        "stdout": bridge.read_log(task, "stdout"),
        "stderr": bridge.read_log(task, "stderr"),
        "artifacts": bridge.list_artifacts(task),
    }


class OfficeRequestHandler(SimpleHTTPRequestHandler):
    """HTTP request handler supporting /api/state and static SPA serving."""

    server_version = "AgentOfficeServer/0.1.0"

    def __init__(
        self,
        *args: Any,
        storage: Optional[OfficeStorage] = None,
        static_dir: Optional[Union[str, Path]] = None,
        workflow: Optional[WorkflowService] = None,
        bridge: Optional[TaskBridgeReader] = None,
        editor: Optional[EditorService] = None,
        **kwargs: Any,
    ) -> None:
        self.storage = storage
        self.workflow = workflow
        self.bridge = bridge
        if editor is not None:
            self.editor = editor
        elif self.storage is not None and getattr(self.storage, "db_path", None):
            self.editor = EditorService(self.storage.db_path)
        else:
            self.editor = None
        self.static_dir = Path(static_dir) if static_dir is not None else get_default_static_dir()
        super().__init__(*args, directory=str(self.static_dir), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        """Route standard HTTP log messages to logging framework."""
        logger.debug("%s - - [%s] " + format, self.address_string(), self.log_date_time_string(), *args)

    def end_headers(self) -> None:
        """Inject CORS and caching headers."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        """Handle CORS preflight requests."""
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        """Handle GET requests routing API and static assets."""
        parsed_path = self.path.split("?")[0].rstrip("/")

        # Route: API health
        if parsed_path == "/api/health":
            self.handle_api_health()
            return

        if parsed_path == "/api/auth/me":
            self.handle_api_call(lambda: {"status": "ok", "user": self.get_verified_actor(require_auth=True)})
            return

        # Central fail-closed authentication barrier for all API routes
        if parsed_path == "/api" or parsed_path.startswith("/api/"):
            try:
                self.get_verified_actor(require_auth=True)
            except WorkflowApiError as exc:
                self.send_json(exc.status, {"status": "error", "message": exc.message})
                return

        # Route: API state
        if parsed_path == "/api/state":
            self.handle_api_state()
            return

        if parsed_path == "/api/office/grid":
            self.handle_api_call(lambda: {"status": "ok", "grid": self.storage.get_campus_grid()})
            return

        # Route: Process Studio workflow API
        if self.is_workflow_path(parsed_path):
            self.handle_workflow("GET", parsed_path)
            return

        if self.is_editor_path(parsed_path):
            self.handle_editor("GET", parsed_path)
            return

        # Route: Workstation Monitor and Task Bridge drill-down
        parts = [unquote(p) for p in parsed_path.split("/") if p]
        if len(parts) == 4 and parts[:2] == ["api", "agents"] and parts[3] == "monitor":
            self.handle_api_call(lambda: self._check_log_access(lambda: get_agent_monitor(
                parts[2], self.storage, self.workflow, self.bridge, self.query_tail())))
            return
        if len(parts) == 4 and parts[:2] == ["api", "tasks"] and parts[3] == "log":
            self.handle_api_call(lambda: self._check_log_access(lambda: get_task_log(parts[2], self.bridge)))
            return
        if parts[:1] == ["api"]:
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "not found"})
            return

        # Route: Static web assets & SPA fallback
        self.handle_static_or_spa(self.path.split("?")[0])

    def _check_log_access(self, producer: Callable[[], Any]) -> Any:
        actor = self.get_verified_actor(require_auth=True)
        self.check_grant(actor, "read_logs")
        return producer()

    def validate_csrf(self) -> None:
        origin = self.headers.get("Origin")
        referer = self.headers.get("Referer")
        sec_fetch_site = self.headers.get("Sec-Fetch-Site")

        if sec_fetch_site and sec_fetch_site.lower() == "cross-site":
            raise WorkflowApiError(403, "cross-site requests forbidden (CSRF)")

        host_header = (self.headers.get("Host") or "").lower()
        host_name, _, host_port = host_header.partition(":")

        server_addr = getattr(self.server, "server_address", ("127.0.0.1", 8080))
        server_host = str(server_addr[0]).lower()
        server_port = str(server_addr[1])

        allowed_hostnames = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}
        if host_name:
            allowed_hostnames.add(host_name)
        if server_host:
            allowed_hostnames.add(server_host)

        expected_ports = {server_port}
        if host_port:
            expected_ports.add(host_port)

        if origin:
            parsed = urlparse(origin)
            origin_host = (parsed.hostname or "").lower()
            origin_port = str(parsed.port) if parsed.port is not None else ("443" if parsed.scheme == "https" else "80")

            if not origin_host or origin_host not in allowed_hostnames:
                raise WorkflowApiError(403, f"CSRF protection: untrusted origin {origin!r}")
            if server_port not in ("0", "80", "443") and origin_port not in expected_ports:
                raise WorkflowApiError(403, f"CSRF protection: origin port mismatch {origin!r}")

        if not origin and referer:
            parsed = urlparse(referer)
            referer_host = (parsed.hostname or "").lower()
            referer_port = str(parsed.port) if parsed.port is not None else ("443" if parsed.scheme == "https" else "80")
            if not referer_host or referer_host not in allowed_hostnames:
                raise WorkflowApiError(403, f"CSRF protection: untrusted referer {referer!r}")
            if server_port not in ("0", "80", "443") and referer_port not in expected_ports:
                raise WorkflowApiError(403, f"CSRF protection: referer port mismatch {referer!r}")

    def session_token(self) -> str:
        authorization = self.headers.get("Authorization", "").strip()
        if authorization.startswith("Bearer "):
            return authorization[7:].strip()
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return ""
        return cookie["session"].value if "session" in cookie else ""

    @staticmethod
    def session_actor(session: dict[str, Any]) -> dict[str, Any]:
        return {"id": session["user_id"], "user_id": session["user_id"],
                "role": session["role"], "name": session["name"]}

    def telegram_user(self, init_data: str) -> dict[str, Any]:
        data = validate_telegram_init_data(init_data, getattr(self.server, "bot_token", ""))
        if data is None:
            raise WorkflowApiError(401, "invalid or expired Telegram initData")
        return data["user"]

    def handle_auth(self, path: str) -> None:
        store = self.server.session_store
        if path == "/api/auth/logout":
            self.get_verified_actor(require_auth=True)
            store.revoke_session(self.session_token())
            self.send_json(200, {"status": "ok"}, {"Set-Cookie":
                "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"})
            return
        body = self.read_json_body()
        if path == "/api/auth/telegram":
            user = self.telegram_user(body.get("initData", ""))
            name = " ".join(str(user.get(key) or "") for key in ("first_name", "last_name")).strip()
            session = store.create_session(user["id"], telegram_role(user), name or str(user.get("username", "")))
        else:
            token, password = body.get("token"), body.get("password")
            configured_token = getattr(self.server, "auth_token", None)
            configured_password = getattr(self.server, "login_password", None)
            # UTF-8 bytes allow non-ASCII passwords and constant-time comparisons.
            valid_token = isinstance(token, str) and bool(configured_token) and hmac.compare_digest(
                token.encode(), configured_token.encode())
            valid_password = isinstance(password, str) and bool(configured_password) and hmac.compare_digest(
                password.encode(), configured_password.encode())
            if valid_token or valid_password:
                session = store.create_session("owner", "owner", "Owner")
            elif isinstance(token, str) and (existing := store.get_session(token)):
                remaining = max(1, int(existing["expires_at"] - time.time()))
                session = store.create_session(existing["user_id"], existing["role"], existing["name"], remaining)
            else:
                raise WorkflowApiError(401, "invalid login credentials")
        self.send_json(200, {"status": "ok", "token": session["token"],
                            "user": self.session_actor(session)}, {"Set-Cookie":
            f"session={session['token']}; Path=/; HttpOnly; SameSite=Lax"})

    def get_verified_actor(self, require_auth: bool = False) -> dict[str, Any]:
        auth_header = self.headers.get("Authorization", "").strip()
        token = self.session_token()
        if token:
            session = self.server.session_store.get_session(token)
            if session is not None:
                return self.session_actor(session)
            if not auth_header.startswith("Bearer "):
                raise WorkflowApiError(401, "invalid or expired session")

        if "X-Telegram-Init-Data" in self.headers:
            user = self.telegram_user(self.headers["X-Telegram-Init-Data"])
            return {"id": str(user["id"]), "user_id": str(user["id"]),
                    "role": telegram_role(user), "name": str(user.get("first_name", ""))}

        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            server_token = getattr(self.server, "auth_token", None)
            is_valid = bool(server_token and token == server_token)

            if is_valid:
                actor_id = (self.headers.get("X-Actor-ID") or "").strip()
                if not actor_id:
                    actor_id = "tyler"
                if actor_id in ("tyler", "owner"):
                    role = "managing_director"
                elif actor_id == "operator":
                    role = "operator"
                elif actor_id in ROLE_GRANTS:
                    role = actor_id
                else:
                    role = "guest"
                return {"id": actor_id, "role": role}
            raise WorkflowApiError(401, "invalid Bearer token")

        if auth_header.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth_header[6:].strip()).decode("utf-8")
                username, sep, password = decoded.partition(":")
            except Exception:
                raise WorkflowApiError(401, "invalid Authorization header encoding")

            configured_basic = os.environ.get("AGENT_OFFICE_BASIC_AUTH")
            credentials_map = getattr(self.server, "basic_credentials", {})
            valid_basic = False
            if configured_basic and decoded == configured_basic:
                valid_basic = True
            elif username in credentials_map and credentials_map[username] == password:
                valid_basic = True

            if valid_basic:
                role = "managing_director" if username in ("tyler", "owner") else ("operator" if username == "operator" else "guest")
                return {"id": username.strip(), "role": role}

            raise WorkflowApiError(401, "credentials cannot be verified: no verifiable trust mechanism configured")

        client_actor_headers = [
            h for h in ("X-Actor-ID", "X-Actor-Role", "X-Actor-Grants", "X-Remote-User", "X-Forwarded-User", "X-Session-User")
            if self.headers.get(h)
        ]
        if client_actor_headers:
            raise WorkflowApiError(403, f"header impersonation rejected: headers {client_actor_headers} require verified authentication")

        if require_auth:
            raise WorkflowApiError(401, "authentication required")
        return {"id": "anonymous", "user_id": None, "role": "guest"}

    def check_grant(self, actor: dict[str, Any], action: str) -> None:
        grants = ROLE_GRANTS.get(actor.get("role"), set())

        if action not in grants and "admin" not in grants:
            raise WorkflowApiError(403, f"actor {actor.get('id')!r} lacks required grant {action!r}")

    def do_POST(self) -> None:
        """Handle POST requests (workflow commands only)."""
        parsed_path = self.path.split("?")[0].rstrip("/")
        try:
            self.validate_csrf()
            if parsed_path in ("/api/auth/telegram", "/api/auth/login", "/api/auth/logout"):
                self.handle_auth(parsed_path)
                return

            agent_parts = [unquote(p) for p in parsed_path.split("/") if p]
            if len(agent_parts) == 4 and agent_parts[:2] == ["api", "agents"] and agent_parts[3] == "policy":
                agent_id = agent_parts[2]
                if (
                    not agent_id
                    or agent_id != agent_id.strip()
                    or "/" in agent_id
                    or "\\" in agent_id
                    or ".." in agent_id
                    or any(ord(c) < 32 or ord(c) == 127 for c in agent_id)
                ):
                    raise WorkflowApiError(400, "invalid agent id")

                actor = self.get_verified_actor(require_auth=True)
                self.check_grant(actor, "publish_definition")

                payload = self.read_json_body()
                if not isinstance(payload, dict):
                    raise WorkflowApiError(400, "request body must be a JSON object")

                strategy = payload.get("strategy")
                if strategy not in ("priority", "round_robin"):
                    raise WorkflowApiError(400, "invalid strategy: must be 'priority' or 'round_robin'")

                models = payload.get("models")
                if not isinstance(models, list) or not (1 <= len(models) <= 32):
                    raise WorkflowApiError(400, "models must be a list of 1 to 32 entries")

                seen_pairs = set()
                normalized_models = []
                for idx, entry in enumerate(models, start=1):
                    if not isinstance(entry, dict):
                        raise WorkflowApiError(400, "each model entry must be a dictionary")
                    provider = entry.get("provider")
                    model_name = entry.get("model")
                    if not isinstance(provider, str) or not isinstance(model_name, str):
                        raise WorkflowApiError(400, "provider and model must be strings")
                    if not (1 <= len(provider) <= 128) or not (1 <= len(model_name) <= 128):
                        raise WorkflowApiError(400, "provider and model length must be 1 to 128 characters")
                    if provider != provider.strip() or model_name != model_name.strip() or not provider.strip() or not model_name.strip():
                        raise WorkflowApiError(400, "provider and model must not contain leading/trailing whitespace or be whitespace-only")
                    if any(ord(c) < 32 or ord(c) == 127 for c in provider) or any(ord(c) < 32 or ord(c) == 127 for c in model_name):
                        raise WorkflowApiError(400, "provider and model must not contain control characters")
                    pair = (provider, model_name)
                    if pair in seen_pairs:
                        raise WorkflowApiError(400, f"duplicate provider and model pair: {pair}")
                    seen_pairs.add(pair)
                    entry_copy = dict(entry)
                    entry_copy["provider"] = provider
                    entry_copy["model"] = model_name
                    entry_copy["priority"] = idx
                    normalized_models.append(entry_copy)

                storage = self.storage
                if storage is None:
                    raise WorkflowApiError(503, "storage is not configured")

                agent = storage.get_agent(agent_id)
                if agent is None:
                    ws_def = next((w for w in DEFAULT_WORKSTATIONS if w.get("id") == agent_id), None)
                    if ws_def is None:
                        raise WorkflowApiError(404, f"agent {agent_id!r} not found")
                    storage.register_or_update_agent(
                        agent_id=agent_id,
                        profile_name=ws_def.get("profile_name") or ws_def.get("profile", ""),
                        role=ws_def.get("role", ""),
                        status="offline",
                        current_model=None,
                        last_seen_at=0,
                        metadata={"policy_only": True},
                    )

                updated = storage.set_agent_policy(agent_id, normalized_models, strategy)
                if updated is None:
                    raise WorkflowApiError(404, f"agent {agent_id!r} not found")

                self.send_json(HTTPStatus.OK, {"status": "ok", "agent": updated})
                return

            if self.is_workflow_path(parsed_path):
                self.handle_workflow("POST", parsed_path)
                return
            if self.is_editor_path(parsed_path):
                self.handle_editor("POST", parsed_path)
                return
            if parsed_path == "/api/office/grid":
                actor = self.get_verified_actor(require_auth=True)
                self.check_grant(actor, "publish_definition")
                payload = self.read_json_body()
                grid_payload = payload.get("grid", payload) if isinstance(payload, dict) else payload
                if not isinstance(grid_payload, dict):
                    raise WorkflowApiError(400, "grid payload must be a JSON object")
                saved = self.storage.save_campus_grid(grid_payload)
                self.handle_api_call(lambda: {"status": "ok", "saved": bool(saved)})
                return
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "not found"})
        except WorkflowApiError as exc:
            self.send_json(exc.status, {"status": "error", "message": exc.message})
        except EditorApiError as exc:
            payload = {"status": "error", "message": exc.message}
            if exc.extra:
                payload.update(exc.extra)
            self.send_json(exc.status, payload)
        except Exception as exc:
            logger.exception("Error processing POST %s", parsed_path)
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR,
                           {"status": "error", "message": f"internal error: {exc}"})

    # -- Process Studio workflow API ---------------------------------------
    @staticmethod
    def is_workflow_path(path: str) -> bool:
        return path == WORKFLOW_PREFIX or path.startswith(WORKFLOW_PREFIX + "/")

    @staticmethod
    def is_editor_path(path: str) -> bool:
        return path == EDITOR_PREFIX or path.startswith(EDITOR_PREFIX + "/")

    def send_json(self, status: int, data: Any, headers: Optional[dict[str, str]] = None) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def read_json_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise WorkflowApiError(400, "invalid Content-Length")
        if length > MAX_JSON_BODY:
            raise WorkflowApiError(400, "request body too large")
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw.strip():
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise WorkflowApiError(400, "request body must be valid JSON")
        if not isinstance(data, dict):
            raise WorkflowApiError(400, "request body must be a JSON object")
        return data

    def route_workflow(self, method: str, path: str) -> tuple[int, Any]:
        """Map (method, path) to a WorkflowService call; raises WorkflowApiError."""
        service = self.workflow
        if service is None:
            raise WorkflowApiError(503, "workflow service is not configured")
        parts = [unquote(p) for p in path[len(WORKFLOW_PREFIX):].split("/") if p]
        handler: Optional[Callable[[], Any]] = None
        status = HTTPStatus.OK
        if parts == ["templates"] and method == "GET":
            handler = service.list_templates
        elif parts == ["definitions"] and method == "GET":
            handler = service.list_definitions
        elif len(parts) == 2 and parts[0] == "definitions" and method == "GET":
            handler = lambda: service.get_definition(parts[1])
        elif parts == ["runs"] and method == "GET":
            handler = service.list_runs
        elif parts == ["runs"] and method == "POST":
            actor = self.get_verified_actor()
            self.check_grant(actor, "create_run")
            body = self.read_json_body()
            handler, status = (lambda: service.create_run(body)), HTTPStatus.CREATED
        elif len(parts) == 2 and parts[0] == "runs" and method == "GET":
            handler = lambda: service.get_run(parts[1])
        elif len(parts) == 3 and parts[0] == "runs" and parts[2] in RUN_COMMANDS \
                and method == "POST":
            service.get_run(parts[1])

            actor = self.get_verified_actor()
            action = parts[2]
            self.check_grant(actor, action)
            body = self.read_json_body()

            owner_aliases = {"owner", "tyler"}

            if action == "approve":
                scope = str(body.get("scope") or "")
                if scope.startswith("publish:") or "publish" in scope:
                    self.check_grant(actor, "publish_artifact")

                if "approver" in body:
                    approver_val = body["approver"]
                    if isinstance(approver_val, str) and approver_val.strip():
                        if actor["id"] in owner_aliases and approver_val in owner_aliases:
                            pass
                        elif approver_val != actor["id"]:
                            raise WorkflowApiError(
                                403,
                                f"payload impersonation rejected: approver {approver_val!r} does not match verified actor {actor['id']!r}"
                            )

            if action in ("pause", "resume", "retry"):
                if "actor" in body:
                    actor_val = body["actor"]
                    if isinstance(actor_val, str) and actor_val.strip():
                        if actor["id"] in owner_aliases and actor_val in owner_aliases:
                            pass
                        elif actor_val != actor["id"]:
                            raise WorkflowApiError(
                                403,
                                f"payload impersonation rejected: actor {actor_val!r} does not match verified actor {actor['id']!r}"
                            )

            command = getattr(service, action)
            handler = lambda: command(parts[1], body)
        if handler is None:
            raise WorkflowApiError(404, f"no workflow route {method} {path}")
        return status, handler()

    def handle_workflow(self, method: str, path: str) -> None:
        try:
            status, data = self.route_workflow(method, path)
            self.send_json(status, data)
        except WorkflowApiError as exc:
            self.send_json(exc.status, {"status": "error", "message": exc.message})
        except Exception as exc:  # fail closed: report, never fabricate state
            logger.exception("Workflow API error on %s %s", method, path)
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR,
                           {"status": "error", "message": f"internal error: {exc}"})

    def route_editor(self, method: str, path: str) -> tuple[int, Any]:
        service = self.editor
        if service is None:
            raise EditorApiError(503, "editor service is not configured")
        parts = [unquote(p) for p in path[len(EDITOR_PREFIX):].split("/") if p]
        status = HTTPStatus.OK

        if parts == ["drafts"] and method == "GET":
            return status, service.list_drafts()
        if len(parts) == 2 and parts[0] == "drafts":
            draft_id = parts[1]
            if method == "GET":
                return status, service.get_draft(draft_id)
            if method == "POST":
                actor = self.get_verified_actor()
                self.check_grant(actor, "publish_definition")
                body = self.read_json_body()
                return HTTPStatus.OK, service.save_draft(draft_id, body)
        if parts == ["validate"] and method == "POST":
            body = self.read_json_body()
            return status, service.validate(body)
        if parts == ["publish"] and method == "POST":
            actor = self.get_verified_actor()
            self.check_grant(actor, "publish_definition")
            body = self.read_json_body()
            return HTTPStatus.OK, service.publish(body)
        if parts == ["published"] and method == "GET":
            return status, service.list_published()
        if len(parts) == 2 and parts[0] == "published" and method == "GET":
            graph_id = parts[1]
            query = parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
            version_val = query.get("version", [None])[0]
            version = int(version_val) if version_val is not None else None
            return status, service.get_published(graph_id, version=version)

        raise EditorApiError(404, f"no editor route {method} {path}")

    def handle_editor(self, method: str, path: str) -> None:
        try:
            status, data = self.route_editor(method, path)
            self.send_json(status, data)
        except WorkflowApiError as exc:
            self.send_json(exc.status, {"status": "error", "message": exc.message})
        except EditorApiError as exc:
            payload = {"status": "error", "message": exc.message}
            if exc.extra:
                payload.update(exc.extra)
            self.send_json(exc.status, payload)
        except Exception as exc:
            logger.exception("Editor API error on %s %s", method, path)
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR,
                           {"status": "error", "message": f"internal error: {exc}"})

    def query_tail(self) -> int:
        query = parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
        try:
            tail = int(query.get("tail", [MONITOR_TAIL_LINES])[0])
        except ValueError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "tail must be an integer")
        return max(0, min(tail, MONITOR_TAIL_MAX))

    def handle_api_call(self, producer: Callable[[], Any]) -> None:
        try:
            self.send_json(HTTPStatus.OK, producer())
        except ApiError as exc:
            self.send_json(exc.status, {"status": "error", "message": exc.message})
        except WorkflowApiError as exc:
            self.send_json(exc.status, {"status": "error", "message": exc.message})
        except Exception as exc:
            logger.exception("API error on %s", self.path)
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR,
                           {"status": "error", "message": f"internal error: {exc}"})

    def handle_api_state(self) -> None:
        """Serialize and serve current agent office state as JSON."""
        try:
            state = get_office_state(self.storage, self.workflow, self.bridge)
            payload = json.dumps(state, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(payload)
        except Exception as exc:
            logger.exception("Error handling /api/state: %s", exc)
            fallback = {
                "status": "error",
                "message": str(exc),
                "agents": DEFAULT_WORKSTATIONS,
                "tasks": [],
                "recent_activities": [],
            }
            payload = json.dumps(fallback).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def handle_api_health(self) -> None:
        """Health check endpoint."""
        data = json.dumps({"status": "ok", "time": time.time()}).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_static_or_spa(self, rel_path: str) -> None:
        """Serve static file or fallback to index.html / embedded dashboard."""
        clean_path = rel_path.lstrip("/")
        if not clean_path:
            clean_path = "index.html"

        target_file = (self.static_dir / clean_path).resolve()

        # Guard against directory traversal
        try:
            target_file.relative_to(self.static_dir.resolve())
        except ValueError:
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return

        # Serve static file if it exists and is a file
        if target_file.is_file():
            self.serve_file(target_file)
            return

        # SPA routing: for paths without an extension, serve index.html if present
        spa_index = self.static_dir / "index.html"
        if spa_index.is_file():
            self.serve_file(spa_index)
            return

        # If static bundle has not been built yet, serve standalone embedded HTML
        self.serve_embedded_dashboard()

    def serve_file(self, file_path: Path) -> None:
        """Read and stream static file with guessed MIME type."""
        try:
            mime_type, _ = mimetypes.guess_type(str(file_path))
            if not mime_type:
                mime_type = "application/octet-stream"
            content = file_path.read_bytes()

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as exc:
            logger.warning("Could not serve static file %s: %s", file_path, exc)
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")

    def serve_embedded_dashboard(self) -> None:
        """Serve embedded HTML fallback when static assets are not built yet."""
        html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Office — Isometric View & Roster</title>
  <style>
    :root { --bg: #0f172a; --panel: #1e293b; --text: #f8fafc; --muted: #94a3b8; --border: #334155; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }
    #root { display: flex; width: 100%; height: 100%; }
    .main-view { flex: 1; display: flex; flex-direction: column; position: relative; }
    .header { padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); background: #111827; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { margin: 0; font-size: 1.25rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
    .canvas-container { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; background: radial-gradient(circle at center, #1e293b 0%, #090d16 100%); }
    .sidebar { width: 380px; border-left: 1px solid var(--border); background: #111827; display: flex; flex-direction: column; overflow: hidden; }
    .sidebar-header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 1rem; }
    .roster-list { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .agent-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; cursor: pointer; transition: transform 0.15s, border-color 0.15s; }
    .agent-card:hover { border-color: #38bdf8; transform: translateY(-2px); }
    .agent-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .agent-name { font-weight: 600; font-size: 1rem; }
    .agent-role { font-size: 0.8rem; color: var(--muted); }
    .badge { padding: 0.2rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; text-transform: capitalize; }
    .badge-working { background: #065f46; color: #34d399; }
    .badge-researching { background: #1e3a8a; color: #60a5fa; }
    .badge-review { background: #78350f; color: #fbbf24; }
    .badge-blocked { background: #7f1d1d; color: #f87171; }
    .badge-awaiting_human { background: #581c87; color: #c084fc; }
    .badge-idle { background: #374151; color: #9ca3af; }
    .meta-line { font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; }
    .active-task { background: #0f172a; padding: 0.5rem; border-radius: 4px; font-size: 0.8rem; margin-top: 0.5rem; border-left: 3px solid #38bdf8; }
  </style>
</head>
<body>
  <div id="root">
    <div class="main-view">
      <div class="header">
        <h1>🏢 Agent Office — Isometric Experience Plane</h1>
        <div id="connection-status" style="font-size:0.85rem; color:#34d399;">● Live /api/state</div>
      </div>
      <div class="canvas-container">
        <svg id="iso-office" viewBox="-400 -250 800 500" width="100%" height="100%" style="max-height:85vh;"></svg>
      </div>
    </div>
    <div class="sidebar">
      <div class="sidebar-header">👥 Employee Roster</div>
      <div class="roster-list" id="roster">Loading roster...</div>
    </div>
  </div>
  <script>
    async function loadState() {
      try {
        const res = await fetch('/api/state');
        const data = await res.json();
        renderRoster(data.agents || []);
        renderIsoOffice(data.agents || []);
      } catch (err) {
        document.getElementById('roster').innerHTML = '<div style="color:#f87171;">Failed loading state</div>';
      }
    }
    function renderRoster(agents) {
      const container = document.getElementById('roster');
      container.innerHTML = agents.map(a => `
        <div class="agent-card">
          <div class="agent-head">
            <div>
              <div class="agent-name">${a.profile_name}</div>
              <div class="agent-role">${a.role}</div>
            </div>
            <span class="badge badge-${a.status}">${a.status.replace('_', ' ')}</span>
          </div>
          <div class="meta-line">Model: <code>${a.current_model || 'default'}</code></div>
          ${a.active_task ? `<div class="active-task"><strong>Task:</strong> ${a.active_task.title || a.active_task.kanban_task_id}</div>` : ''}
          ${a.last_tool_call ? `<div class="meta-line">Last Tool: <code>${a.last_tool_call.tool_name || a.last_tool_call.event_type}</code></div>` : ''}
        </div>
      `).join('');
    }
    function renderIsoOffice(agents) {
      const svg = document.getElementById('iso-office');
      // Render isometric floor tile and workstations
      svg.innerHTML = `
        <polygon points="0,-160 320,0 0,160 -320,0" fill="#1e293b" stroke="#334155" stroke-width="2"/>
        <line x1="0" y1="-160" x2="0" y2="160" stroke="#334155" stroke-dasharray="4"/>
        <line x1="-320" y1="0" x2="320" y2="0" stroke="#334155" stroke-dasharray="4"/>
      `;
      const positions = {
        tyler: {x: 0, y: -70},
        coder: {x: -140, y: 0},
        artist: {x: 140, y: 0},
        webdev: {x: 70, y: -70},
        devops: {x: -70, y: 70},
        qa: {x: 70, y: 70}
      };
      agents.forEach(a => {
        const id = (a.id || '').toLowerCase();
        const pos = positions[id] || {x: 0, y: 0};
        const statusColors = {
          working: '#34d399',
          researching: '#60a5fa',
          review: '#fbbf24',
          blocked: '#f87171',
          awaiting_human: '#c084fc',
          idle: '#9ca3af'
        };
        const color = statusColors[a.status] || '#9ca3af';
        svg.innerHTML += `
          <g transform="translate(${pos.x}, ${pos.y})">
            <ellipse cx="0" cy="15" rx="30" ry="15" fill="#0f172a" opacity="0.6"/>
            <polygon points="0,-20 25,-7 0,6 -25,-7" fill="#334155" stroke="#475569"/>
            <polygon points="0,6 25,-7 25,10 0,23" fill="#1e293b" stroke="#475569"/>
            <polygon points="0,6 -25,-7 -25,10 0,23" fill="#0f172a" stroke="#475569"/>
            <circle cx="0" cy="-35" r="14" fill="#1e293b" stroke="${color}" stroke-width="3"/>
            <text x="0" y="-31" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">${a.profile_name[0]}</text>
            <text x="0" y="38" font-size="11" fill="#f8fafc" text-anchor="middle" font-weight="600">${a.profile_name}</text>
            <text x="0" y="50" font-size="9" fill="${color}" text-anchor="middle">${a.status}</text>
          </g>
        `;
      });
    }
    loadState();
    setInterval(loadState, 3000);
  </script>
</body>
</html>"""
        payload = html.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def create_server(
    host: str = "127.0.0.1",
    port: int = 8080,
    storage: Optional[OfficeStorage] = None,
    static_dir: Optional[Union[str, Path]] = None,
    workflow: Optional[WorkflowService] = None,
    bridge: Optional[TaskBridgeReader] = None,
    editor: Optional[EditorService] = None,
    auth_token: Optional[str] = None,
    session_store: Optional[SessionStore] = None,
    bot_token: Optional[str] = None,
    login_password: Optional[str] = None,
) -> ThreadingHTTPServer:
    """Instantiate and configure ThreadingHTTPServer with OfficeRequestHandler.

    Without a workflow service, /api/workflow/* answers 503 (not configured).
    """
    target_storage = storage if storage is not None else get_default_storage()
    target_static = static_dir if static_dir is not None else get_default_static_dir()

    def handler_factory(*args: Any, **kwargs: Any) -> OfficeRequestHandler:
        return OfficeRequestHandler(*args, storage=target_storage, static_dir=target_static,
                                    workflow=workflow, bridge=bridge, editor=editor, **kwargs)

    server = ThreadingHTTPServer((host, port), handler_factory)
    # Bearer login is opt-in; missing configuration must never grant owner access.
    server.auth_token = (auth_token if auth_token is not None
                         else os.environ.get("AGENT_OFFICE_AUTH_TOKEN", ""))
    server.session_store = session_store if session_store is not None else SessionStore(
        os.environ.get("AGENT_OFFICE_SESSION_DB", ":memory:"))
    server.bot_token = bot_token or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    server.login_password = login_password or os.environ.get("AGENT_OFFICE_LOGIN_PASSWORD")
    return server


def run_server(
    host: str = "127.0.0.1",
    port: int = 8080,
    storage: Optional[OfficeStorage] = None,
    static_dir: Optional[Union[str, Path]] = None,
    workflow: Optional[WorkflowService] = None,
    bridge: Optional[TaskBridgeReader] = None,
) -> None:
    """Run HTTP server until interrupted."""
    server = create_server(host=host, port=port, storage=storage, static_dir=static_dir,
                           workflow=workflow, bridge=bridge)
    logger.info("Agent Office server running at http://%s:%d", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Agent Office server shutting down.")
    finally:
        server.server_close()
        if workflow is not None:
            workflow.close()


def build_workflow_service(
    workflow_db: Union[str, Path],
    task_bridge_db: Optional[Union[str, Path]] = None,
    fake_bridge_db: Optional[Union[str, Path]] = None,
) -> WorkflowService:
    """Wire Workflow Core to the real Task Bridge, or to a local FakeBridge.

    The FakeBridge never executes anything; it lets Process Studio be
    exercised locally and is reported as bridge="fake" in run details.
    """
    Path(workflow_db).parent.mkdir(parents=True, exist_ok=True)
    if task_bridge_db is not None:
        from .workflow.bridge_port import TaskBridgeAdapter
        from task_bridge.bridge import TaskBridge  # type: ignore[import-not-found]

        bridge = TaskBridgeAdapter(TaskBridge(db_path=Path(task_bridge_db)))
        return WorkflowService(workflow_db, bridge, bridge_kind="task_bridge")
    from .workflow.bridge_port import FakeBridge

    fake_path = Path(fake_bridge_db) if fake_bridge_db else Path(workflow_db).with_name(
        "workflow-fake-bridge.sqlite3")
    return WorkflowService(workflow_db, FakeBridge(fake_path), bridge_kind="fake")


def main() -> None:
    """CLI entrypoint for running the Agent Office web experience server."""
    parser = argparse.ArgumentParser(description="Agent Office Web Server")
    parser.add_argument("--host", default="127.0.0.1", help="Binding host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default 8080)")
    parser.add_argument("--static-dir", default=None, help="Path to static web assets")
    parser.add_argument("--db-path", default=None, help="Path to SQLite database")
    parser.add_argument("--workflow-db", default=None,
                        help="Workflow Core SQLite path (default: next to the office DB)")
    parser.add_argument("--task-bridge-db", default=None,
                        help="Real Task Bridge tasks.db (requires task_bridge on sys.path)")
    parser.add_argument("--task-bridge-artifacts-dir", default=None,
                        help="Task Bridge artifacts dir holding <task_id>/stdout.log "
                             "(default: Bridge's own default location)")
    parser.add_argument("--fake-bridge-db", default=None,
                        help="FakeBridge SQLite path when no Task Bridge is given")
    parser.add_argument("--coordinator-interval", type=float, default=5.0,
                        help="Seconds between coordinator ticks (0 disables the loop)")
    parser.add_argument("--no-workflow", action="store_true",
                        help="Disable the /api/workflow endpoints")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    storage = OfficeStorage(db_path=args.db_path) if args.db_path else None
    workflow = None
    if not args.no_workflow:
        office_db = Path((storage or get_default_storage()).db_path)
        workflow_db = Path(args.workflow_db) if args.workflow_db else office_db.with_name(
            "workflow.sqlite3")
        workflow = build_workflow_service(workflow_db, args.task_bridge_db,
                                          args.fake_bridge_db)
        if args.coordinator_interval > 0:
            workflow.start(args.coordinator_interval)
        logger.info("Workflow Core at %s (bridge=%s)", workflow_db, workflow.bridge_kind)
    bridge = None
    if args.task_bridge_db:
        bridge = TaskBridgeReader(args.task_bridge_db, args.task_bridge_artifacts_dir)
        logger.info("Task Bridge ingestion from %s (logs under %s)", bridge.db_path,
                    bridge.artifacts_dir)
    run_server(host=args.host, port=args.port, storage=storage, static_dir=args.static_dir,
               workflow=workflow, bridge=bridge)


if __name__ == "__main__":
    main()
