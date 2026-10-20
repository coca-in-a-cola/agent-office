"""High-level service coordinating Agent Office Process Studio editor actions (v1).

Handles:
- Loading and saving drafts with revision checks
- Validation against schemas and graph invariants
- Atomic graph publication with canonical hashing
- Immutable retrieval of published graphs
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Optional

from .canonical import canonicalize_graph
from .storage import EditorStorage, RevisionConflictError
from .validator import validate_graph


class EditorApiError(Exception):
    """Exception for editor API routing and dispatch with HTTP status."""

    def __init__(self, status: int, message: str, **extra: Any):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


class EditorService:
    """Service facade for Process Studio drafts, validation, and publishing."""

    def __init__(self, db_path: str | Path, schema_path: Optional[Path] = None):
        self.storage = EditorStorage(db_path)
        self.schema_path = schema_path

    def save_draft(
        self,
        draft_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Save a draft graph with optimistic revision checking."""
        if not draft_id or not draft_id.strip():
            raise EditorApiError(400, "draft_id must not be empty")

        # Payload may contain {"graph": {...}, "revision": 1} or be the graph itself
        if "graph" in payload and isinstance(payload["graph"], dict):
            graph = payload["graph"]
            expected_revision = payload.get("revision") or payload.get("expected_revision")
        else:
            graph = payload
            expected_revision = payload.get("revision") or payload.get("expected_revision")

        try:
            return self.storage.save_draft(draft_id, graph, expected_revision=expected_revision)
        except RevisionConflictError as exc:
            raise EditorApiError(
                409,
                exc.message,
                current_revision=exc.current_revision,
                expected_revision=exc.expected_revision,
            )

    def get_draft(self, draft_id: str) -> dict[str, Any]:
        """Retrieve a draft by ID."""
        draft = self.storage.get_draft(draft_id)
        if draft is None:
            raise EditorApiError(404, f"draft '{draft_id}' not found")
        return draft

    def list_drafts(self) -> list[dict[str, Any]]:
        """List summary of all drafts."""
        return self.storage.list_drafts()

    def validate(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Validate a graph definition against schema and contracts."""
        graph = payload.get("graph") if isinstance(payload.get("graph"), dict) else payload
        errors = validate_graph(graph, schema_path=self.schema_path)

        definition_hash = None
        if not errors:
            try:
                _, definition_hash = canonicalize_graph(graph)
            except Exception as exc:
                errors.append(f"Failed to compute canonical hash: {exc}")

        return {
            "status": "ok",
            "valid": len(errors) == 0,
            "errors": errors,
            "definition_hash": definition_hash,
        }

    def publish(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Validate, canonicalize, and atomically publish a new graph version.

        Invariants:
        - Atomic and immutable
        - Zero task submission to Bridge
        - Preserves existing run definitions and pinned versions
        """
        # Graph can be provided directly or referenced by draft_id
        if "draft_id" in payload:
            draft = self.storage.get_draft(payload["draft_id"])
            if draft is None:
                raise EditorApiError(404, f"draft '{payload['draft_id']}' not found for publishing")
            graph = draft["graph"]
        elif "graph" in payload and isinstance(payload["graph"], dict):
            graph = payload["graph"]
        else:
            graph = payload

        # 1. Strict validation prior to publishing
        errors = validate_graph(graph, schema_path=self.schema_path)
        if errors:
            raise EditorApiError(
                400,
                f"Graph validation failed with {len(errors)} error(s)",
                errors=errors,
            )

        # 2. Canonical serialization and hash
        canonical_json, definition_hash = canonicalize_graph(graph)
        graph_id = graph.get("graph_id")
        if not graph_id:
            raise EditorApiError(400, "graph_id is required in graph definition")

        # 3. Store publication record
        result = self.storage.publish_graph(
            graph_id=graph_id,
            definition_hash=definition_hash,
            canonical_json=canonical_json,
        )
        return {
            "status": "ok",
            **result,
        }

    def get_published(self, graph_id: str, version: Optional[int] = None) -> dict[str, Any]:
        """Retrieve an immutable published graph."""
        record = self.storage.get_published_graph(graph_id, version=version)
        if record is None:
            v_desc = f"version {version}" if version is not None else "latest version"
            raise EditorApiError(404, f"published graph '{graph_id}' ({v_desc}) not found")
        return record

    def list_published(self, graph_id: Optional[str] = None) -> list[dict[str, Any]]:
        """List versions of published graphs."""
        return self.storage.list_published_graphs(graph_id)
