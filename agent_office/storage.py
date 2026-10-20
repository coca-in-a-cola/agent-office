"""SQLite Storage, schema migrations, and local state projection for Agent Office.

Provides isolated local storage for agents, activity events, and task snapshots
with strict Fail-Open resilience to ensure database errors never disrupt agent turns.
"""

from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import functools
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from .events import Event, EventDispatcher, get_default_dispatcher

logger = logging.getLogger("agent_office.storage")

DEFAULT_DB_REL_PATH = Path(".local") / "state" / "agent-office" / "office.sqlite3"
ENV_DB_PATH_VAR = "AGENT_OFFICE_DB_PATH"


def get_default_db_path() -> Path:
    """Resolve the default SQLite database path according to configuration and environment.

    Defaults to ~/.local/state/agent-office/office.sqlite3, unless AGENT_OFFICE_DB_PATH
    is set in the environment.
    """
    env_override = os.environ.get(ENV_DB_PATH_VAR)
    if env_override:
        return Path(env_override)
    return Path.home() / DEFAULT_DB_REL_PATH


def _fail_open(default_return: Any = None) -> Callable[..., Any]:
    """Decorator catching all database/IO exceptions to uphold Fail-Open semantics."""

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(func)
        def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
            try:
                return func(self, *args, **kwargs)
            except Exception as exc:
                logger.warning(
                    "Agent Office Storage: %s encountered exception (fail-open): %s",
                    func.__name__,
                    exc,
                )
                return default_return

        return wrapper

    return decorator


def _serialize_json(data: Any) -> Optional[str]:
    """Safely serialize an object to JSON or None."""
    if data is None:
        return None
    try:
        return json.dumps(data, ensure_ascii=False, default=str)
    except Exception:
        return "{}"


def _deserialize_json(text: Optional[str]) -> Any:
    """Safely deserialize JSON string or return fallback."""
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return text


def _truncate_preview(val: Any, max_length: int = 500) -> Optional[str]:
    """Format and truncate preview text for tool inputs and outputs."""
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        try:
            val_str = json.dumps(val, ensure_ascii=False, default=str)
        except Exception:
            val_str = str(val)
    else:
        val_str = str(val)

    if len(val_str) > max_length:
        return val_str[: max_length - 3] + "..."
    return val_str


WORKFLOW_AGENT_FIELDS = ("current_task", "active_task_id", "workflow_run_id", "workflow_node")


def apply_workflow_projection(
    agent_map: Dict[str, Dict[str, Any]],
    assignments: List[Dict[str, Any]],
) -> None:
    """Project workflow workstation assignments onto office agents in place.

    `agent_map` is keyed by lower-case agent id. `assignments` come from
    WorkflowService.workstation_assignments(), most recently updated first;
    the first assignment per workstation becomes the agent's primary one and
    overrides its status. Agents without an assignment get empty workflow
    fields and keep their own status. Unknown workstations are added as
    minimal agents so no live workflow step is hidden.
    """
    by_desk: Dict[str, List[Dict[str, Any]]] = {}
    for item in assignments:
        by_desk.setdefault(str(item.get("workstation") or "").lower(), []).append(item)
    by_desk.pop("", None)

    for desk in by_desk:
        if desk not in agent_map:
            agent_map[desk] = {
                "id": desk,
                "profile_name": desk.replace("_", " ").title(),
                "role": desk.replace("_", " ").title(),
                "status": "idle",
                "current_model": "unknown",
                "capabilities": [],
                "metadata": {},
                "last_seen_at": time.time(),
                "active_task": None,
                "recent_activities": [],
                "last_tool_call": None,
            }

    for aid, agent in agent_map.items():
        mine = by_desk.get(aid, [])
        primary = mine[0] if mine else None
        agent["workflow_assignment"] = primary
        agent["workflow_assignments"] = mine
        if primary is None:
            for key in WORKFLOW_AGENT_FIELDS:
                agent[key] = None
            continue
        agent["status"] = primary["status"]
        agent["current_task"] = primary["current_task"]
        agent["active_task_id"] = primary["task_id"]
        agent["workflow_run_id"] = primary["run_id"]
        agent["workflow_node"] = primary["node"]


# --- Task Bridge worker ingestion (read-only) ---

BRIDGE_ACTIVE_STATES = ("running",)
BRIDGE_LOG_NAMES = {"stdout": "stdout.log", "stderr": "stderr.log"}
BRIDGE_LOG_MAX_BYTES = 512 * 1024
BRIDGE_TAIL_MAX_BYTES = 256 * 1024

# Explicit tags ("workstation: webdev", "[godot]") map onto these desks.
BRIDGE_WORKSTATION_ALIASES: Dict[str, Tuple[str, ...]] = {
    "webdev": ("webdev", "web", "frontend", "web_engineer"),
    "coder": ("coder", "godot", "gamedev", "game_developer"),
    "devops": ("devops", "ops", "infra"),
    "qa": ("qa", "tester", "quality"),
    "artist": ("artist", "art"),
    "tyler": ("tyler", "manager", "director"),
}

# Keyword evidence used when a task carries no explicit tag.
BRIDGE_WORKSTATION_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "webdev": ("webdev", "react", "typescript", "tsx", "tailwind", "vite", "frontend",
               "front-end", "web", "css", "html", "browser", "bun", "ui"),
    "coder": ("godot", "godot4", "gdscript", "gdextension", "shader", "shaders", "physics",
              "tscn", "game", "gameplay"),
    "devops": ("devops", "docker", "kubernetes", "deploy", "deployment", "infra",
               "infrastructure", "systemd", "nginx", "pipeline", "observability", "ci"),
    "qa": ("qa", "regression", "verification", "audit", "playtest", "e2e"),
    "artist": ("artist", "art", "concept", "blender", "mesh", "rigging", "sprite",
               "texture", "textures", "glb", "hunyuan", "tripo"),
    "tyler": ("planning", "strategy", "roadmap", "coordination"),
}

