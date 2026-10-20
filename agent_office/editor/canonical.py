"""Canonical JSON serializer and semantic hasher for Agent Office graphs (v1).

Invariants:
- Visual presentation metadata ('layout', 'viewport') does NOT alter the execution hash.
- Server-managed publication fields ('definition_hash', 'canonical', 'version') are omitted from the semantic hash preimage.
- Any development/debug keys (starting with '_') are omitted.
- Stable, reproducible ordering across platforms via recursive key sorting and compact JSON encoding.
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

# Top-level keys excluded from the semantic execution hash
EXCLUDED_SEMANTIC_KEYS = {
    "layout",
    "viewport",
    "definition_hash",
    "canonical",
    "version",
}


def _clean_semantic_object(obj: Any) -> Any:
    """Recursively strip excluded keys and sort dictionaries."""
    if isinstance(obj, dict):
        cleaned: dict[str, Any] = {}
        for k in sorted(obj.keys()):
            if k in EXCLUDED_SEMANTIC_KEYS or k.startswith("_"):
                continue
            cleaned[k] = _clean_semantic_object(obj[k])
        return cleaned
    if isinstance(obj, list):
        return [_clean_semantic_object(item) for item in obj]
    return obj


def canonicalize_graph(graph: dict[str, Any]) -> tuple[str, str]:
    """Produce the canonical semantic JSON representation and SHA-256 hash.

    Returns:
        tuple[str, str]: (canonical_json_string, definition_hash_prefixed)
        where definition_hash_prefixed is 'sha256:<64_hex_digits>'.
    """
    semantic_obj = _clean_semantic_object(graph)
    canonical_json = json.dumps(
        semantic_obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    definition_hash = f"sha256:{digest}"
    return canonical_json, definition_hash


def compute_semantic_hash(graph: dict[str, Any]) -> str:
    """Convenience helper returning only the canonical SHA-256 hash."""
    _, definition_hash = canonicalize_graph(graph)
    return definition_hash
