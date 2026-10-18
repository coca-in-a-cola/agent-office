"""SQLite Storage, schema migrations, and local state projection for Agent Office.

Provides isolated local storage for agents, activity events, and task snapshots
with strict Fail-Open resilience to ensure database errors never disrupt agent turns.
"""

from __future__ import annotations

import functools
import json
import logging
import os
from pathlib import Path
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

        CREATE INDEX IF NOT EXISTS idx_activity_events_session ON activity_events(session_id);
        CREATE INDEX IF NOT EXISTS idx_activity_events_agent ON activity_events(agent_id);
        CREATE INDEX IF NOT EXISTS idx_activity_events_timestamp ON activity_events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_task_snapshots_kanban ON task_snapshots(kanban_task_id);
        CREATE INDEX IF NOT EXISTS idx_task_snapshots_board ON task_snapshots(board_slug);
        CREATE INDEX IF NOT EXISTS idx_task_snapshots_status ON task_snapshots(status);
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