_BRIDGE_TAG_RE = re.compile(
    r"(?:\b(?:workstation|role|desk|assignee|agent)\s*[:=]\s*|\[)([a-z_][a-z0-9_-]*)\]?")
_WORD_RE = re.compile(r"[a-z0-9_+#-]+")


def resolve_bridge_workstation(task: Dict[str, Any], default: str = "tyler") -> str:
    """Pick the workstation for a Task Bridge task.

    Precedence: explicit tag (``workstation: webdev`` / ``[godot]``) in the
    title, goal or project id; then the execution model (3D generators go to
    Artist); then keyword evidence weighted towards the title. Tasks with no
    evidence land on ``default`` (the managing director's desk).
    """
    alias_to_desk = {alias: desk for desk, aliases in BRIDGE_WORKSTATION_ALIASES.items()
                     for alias in aliases}

    role = str(task.get("role") or "").strip().lower()
    if role:
        desk = alias_to_desk.get(role.replace("-", "_"))
        if desk:
            return desk

    title = str(task.get("title") or "").lower()
    goal = str(task.get("goal") or "")[:4000].lower()
    project = str(task.get("project_id") or "").lower()
    constraints = str(task.get("constraints") or "").lower()

    for text in (project, title, goal, constraints):
        for match in _BRIDGE_TAG_RE.finditer(text):
            desk = alias_to_desk.get(match.group(1).replace("-", "_"))
            if desk:
                return desk
    if project.replace("-", "_") in alias_to_desk:
        return alias_to_desk[project.replace("-", "_")]

    model = str(task.get("model") or "").lower()
    if any(k in model for k in ("tripo", "hunyuan", "meshy")):
        return "artist"

    title_words = set(_WORD_RE.findall(title))
    goal_words = set(_WORD_RE.findall(goal))
    scores: Dict[str, int] = {}
    for desk, keywords in BRIDGE_WORKSTATION_KEYWORDS.items():
        score = sum(3 for k in keywords if k in title_words)
        score += sum(1 for k in keywords if k in goal_words)
        if score:
            scores[desk] = score
    if not scores:
        return default
    return max(scores.items(), key=lambda kv: kv[1])[0]


