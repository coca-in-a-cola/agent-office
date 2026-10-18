"""Lightweight HTTP server and state API for Agent Office.

Serves /api/state containing current agents, task snapshots, and activity events
from SQLite storage with fail-open fallback, and serves static web assets for the
isometric office frontend.
"""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import mimetypes
import os
from pathlib import Path
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Union

from .storage import OfficeStorage, get_default_storage

logger = logging.getLogger("agent_office.server")

# Standard workstation profiles for the isometric office layout
DEFAULT_WORKSTATIONS: list[dict[str, Any]] = [
    {
        "id": "tyler",
        "profile_name": "Tyler",
        "role": "Managing Director",
        "status": "idle",
        "current_model": "anthropic/claude-3-7-sonnet",
        "capabilities": ["leadership", "planning", "coordination", "strategy"],
        "metadata": {"desk": "executive", "position": [0, 0], "avatar": "tyler"},
    },
    {
        "id": "artist",
        "profile_name": "Artist",
        "role": "Artist",
        "status": "idle",
        "current_model": "tripo/hunyuan3d-2.0",
        "capabilities": ["3d_modeling", "textures", "concept_art", "rigging"],
        "metadata": {"desk": "creative", "position": [1, 0], "avatar": "artist"},
    },
    {
        "id": "coder",
        "profile_name": "Coder",
        "role": "Coder",
        "status": "working",
        "current_model": "anthropic/claude-3-5-sonnet",
        "capabilities": ["python", "typescript", "architecture", "algorithms"],
        "metadata": {"desk": "engineering", "position": [0, 1], "avatar": "coder"},
    },
    {
        "id": "devops",
        "profile_name": "DevOps",
        "role": "DevOps",
        "status": "idle",
        "current_model": "anthropic/claude-3-5-haiku",
        "capabilities": ["infrastructure", "docker", "ci_cd", "observability"],
        "metadata": {"desk": "operations", "position": [1, 1], "avatar": "devops"},
    },
    {
        "id": "qa",
        "profile_name": "QA",
        "role": "QA",
        "status": "review",
        "current_model": "anthropic/claude-3-5-sonnet",
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
    if s in ("blocked", "error", "failed", "crash"):
        return "blocked"
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


def get_office_state(storage: Optional[OfficeStorage] = None) -> dict[str, Any]:
    """Retrieve full office state with fail-open fallback.

    Merges persisted agent entities with standard workstation profiles,
    attaches active task snapshots and recent activity logs.
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
        merged["current_model"] = sa.get("current_model") or merged.get("current_model") or "unknown"
        merged["capabilities"] = sa.get("capabilities") or merged.get("capabilities") or []
        merged["metadata"] = sa.get("metadata") or merged.get("metadata") or {}
        merged["last_seen_at"] = sa.get("last_seen_at") or now
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
        },
    }


class OfficeRequestHandler(SimpleHTTPRequestHandler):
    """HTTP request handler supporting /api/state and static SPA serving."""

    server_version = "AgentOfficeServer/0.1.0"

    def __init__(
        self,
        *args: Any,
        storage: Optional[OfficeStorage] = None,
        static_dir: Optional[Union[str, Path]] = None,
        **kwargs: Any,
    ) -> None:
        self.storage = storage
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

        # Route: API state
        if parsed_path == "/api/state":
            self.handle_api_state()
            return

        # Route: API health
        if parsed_path == "/api/health":
            self.handle_api_health()
            return

        # Route: Static web assets & SPA fallback
        self.handle_static_or_spa(self.path.split("?")[0])

    def handle_api_state(self) -> None:
        """Serialize and serve current agent office state as JSON."""
        try:
            state = get_office_state(self.storage)
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
) -> ThreadingHTTPServer:
    """Instantiate and configure ThreadingHTTPServer with OfficeRequestHandler."""
    target_storage = storage if storage is not None else get_default_storage()
    target_static = static_dir if static_dir is not None else get_default_static_dir()

    def handler_factory(*args: Any, **kwargs: Any) -> OfficeRequestHandler:
        return OfficeRequestHandler(*args, storage=target_storage, static_dir=target_static, **kwargs)

    return ThreadingHTTPServer((host, port), handler_factory)


def run_server(
    host: str = "127.0.0.1",
    port: int = 8080,
    storage: Optional[OfficeStorage] = None,
    static_dir: Optional[Union[str, Path]] = None,
) -> None:
    """Run HTTP server until interrupted."""
    server = create_server(host=host, port=port, storage=storage, static_dir=static_dir)
    logger.info("Agent Office server running at http://%s:%d", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Agent Office server shutting down.")
    finally:
        server.server_close()


def main() -> None:
    """CLI entrypoint for running the Agent Office web experience server."""
    parser = argparse.ArgumentParser(description="Agent Office Web Server")
    parser.add_argument("--host", default="127.0.0.1", help="Binding host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default 8080)")
    parser.add_argument("--static-dir", default=None, help="Path to static web assets")
    parser.add_argument("--db-path", default=None, help="Path to SQLite database")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    storage = OfficeStorage(db_path=args.db_path) if args.db_path else None
    run_server(host=args.host, port=args.port, storage=storage, static_dir=args.static_dir)


if __name__ == "__main__":
    main()
