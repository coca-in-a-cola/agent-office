"""SQLite storage for Agent Office Process Studio drafts and published graphs (v1).

Schema:
- editor_drafts: (draft_id, graph_id, revision, graph_json, updated_at)
- editor_published_graphs: (graph_id, version, definition_hash, canonical_json, created_at)

Invariants:
- Optimistic concurrency: Stale revision updates raise RevisionConflictError.
- Draft reload preserves exact layout, viewport, and semantic components.
- Published graphs are immutable and monotonically versioned per graph_id.
- Graph publication is decoupled from runtime task execution; zero tasks are submitted to Bridge.
- Existing workflow_definitions and workflow_runs tables remain untouched.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import threading
from typing import Any, Optional


class RevisionConflictError(Exception):
    """Raised when saving a draft with a stale or mismatched revision."""

    def __init__(self, message: str, current_revision: int, expected_revision: int | None = None):
        super().__init__(message)
        self.message = message
        self.current_revision = current_revision
        self.expected_revision = expected_revision


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class EditorStorage:
    """Thread-safe SQLite storage for node editor drafts and published graphs."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    def _init_db(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS editor_drafts (
                    draft_id TEXT PRIMARY KEY,
                    graph_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    graph_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_editor_drafts_graph
                ON editor_drafts (graph_id);

                CREATE TABLE IF NOT EXISTS editor_published_graphs (
                    graph_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    definition_hash TEXT NOT NULL,
                    canonical_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (graph_id, version)
                );

                CREATE INDEX IF NOT EXISTS idx_editor_published_hash
                ON editor_published_graphs (definition_hash);
                """
            )

    def save_draft(
        self,
        draft_id: str,
        graph: dict[str, Any],
        expected_revision: Optional[int] = None,
    ) -> dict[str, Any]:
        """Save or update a graph draft with optimistic concurrency check.

        Raises:
            RevisionConflictError: If expected_revision does not match current database revision.
        """
        graph_id = graph.get("graph_id") or draft_id
        graph_json = json.dumps(graph, ensure_ascii=False)
        now = _now_iso()

        with self._lock, self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT revision FROM editor_drafts WHERE draft_id = ?",
                (draft_id,),
            )
            row = cursor.fetchone()

            if row is not None:
                cur_revision = int(row["revision"])
                if expected_revision is not None and expected_revision != cur_revision:
                    raise RevisionConflictError(
                        f"Stale revision conflict on draft '{draft_id}': "
                        f"current revision is {cur_revision}, expected {expected_revision}",
                        current_revision=cur_revision,
                        expected_revision=expected_revision,
                    )
                new_revision = cur_revision + 1
                cursor.execute(
                    """
                    UPDATE editor_drafts
                    SET graph_id = ?, revision = ?, graph_json = ?, updated_at = ?
                    WHERE draft_id = ?
                    """,
                    (graph_id, new_revision, graph_json, now, draft_id),
                )
            else:
                if expected_revision is not None and expected_revision not in (0, 1):
                    raise RevisionConflictError(
                        f"Draft '{draft_id}' does not exist; cannot match expected revision {expected_revision}",
                        current_revision=0,
                        expected_revision=expected_revision,
                    )
                new_revision = 1
                cursor.execute(
                    """
                    INSERT INTO editor_drafts (draft_id, graph_id, revision, graph_json, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (draft_id, graph_id, new_revision, graph_json, now),
                )
            conn.commit()

        return {
            "draft_id": draft_id,
            "graph_id": graph_id,
            "revision": new_revision,
            "updated_at": now,
        }

    def get_draft(self, draft_id: str) -> Optional[dict[str, Any]]:
        """Retrieve a draft by ID including full graph JSON and layout."""
        with self._lock, self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT draft_id, graph_id, revision, graph_json, updated_at "
                "FROM editor_drafts WHERE draft_id = ?",
                (draft_id,),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            return {
                "draft_id": row["draft_id"],
                "graph_id": row["graph_id"],
                "revision": int(row["revision"]),
                "graph": json.loads(row["graph_json"]),
                "updated_at": row["updated_at"],
            }

    def list_drafts(self) -> list[dict[str, Any]]:
        """List summary of all drafts."""
        with self._lock, self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT draft_id, graph_id, revision, updated_at "
                "FROM editor_drafts ORDER BY updated_at DESC"
            )
            return [
                {
                    "draft_id": row["draft_id"],
                    "graph_id": row["graph_id"],
                    "revision": int(row["revision"]),
                    "updated_at": row["updated_at"],
                }
                for row in cursor.fetchall()
            ]

    def delete_draft(self, draft_id: str) -> bool:
        """Delete a draft."""
        with self._lock, self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM editor_drafts WHERE draft_id = ?", (draft_id,))
            conn.commit()
            return cursor.rowcount > 0

    def publish_graph(
        self,
        graph_id: str,
        definition_hash: str,
        canonical_json: str,
    ) -> dict[str, Any]:
        """Atomically record an immutable published version for a graph.

        Increments version monotonically per graph_id.
        """
        now = _now_iso()
        with self._lock, self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT MAX(version) AS max_v FROM editor_published_graphs WHERE graph_id = ?",
                (graph_id,),
            )
            row = cursor.fetchone()
            current_max = int(row["max_v"]) if row and row["max_v"] is not None else 0
            new_version = current_max + 1

            cursor.execute(
                """
                INSERT INTO editor_published_graphs
                    (graph_id, version, definition_hash, canonical_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (graph_id, new_version, definition_hash, canonical_json, now),
            )
            conn.commit()

        return {
            "graph_id": graph_id,
            "version": new_version,
            "definition_hash": definition_hash,
            "created_at": now,
        }

    def get_published_graph(
        self,
        graph_id: str,
        version: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        """Retrieve a published graph by graph_id and version (defaults to latest)."""
        with self._lock, self._connect() as conn:
            cursor = conn.cursor()
            if version is not None:
                cursor.execute(
                    """
                    SELECT graph_id, version, definition_hash, canonical_json, created_at
                    FROM editor_published_graphs
                    WHERE graph_id = ? AND version = ?
                    """,
                    (graph_id, version),
                )
            else:
                cursor.execute(
                    """
                    SELECT graph_id, version, definition_hash, canonical_json, created_at
                    FROM editor_published_graphs
                    WHERE graph_id = ?
                    ORDER BY version DESC LIMIT 1
                    """,
                    (graph_id,),
                )
            row = cursor.fetchone()
            if row is None:
                return None
            return {
                "graph_id": row["graph_id"],
                "version": int(row["version"]),
                "definition_hash": row["definition_hash"],
                "canonical_json": row["canonical_json"],
                "graph": json.loads(row["canonical_json"]),
                "created_at": row["created_at"],
            }

    def list_published_graphs(
        self,
        graph_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """List published graph versions."""
        with self._lock, self._connect() as conn:
            cursor = conn.cursor()
            if graph_id is not None:
                cursor.execute(
                    """
                    SELECT graph_id, version, definition_hash, created_at
                    FROM editor_published_graphs
                    WHERE graph_id = ?
                    ORDER BY version DESC
                    """,
                    (graph_id,),
                )
            else:
                cursor.execute(
                    """
                    SELECT graph_id, version, definition_hash, created_at
                    FROM editor_published_graphs
                    ORDER BY created_at DESC
                    """
                )
            return [
                {
                    "graph_id": row["graph_id"],
                    "version": int(row["version"]),
                    "definition_hash": row["definition_hash"],
                    "created_at": row["created_at"],
                }
                for row in cursor.fetchall()
            ]