def _parse_bridge_time(value: Any) -> Optional[float]:
    """Task Bridge stores naive UTC ISO timestamps; return epoch seconds."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _pid_alive(pid: Any) -> bool:
    try:
        os.kill(int(pid), 0)
    except PermissionError:
        return True
    except (OSError, ValueError, TypeError, OverflowError):
        return False
    return True


def _read_tail_bytes(path: Path, max_bytes: int) -> Tuple[str, bool]:
    """Return (text, truncated) for the last ``max_bytes`` of a file."""
    size = path.stat().st_size
    with path.open("rb") as fh:
        if size > max_bytes:
            fh.seek(size - max_bytes)
        data = fh.read(max_bytes)
    text = data.decode("utf-8", errors="replace")
    if size > max_bytes:
        # Drop the partial first line after seeking into the middle of the file.
        text = text.split("\n", 1)[1] if "\n" in text else text
    return text, size > max_bytes


class TaskBridgeReader:
    """Read-only view over a Task Bridge ``tasks.db`` and its log artifacts.

    Agent Office never writes to Bridge: it opens the database with
    ``mode=ro`` and only reads ``stdout.log`` / ``stderr.log`` files the
    task points at (its artifacts list, its artifacts dir or working dir).
    """

    def __init__(
        self,
        db_path: Union[str, Path],
        artifacts_dir: Optional[Union[str, Path]] = None,
    ) -> None:
        self.db_path = Path(db_path)
        if artifacts_dir is not None:
            self.artifacts_dir: Optional[Path] = Path(artifacts_dir)
        elif os.environ.get("TASK_BRIDGE_ARTIFACTS_DIR"):
            self.artifacts_dir = Path(os.environ["TASK_BRIDGE_ARTIFACTS_DIR"])
        elif os.environ.get("XDG_STATE_HOME"):
            self.artifacts_dir = Path(os.environ["XDG_STATE_HOME"]) / "task-bridge" / "artifacts"
        else:
            self.artifacts_dir = Path.home() / ".local" / "state" / "task-bridge" / "artifacts"

    def _connect(self) -> sqlite3.Connection:
        if not self.db_path.is_file():
            raise FileNotFoundError(f"Task Bridge database not found: {self.db_path}")
        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=5.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _summarize(self, row: sqlite3.Row, now: Optional[float] = None) -> Dict[str, Any]:
        data = dict(row)
        now = time.time() if now is None else now
        try:
            artifacts = [str(a) for a in json.loads(data.get("artifacts") or "[]")]
        except (TypeError, ValueError):
            artifacts = []
        started = _parse_bridge_time(data.get("started_at"))
        completed = _parse_bridge_time(data.get("completed_at"))
        state = str(data.get("state") or "")
        pid = data.get("pid")
        if state in BRIDGE_ACTIVE_STATES:
            # Without a recorded pid the Bridge state is the best evidence we have.
            is_live = _pid_alive(pid) if pid else True
        else:
            is_live = False
        summary = {
            "task_id": data.get("id"),
            "title": data.get("title") or "",
            "goal": data.get("goal") or "",
            "state": state,
            "role": data.get("role") or "",
            "constraints": data.get("constraints") or "",
            "executor": data.get("executor") or "",
            "model": data.get("actual_model") or data.get("model_used")
            or data.get("requested_model") or "",
            "requested_model": data.get("requested_model") or "",
            "repo": data.get("repo") or "",
            "working_dir": data.get("working_dir") or "",
            "project_id": data.get("project_id"),
            "complexity": data.get("complexity") or "",
            "progress_summary": data.get("progress_summary") or "",
            "error": data.get("error") or "",
            "exit_code": data.get("exit_code"),
            "git_sha": data.get("git_sha"),
            "pid": pid,
            "artifacts": artifacts,
            "created_at": _parse_bridge_time(data.get("created_at")),
            "updated_at": _parse_bridge_time(data.get("updated_at")),
            "started_at": started,
            "completed_at": completed,
            "duration_seconds": (
                max(0.0, (completed or now) - started) if started is not None else None),
            "is_live": is_live,
        }
        summary["workstation"] = resolve_bridge_workstation(summary)
        summary.pop("goal")
        return summary

    def list_tasks(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Running tasks first, then the most recently updated ones."""
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM tasks ORDER BY (state = 'running') DESC, updated_at DESC LIMIT ?",
                (limit,)).fetchall()
        now = time.time()
        return [self._summarize(r, now) for r in rows]

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return None if row is None else self._summarize(row)

    def log_path(self, task: Dict[str, Any], stream: str) -> Optional[Path]:
        """Locate ``stdout.log``/``stderr.log`` for a task, or None."""
        name = BRIDGE_LOG_NAMES[stream]
        candidates = [Path(a) for a in task.get("artifacts") or [] if Path(a).name == name]
        if self.artifacts_dir is not None and task.get("task_id"):
            candidates.append(self.artifacts_dir / str(task["task_id"]) / name)
        if task.get("working_dir"):
            candidates.append(Path(str(task["working_dir"])) / name)
        for path in candidates:
            if path.is_file():
                return path
        return None

    def tail_log(self, task: Dict[str, Any], stream: str, lines: int = 100) -> List[str]:
        path = self.log_path(task, stream)
        if path is None:
            return []
        try:
            text, _ = _read_tail_bytes(path, BRIDGE_TAIL_MAX_BYTES)
        except OSError:
            return []
        return text.splitlines()[-lines:] if lines > 0 else []

    def read_log(self, task: Dict[str, Any], stream: str) -> Dict[str, Any]:
        path = self.log_path(task, stream)
        result: Dict[str, Any] = {"path": str(path) if path else None, "text": "",
                                  "size_bytes": 0, "truncated": False}
        if path is None:
            return result
        try:
            result["size_bytes"] = path.stat().st_size
            result["text"], result["truncated"] = _read_tail_bytes(path, BRIDGE_LOG_MAX_BYTES)
        except OSError as exc:
            result["error"] = str(exc)
        return result

    def list_artifacts(self, task: Dict[str, Any]) -> List[Dict[str, Any]]:
        paths: List[Path] = [Path(a) for a in task.get("artifacts") or []]
        if self.artifacts_dir is not None and task.get("task_id"):
            task_dir = self.artifacts_dir / str(task["task_id"])
            if task_dir.is_dir():
                paths.extend(sorted(p for p in task_dir.iterdir() if p.is_file()))
        seen: set = set()
        result = []
        for path in paths:
            key = str(path)
            if key in seen:
                continue
            seen.add(key)
            exists = path.is_file()
            result.append({"path": key, "name": path.name, "exists": exists,
                           "size_bytes": path.stat().st_size if exists else None})
        return result


def apply_bridge_projection(
    agent_map: Dict[str, Dict[str, Any]],
    tasks: List[Dict[str, Any]],
    recent_per_agent: int = 5,
) -> int:
    """Reflect Task Bridge tasks onto office workstations in place.

    `tasks` come from TaskBridgeReader.list_tasks() (running first). Each
    agent gets ``bridge_tasks`` (its most recent tasks). The first running
    task becomes the agent's active one (``status: working``) unless a
    workflow assignment already owns the workstation; tasks that a workflow
    attempt already projected are skipped. Returns the active task count.
    """
    workflow_task_ids = {
        str(a.get("task_id"))
        for agent in agent_map.values()
        for a in agent.get("workflow_assignments") or []
        if a.get("task_id")
    }
    by_desk: Dict[str, List[Dict[str, Any]]] = {}
    for task in tasks:
        by_desk.setdefault(str(task.get("workstation") or "").lower(), []).append(task)

    active = 0
    for aid, agent in agent_map.items():
        mine = by_desk.get(aid, [])
        agent["bridge_tasks"] = mine[:recent_per_agent]
        running = [t for t in mine if t.get("state") in BRIDGE_ACTIVE_STATES
                   and str(t.get("task_id")) not in workflow_task_ids]
        agent["bridge_task"] = running[0] if running else None
        failed = [t for t in mine if t.get("state") in ("failed", "blocked")
                  and str(t.get("task_id")) not in workflow_task_ids]
        if failed:
            agent["recent_failure"] = failed[0]
        if not running or agent.get("workflow_assignment"):
            continue
        task = running[0]
        agent["status"] = "working"
        agent["active_task_id"] = task["task_id"]
        agent["current_task"] = task["title"]
        active += 1
    return active


class Migration:
    """Represents a discrete database schema migration."""

    def __init__(self, version: int, description: str, up_sql: str) -> None:
        self.version = version
        self.description = description
        self.up_sql = up_sql


# Migration registry
MIGRATIONS: list[Migration] = [
    Migration(
        version=1,
        description="Initial schema: agents, activity_events, task_snapshots",
        up_sql="""
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            profile_name TEXT,
            role TEXT,
            status TEXT,
            current_model TEXT,
            capabilities_json TEXT,
            last_seen_at REAL,
            metadata_json TEXT
        );

        CREATE TABLE IF NOT EXISTS activity_events (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            event_type TEXT,
            agent_id TEXT,
            tool_name TEXT,
            tool_input_preview TEXT,
            tool_output_preview TEXT,
            latency_ms REAL,
            status TEXT,
            timestamp REAL,
            details_json TEXT
        );

        CREATE TABLE IF NOT EXISTS task_snapshots (
            id TEXT PRIMARY KEY,
            kanban_task_id TEXT,
            board_slug TEXT,
            title TEXT,
            status TEXT,
            assignee TEXT,
            priority TEXT,
            updated_at REAL,
            raw_snapshot_json TEXT
        );

        CREATE TABLE IF NOT EXISTS routing_decisions (
            id TEXT PRIMARY KEY,
            task_id TEXT,
            selected_agent_id TEXT,
            selected_profile_name TEXT,
            router_used TEXT,
            confidence REAL,
            risk_level TEXT,
            candidate_scores_json TEXT,
            risk_assessment_json TEXT,
            rationale TEXT,
            timestamp REAL,
            metadata_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_activity_events_session ON activity_events(session_id);
        CREATE INDEX IF NOT EXISTS idx_activity_events_agent ON activity_events(agent_id);
        CREATE INDEX IF NOT EXISTS idx_activity_events_timestamp ON activity_events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_task_snapshots_kanban ON task_snapshots(kanban_task_id);
        CREATE INDEX IF NOT EXISTS idx_task_snapshots_board ON task_snapshots(board_slug);
        CREATE INDEX IF NOT EXISTS idx_task_snapshots_status ON task_snapshots(status);
        CREATE INDEX IF NOT EXISTS idx_routing_decisions_task ON routing_decisions(task_id);
        CREATE INDEX IF NOT EXISTS idx_routing_decisions_agent ON routing_decisions(selected_agent_id);
        CREATE INDEX IF NOT EXISTS idx_routing_decisions_timestamp ON routing_decisions(timestamp);
        """,
    ),
]


class OfficeStorage:
    """Thread-safe, fail-open SQLite storage manager for Agent Office."""

    def __init__(
        self,
        db_path: Optional[Union[str, Path]] = None,
        auto_migrate: bool = True,
    ) -> None:
        if db_path is not None:
            self.db_path: Union[str, Path] = str(db_path) if str(db_path) == ":memory:" else Path(db_path)
        else:
            self.db_path = get_default_db_path()

        self._lock = threading.RLock()
        self._conn: Optional[sqlite3.Connection] = None

        if self.is_file_db:
            try:
                Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            except Exception as exc:
                logger.warning("Agent Office: Could not create database directory: %s", exc)

        if auto_migrate:
            self.migrate()

    @property
    def is_memory(self) -> bool:
        return str(self.db_path) == ":memory:"

    @property
    def is_file_db(self) -> bool:
        return not self.is_memory

    def get_connection(self) -> sqlite3.Connection:
        """Obtain or initialize SQLite connection with WAL mode and pragmas."""
        with self._lock:
            if self._conn is None:
                db_target = ":memory:" if self.is_memory else str(self.db_path)
                conn = sqlite3.connect(
                    db_target,
                    timeout=30.0,
                    check_same_thread=False,
                    isolation_level=None,  # Autocommit mode; explicit transactions used when needed
                )
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA busy_timeout = 5000;")
                if not self.is_memory:
                    try:
                        conn.execute("PRAGMA journal_mode = WAL;")
                    except Exception as exc:
                        logger.debug("WAL mode pragma ignored: %s", exc)
                conn.execute("PRAGMA foreign_keys = ON;")
                self._conn = conn
            return self._conn

    def close(self) -> None:
        """Close database connection."""
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except Exception:
                    pass
                self._conn = None

    # --- Migration Engine ---

    @_fail_open(default_return=False)
    def migrate(self) -> bool:
        """Execute pending schema migrations in version sequence."""
        with self._lock:
            conn = self.get_connection()
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at REAL NOT NULL,
                    description TEXT
                );
                """
            )

            # Query already applied migration versions
            cur = conn.execute("SELECT version FROM schema_migrations ORDER BY version ASC;")
            applied_versions = {row["version"] for row in cur.fetchall()}

            for migration in sorted(MIGRATIONS, key=lambda m: m.version):
                if migration.version not in applied_versions:
                    logger.info(
                        "Applying Agent Office migration %d: %s",
                        migration.version,
                        migration.description,
                    )
                    escaped_desc = migration.description.replace("'", "''")
                    now_ts = time.time()
                    conn.executescript(
                        f"{migration.up_sql}\n"
                        f"INSERT INTO schema_migrations (version, applied_at, description) "
                        f"VALUES ({migration.version}, {now_ts}, '{escaped_desc}');"
                    )

            return True

    @_fail_open(default_return=[])
    def get_applied_migrations(self) -> list[dict[str, Any]]:
        """Return list of applied migrations."""
        with self._lock:
            conn = self.get_connection()
            cur = conn.execute(
                "SELECT version, applied_at, description FROM schema_migrations ORDER BY version ASC;"
            )
            return [dict(row) for row in cur.fetchall()]

    # --- Agent State Updater ---

    @_fail_open(default_return=None)
    def register_or_update_agent(
        self,
        agent_id: str,
        profile_name: Optional[str] = None,
        role: Optional[str] = None,
        status: Optional[str] = None,
        current_model: Optional[str] = None,
        capabilities: Optional[Union[dict[str, Any], list[Any], str]] = None,
        last_seen_at: Optional[float] = None,
        metadata: Optional[Union[dict[str, Any], str]] = None,
    ) -> Optional[dict[str, Any]]:
        """Register a new agent or update existing fields (upsert)."""
        if not agent_id:
            return None

        now = time.time() if last_seen_at is None else float(last_seen_at)
        cap_json = _serialize_json(capabilities) if not isinstance(capabilities, str) else capabilities
        meta_json = _serialize_json(metadata) if not isinstance(metadata, str) else metadata

        with self._lock:
            conn = self.get_connection()
            # Check existing record
            cur = conn.execute("SELECT * FROM agents WHERE id = ?;", (agent_id,))
            existing = cur.fetchone()

            if existing is None:
                conn.execute(
                    """
                    INSERT INTO agents (
                        id, profile_name, role, status, current_model,
                        capabilities_json, last_seen_at, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        agent_id,
                        profile_name,
                        role or "agent",
                        status or "idle",
                        current_model,
                        cap_json,
                        now,
                        meta_json,
                    ),
                )
            else:
                new_profile = profile_name if profile_name is not None else existing["profile_name"]
                new_role = role if role is not None else existing["role"]
                new_status = status if status is not None else existing["status"]
                new_model = current_model if current_model is not None else existing["current_model"]
                new_cap = cap_json if capabilities is not None else existing["capabilities_json"]
                new_meta = meta_json if metadata is not None else existing["metadata_json"]

                conn.execute(
                    """
                    UPDATE agents SET
                        profile_name = ?,
                        role = ?,
                        status = ?,
                        current_model = ?,
                        capabilities_json = ?,
                        last_seen_at = ?,
                        metadata_json = ?
                    WHERE id = ?;
                    """,
                    (new_profile, new_role, new_status, new_model, new_cap, now, new_meta, agent_id),
                )

            return self.get_agent(agent_id)

    @_fail_open(default_return=False)
    def update_status(
        self,
        agent_id: str,
        status: str,
        current_model: Optional[str] = None,
        last_seen_at: Optional[float] = None,
    ) -> bool:
        """Update agent status and touch last_seen_at timestamp."""
        now = time.time() if last_seen_at is None else float(last_seen_at)
        with self._lock:
            conn = self.get_connection()
            if current_model is not None:
                cur = conn.execute(
                    """
                    UPDATE agents SET status = ?, current_model = ?, last_seen_at = ?
                    WHERE id = ?;
                    """,
                    (status, current_model, now, agent_id),
                )
            else:
                cur = conn.execute(
                    """
                    UPDATE agents SET status = ?, last_seen_at = ?
                    WHERE id = ?;
                    """,
                    (status, now, agent_id),
                )
            return cur.rowcount > 0

    @_fail_open(default_return=None)
    def get_agent(self, agent_id: str) -> Optional[dict[str, Any]]:
        """Fetch agent state dictionary by agent ID."""
        with self._lock:
            conn = self.get_connection()
            cur = conn.execute("SELECT * FROM agents WHERE id = ?;", (agent_id,))
            row = cur.fetchone()
            if row is None:
                return None
            res = dict(row)
            res["capabilities"] = _deserialize_json(res.get("capabilities_json"))
            res["metadata"] = _deserialize_json(res.get("metadata_json"))
            return res

    @_fail_open(default_return=[])
    def list_agents(
        self,
        status: Optional[str] = None,
        role: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Query agent records with optional filters."""
        query = "SELECT * FROM agents WHERE 1=1"
        params: list[Any] = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if role:
            query += " AND role = ?"
            params.append(role)
        query += " ORDER BY last_seen_at DESC LIMIT ?;"
        params.append(limit)

        with self._lock:
            conn = self.get_connection()
            cur = conn.execute(query, params)
            results = []
            for row in cur.fetchall():
                d = dict(row)
                d["capabilities"] = _deserialize_json(d.get("capabilities_json"))
                d["metadata"] = _deserialize_json(d.get("metadata_json"))
                results.append(d)
            return results

    # --- Task Projection Updater ---

    @_fail_open(default_return=None)
    def upsert_task_snapshot(
        self,
        kanban_task_id: str,
        board_slug: Optional[str] = None,
        title: Optional[str] = None,
        status: Optional[str] = None,
        assignee: Optional[str] = None,
        priority: Optional[str] = None,
        updated_at: Optional[float] = None,
        raw_snapshot: Optional[Union[dict[str, Any], str]] = None,
        snapshot_id: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        """Insert or update a task projection snapshot."""
        if not kanban_task_id:
            return None

        record_id = snapshot_id or kanban_task_id
        now = time.time() if updated_at is None else float(updated_at)
        raw_json = _serialize_json(raw_snapshot) if not isinstance(raw_snapshot, str) else raw_snapshot

        with self._lock:
            conn = self.get_connection()
            cur = conn.execute(
                "SELECT * FROM task_snapshots WHERE kanban_task_id = ? OR id = ?;",
                (kanban_task_id, record_id),
            )
            existing = cur.fetchone()

            if existing is None:
                conn.execute(
                    """
                    INSERT INTO task_snapshots (
                        id, kanban_task_id, board_slug, title, status,
                        assignee, priority, updated_at, raw_snapshot_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ? ,?);
                    """,
                    (
                        record_id,
                        kanban_task_id,
                        board_slug or "default",
                        title or "",
                        status or "todo",
                        assignee,
                        priority or "normal",
                        now,
                        raw_json,
                    ),
                )
            else:
                new_board = board_slug if board_slug is not None else existing["board_slug"]
                new_title = title if title is not None else existing["title"]
                new_status = status if status is not None else existing["status"]
                new_assignee = assignee if assignee is not None else existing["assignee"]
                new_priority = priority if priority is not None else existing["priority"]
                new_raw = raw_json if raw_snapshot is not None else existing["raw_snapshot_json"]

                conn.execute(
                    """
                    UPDATE task_snapshots SET
                        board_slug = ?,
                        title = ?,
                        status = ?,
                        assignee = ?,
                        priority = ?,
                        updated_at = ?,
                        raw_snapshot_json = ?
                    WHERE id = ?;
                    """,
                    (
                        new_board,
                        new_title,
                        new_status,
                        new_assignee,
                        new_priority,
                        now,
                        new_raw,
                        existing["id"],
                    ),
                )
                record_id = existing["id"]

            return self.get_task_snapshot(record_id)

    @_fail_open(default_return=None)
    def get_task_snapshot(self, task_or_snapshot_id: str) -> Optional[dict[str, Any]]:
        """Retrieve task snapshot by record id or kanban_task_id."""
        with self._lock:
            conn = self.get_connection()
            cur = conn.execute(
                "SELECT * FROM task_snapshots WHERE id = ? OR kanban_task_id = ?;",
                (task_or_snapshot_id, task_or_snapshot_id),
            )
            row = cur.fetchone()
            if row is None:
                return None
            res = dict(row)
            res["raw_snapshot"] = _deserialize_json(res.get("raw_snapshot_json"))
            return res

    @_fail_open(default_return=[])
    def query_active_tasks(
        self,
        board_slug: Optional[str] = None,
        assignee: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Query currently active tasks (excluding done/archived/completed)."""
        active_statuses = ("todo", "in_progress", "doing", "review", "blocked")
        placeholders = ",".join("?" for _ in active_statuses)
        query = f"SELECT * FROM task_snapshots WHERE status IN ({placeholders})"
        params: list[Any] = list(active_statuses)

        if board_slug:
            query += " AND board_slug = ?"
            params.append(board_slug)
        if assignee:
            query += " AND assignee = ?"
            params.append(assignee)

        query += " ORDER BY updated_at DESC LIMIT ?;"
        params.append(limit)

        with self._lock:
            conn = self.get_connection()
            cur = conn.execute(query, params)
            results = []
            for row in cur.fetchall():
                d = dict(row)
                d["raw_snapshot"] = _deserialize_json(d.get("raw_snapshot_json"))
                results.append(d)
            return results

    @_fail_open(default_return=[])
    def list_recent_tasks(
        self,
        board_slug: Optional[str] = None,
        status: Optional[str] = None,
        assignee: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List tasks ordered by most recent update."""
        query = "SELECT * FROM task_snapshots WHERE 1=1"
        params: list[Any] = []
        if board_slug:
            query += " AND board_slug = ?"
            params.append(board_slug)
        if status:
            query += " AND status = ?"
            params.append(status)
        if assignee:
            query += " AND assignee = ?"
            params.append(assignee)

        query += " ORDER BY updated_at DESC LIMIT ?;"
        params.append(limit)

        with self._lock:
            conn = self.get_connection()
            cur = conn.execute(query, params)
            results = []
            for row in cur.fetchall():
                d = dict(row)
                d["raw_snapshot"] = _deserialize_json(d.get("raw_snapshot_json"))
                results.append(d)
            return results

    # --- Activity Event Persistence ---

    @_fail_open(default_return=False)
    def record_activity_event(
        self,
        event_id: str,
        session_id: Optional[str] = None,
        event_type: Optional[str] = None,
        agent_id: Optional[str] = None,
        tool_name: Optional[str] = None,
        tool_input_preview: Optional[str] = None,
        tool_output_preview: Optional[str] = None,
        latency_ms: Optional[float] = None,
        status: Optional[str] = None,
        timestamp: Optional[float] = None,
        details: Optional[Union[dict[str, Any], str]] = None,
    ) -> bool:
        """Insert or ignore an activity event row in activity_events table."""
        ts = time.time() if timestamp is None else float(timestamp)
        details_json = _serialize_json(details) if not isinstance(details, str) else details

        with self._lock:
            conn = self.get_connection()
            conn.execute(
                """
                INSERT OR IGNORE INTO activity_events (
                    id, session_id, event_type, agent_id, tool_name,
                    tool_input_preview, tool_output_preview, latency_ms,
                    status, timestamp, details_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    event_id,
                    session_id,
                    event_type,
                    agent_id,
                    tool_name,
                    tool_input_preview,
                    tool_output_preview,
                    latency_ms,
                    status,
                    ts,
                    details_json,
                ),
            )
            return True

    @_fail_open(default_return=False)
    def ingest_event(self, event: Event) -> bool:
        """Parse structured Event and persist as an activity event with field extraction."""
        payload = event.data or {}

        # 1. Extract agent identifier
        agent_id = (
            payload.get("agent_id")
            or payload.get("agent")
            or payload.get("profile_name")
            or payload.get("profile")
        )

        # 2. Extract tool name
        tool_name = payload.get("tool_name") or payload.get("tool") or payload.get("name")

        # 3. Extract tool input preview
        tool_input = (
            payload.get("args")
            or payload.get("input")
            or payload.get("parameters")
            or payload.get("tool_input")
            or payload.get("user_message")
        )
        tool_input_preview = _truncate_preview(tool_input)

        # 4. Extract tool output preview
        tool_output = (
            payload.get("result")
            or payload.get("output")
            or payload.get("tool_output")
            or payload.get("assistant_message")
            or payload.get("error")
        )
        tool_output_preview = _truncate_preview(tool_output)

        # 5. Extract latency/duration
        latency = (
            payload.get("latency_ms")
            or payload.get("duration_ms")
            or payload.get("latency")
            or payload.get("duration")
        )
        latency_ms = None
        if latency is not None:
            try:
                latency_ms = float(latency)
            except (ValueError, TypeError):
                pass

        # 6. Extract status
        status = payload.get("status")
        if not status:
            if payload.get("error") is not None or payload.get("failed") is True:
                status = "error"
            elif event.event_type in ("after_tool_call", "after_turn", "session_end"):
                status = "success"
            elif event.event_type in ("before_tool_call", "before_turn", "session_start"):
                status = "running"
            else:
                status = "info"

        if agent_id:
            agent_status = "idle" if event.event_type in ("session_end", "on_session_end") else "busy"
            model = payload.get("model") or payload.get("current_model")
            self.register_or_update_agent(
                agent_id=str(agent_id),
                status=agent_status,
                current_model=str(model) if model else None,
                last_seen_at=event.timestamp,
            )

        return self.record_activity_event(
            event_id=event.event_id,
            session_id=event.session_id,
            event_type=event.event_type,
            agent_id=str(agent_id) if agent_id is not None else None,
            tool_name=str(tool_name) if tool_name is not None else None,
            tool_input_preview=tool_input_preview,
            tool_output_preview=tool_output_preview,
            latency_ms=latency_ms,
            status=str(status) if status is not None else None,
            timestamp=event.timestamp,
            details=payload,
        )

    @_fail_open(default_return=None)
    def get_activity_event(self, event_id: str) -> Optional[dict[str, Any]]:
        """Fetch activity event record by ID."""
        with self._lock:
            conn = self.get_connection()
            cur = conn.execute("SELECT * FROM activity_events WHERE id = ?;", (event_id,))
            row = cur.fetchone()
            if row is None:
                return None
            res = dict(row)
            res["details"] = _deserialize_json(res.get("details_json"))
            return res

    @_fail_open(default_return=[])
    def list_activity_events(
        self,
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        event_type: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Query activity events with filtering."""
        query = "SELECT * FROM activity_events WHERE 1=1"
        params: list[Any] = []
        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        if agent_id:
            query += " AND agent_id = ?"
            params.append(agent_id)
        if event_type:
            query += " AND event_type = ?"
            params.append(event_type)

        query += " ORDER BY timestamp DESC LIMIT ?;"
        params.append(limit)

        with self._lock:
            conn = self.get_connection()
            cur = conn.execute(query, params)
            results = []
            for row in cur.fetchall():
                d = dict(row)
                d["details"] = _deserialize_json(d.get("details_json"))
                results.append(d)
            return results

    # --- Routing Decisions and Operational Stats ---

    @_fail_open(default_return=False)
    def record_routing_decision(
        self,
        decision: Any,
    ) -> bool:
        """Insert or replace a routing decision record.

        Accepts a RoutingDecision object (with to_dict()) or a dict.
        """
        if decision is None:
            return False

        if hasattr(decision, "to_dict") and callable(decision.to_dict):
            data = decision.to_dict()
        elif isinstance(decision, dict):
            data = decision
        else:
            return False

        dec_id = str(data.get("decision_id") or data.get("id") or "")
        if not dec_id:
            return False

        task_id = str(data.get("task_id", ""))
        selected_agent = str(data.get("selected_agent_id", ""))
        selected_profile = str(data.get("selected_profile_name", ""))
        router_used = str(data.get("router_used", "heuristic"))
        confidence = float(data.get("confidence", 0.0))

        risk = data.get("risk_assessment")
        risk_level = ""
        if isinstance(risk, dict):
            risk_level = str(risk.get("level", ""))
        elif hasattr(risk, "level"):
            risk_level = str(getattr(risk.level, "value", risk.level))

        scores_json = _serialize_json(data.get("candidate_scores"))
        risk_json = _serialize_json(risk)
        rationale = str(data.get("rationale", ""))
        ts = float(data.get("timestamp", time.time()))
        meta_json = _serialize_json(data.get("metadata"))

        with self._lock:
            conn = self.get_connection()
            conn.execute(
                """
                INSERT OR REPLACE INTO routing_decisions (
                    id, task_id, selected_agent_id, selected_profile_name,
                    router_used, confidence, risk_level, candidate_scores_json,
                    risk_assessment_json, rationale, timestamp, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    dec_id,
                    task_id,
                    selected_agent,
                    selected_profile,
                    router_used,
                    confidence,
                    risk_level,
                    scores_json,
                    risk_json,
                    rationale,
                    ts,
                    meta_json,
                ),
            )
            return True

    @_fail_open(default_return=None)
    def get_routing_decision(self, decision_id: str) -> Optional[dict[str, Any]]:
        """Fetch routing decision record by decision ID."""
        if not decision_id:
            return None
        with self._lock:
            conn = self.get_connection()
            cur = conn.execute("SELECT * FROM routing_decisions WHERE id = ?;", (decision_id,))
            row = cur.fetchone()
            if row is None:
                return None
            res = dict(row)
            res["candidate_scores"] = _deserialize_json(res.get("candidate_scores_json"))
            res["risk_assessment"] = _deserialize_json(res.get("risk_assessment_json"))
            res["metadata"] = _deserialize_json(res.get("metadata_json"))
            return res

    @_fail_open(default_return=[])
    def list_routing_decisions(
        self,
        task_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Query routing decisions with filtering."""
        query = "SELECT * FROM routing_decisions WHERE 1=1"
        params: list[Any] = []
        if task_id:
            query += " AND task_id = ?"
            params.append(task_id)
        if agent_id:
            query += " AND selected_agent_id = ?"
            params.append(agent_id)
        query += " ORDER BY timestamp DESC LIMIT ?;"
        params.append(limit)

        with self._lock:
            conn = self.get_connection()
            cur = conn.execute(query, params)
            results = []
            for row in cur.fetchall():
                d = dict(row)
                d["candidate_scores"] = _deserialize_json(d.get("candidate_scores_json"))
                d["risk_assessment"] = _deserialize_json(d.get("risk_assessment_json"))
                d["metadata"] = _deserialize_json(d.get("metadata_json"))
                results.append(d)
            return results

    @_fail_open(default_return=False)
    def update_agent_operational_stats(
        self,
        agent_id: str,
        latency_ms: Optional[float] = None,
        error_occurred: Optional[bool] = None,
        cost: Optional[float] = None,
        success: Optional[bool] = None,
    ) -> bool:
        """Update operational statistics (latency, error rate, cost, success rate) for an agent."""
        if not agent_id:
            return False

        with self._lock:
            agent = self.get_agent(agent_id)
            if agent is None:
                self.register_or_update_agent(agent_id=agent_id, profile_name=agent_id.capitalize())
                agent = self.get_agent(agent_id)
                if agent is None:
                    return False

            metadata = agent.get("metadata") or {}
            stats = metadata.get("operational_stats") or {
                "latency_ms": 0.0,
                "total_calls": 0,
                "error_count": 0,
                "error_rate": 0.0,
                "cost_per_token": 0.0,
                "total_cost": 0.0,
                "success_rate": 1.0,
                "active_tasks": 0,
            }

            total_calls = int(stats.get("total_calls", 0)) + 1
            stats["total_calls"] = total_calls

            if latency_ms is not None:
                prev_lat = float(stats.get("latency_ms", 0.0))
                new_lat = ((prev_lat * (total_calls - 1)) + float(latency_ms)) / total_calls
                stats["latency_ms"] = round(new_lat, 2)

            error_count = int(stats.get("error_count", 0))
            if error_occurred is True or (success is False):
                error_count += 1
            stats["error_count"] = error_count
            stats["error_rate"] = round(error_count / total_calls, 4)
            stats["success_rate"] = round((total_calls - error_count) / total_calls, 4)

            if cost is not None:
                stats["total_cost"] = round(float(stats.get("total_cost", 0.0)) + float(cost), 6)

            metadata["operational_stats"] = stats
            self.register_or_update_agent(agent_id=agent_id, metadata=metadata)
            return True

    @_fail_open(default_return={})
    def get_agent_operational_stats(self, agent_id: str) -> dict[str, Any]:
        """Fetch operational statistics dictionary for an agent."""
        if not agent_id:
            return {}
        agent = self.get_agent(agent_id)
        if not agent:
            return {
                "latency_ms": 0.0,
                "total_calls": 0,
                "error_count": 0,
                "error_rate": 0.0,
                "success_rate": 1.0,
                "total_cost": 0.0,
                "active_tasks": 0,
            }
        metadata = agent.get("metadata") or {}
        return dict(metadata.get("operational_stats") or {
            "latency_ms": 0.0,
            "total_calls": 0,
            "error_count": 0,
            "error_rate": 0.0,
            "success_rate": 1.0,
            "total_cost": 0.0,
            "active_tasks": 0,
        })


class EventSink:
    """Event subscriber bridging EventDispatcher to OfficeStorage.

    Subscribes to an EventDispatcher (wildcard '*' by default) and ingests
    all telemetry events directly into the isolated local SQLite storage.
    Enforces fail-open design so database errors never disrupt event propagation.
    """

    def __init__(
        self,
        storage: Optional[OfficeStorage] = None,
        dispatcher: Optional[EventDispatcher] = None,
        auto_attach: bool = True,
    ) -> None:
        self.storage = storage if storage is not None else get_default_storage()
        self.dispatcher = dispatcher if dispatcher is not None else get_default_dispatcher()
        self._unsub: Optional[Callable[[], None]] = None
        self._lock = threading.Lock()

        if auto_attach:
            self.attach()

    def handle_event(self, event: Event) -> None:
        """Subscriber callback handling and persisting an incoming Event."""
        try:
            self.storage.ingest_event(event)
        except Exception as exc:
            logger.warning("Agent Office: EventSink failed to ingest event %s: %s", event.event_id, exc)

    def attach(self) -> None:
        """Subscribe to the dispatcher."""
        with self._lock:
            if self._unsub is None:
                self._unsub = self.dispatcher.subscribe("*", self.handle_event)

    def detach(self) -> None:
        """Unsubscribe from the dispatcher."""
        with self._lock:
            if self._unsub is not None:
                try:
                    self._unsub()
                except Exception:
                    pass
                self._unsub = None

    @property
    def is_attached(self) -> bool:
        with self._lock:
            return self._unsub is not None


_GLOBAL_STORAGE: Optional[OfficeStorage] = None
_GLOBAL_SINK: Optional[EventSink] = None
_STORAGE_LOCK = threading.RLock()


def get_default_storage() -> OfficeStorage:
    """Return singleton instance of OfficeStorage for the process."""
    global _GLOBAL_STORAGE
    with _STORAGE_LOCK:
        if _GLOBAL_STORAGE is None:
            _GLOBAL_STORAGE = OfficeStorage()
        return _GLOBAL_STORAGE


def reset_default_storage(db_path: Optional[Union[str, Path]] = None) -> OfficeStorage:
    """Reset and reinitialize the global default OfficeStorage instance."""
    global _GLOBAL_STORAGE, _GLOBAL_SINK
    with _STORAGE_LOCK:
        if _GLOBAL_SINK is not None:
            _GLOBAL_SINK.detach()
            _GLOBAL_SINK = None
        if _GLOBAL_STORAGE is not None:
            _GLOBAL_STORAGE.close()
        _GLOBAL_STORAGE = OfficeStorage(db_path=db_path)
        return _GLOBAL_STORAGE


def get_default_sink() -> EventSink:
    """Return singleton instance of EventSink."""
    global _GLOBAL_SINK
    with _STORAGE_LOCK:
        if _GLOBAL_SINK is None:
            _GLOBAL_SINK = EventSink()
        return _GLOBAL_SINK
