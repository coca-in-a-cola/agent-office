"""Hot config reload tool for Hermes Agent.

Provides status inspection, preview diffing, and live reload of the active
Hermes profile configuration — usable as both a Hermes tool and an Agent
Office API backend.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("agent_office.config_reload")

# ── Tool schema (Hermes tool registration) ────────────────────────────

CONFIG_RELOAD_SCHEMA: dict[str, Any] = {
    "name": "config_reload",
    "description": (
        "Hot-reload the active Hermes profile configuration. "
        "Actions: 'status' shows current settings, 'preview' diffs disk vs memory, "
        "'reload' applies changes live."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["reload", "status", "preview"],
                "default": "reload",
                "description": "Action to perform.",
            },
            "target": {
                "type": "string",
                "enum": ["all", "delegation", "models", "env"],
                "default": "all",
                "description": "Which config section to inspect or reload.",
            },
        },
        "required": [],
    },
}

# ── Internal state ────────────────────────────────────────────────────

_last_reload_ts: float = 0.0
_last_config_hash: str = ""

SENSITIVE_KEYS = {"key", "secret", "token", "password", "api_key"}


def _is_sensitive(key: str) -> bool:
    """Check if a key name indicates a sensitive value."""
    lower = key.lower()
    return any(s in lower for s in SENSITIVE_KEYS)


def _mask_sensitive(data: Any, _depth: int = 0) -> Any:
    """Recursively mask values whose keys look sensitive."""
    if _depth > 20:
        return data
    if isinstance(data, dict):
        return {
            k: "***" if _is_sensitive(k) and isinstance(v, str) else _mask_sensitive(v, _depth + 1)
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [_mask_sensitive(item, _depth + 1) for item in data]
    return data


def _resolve_profile_dir() -> Path:
    """Resolve the active Hermes profile directory."""
    hermes_home = os.environ.get("HERMES_HOME")
    if hermes_home:
        p = Path(hermes_home)
        if p.is_dir():
            return p

    # Check active profile via HERMES_PROFILE env
    profile = os.environ.get("HERMES_PROFILE", "tyler")
    candidate = Path.home() / ".hermes" / "profiles" / profile
    if candidate.is_dir():
        return candidate

    # Fallback to default hermes home
    default = Path.home() / ".hermes"
    if default.is_dir():
        return default

    return candidate  # return expected path even if missing


def _resolve_config_path() -> Path:
    """Find the config.yaml for the active profile."""
    return _resolve_profile_dir() / "config.yaml"


def _read_config_yaml(config_path: Path) -> dict[str, Any]:
    """Read and parse config YAML. Raises on corrupt file."""
    import yaml  # lazy import — yaml may not be in every runtime

    text = config_path.read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError(f"config root is {type(data).__name__}, expected mapping")
    return data


def _file_hash(path: Path) -> str:
    """SHA-256 of file contents, empty string if unreadable."""
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    except Exception:
        return ""


def _file_mtime(path: Path) -> Optional[float]:
    try:
        return path.stat().st_mtime
    except Exception:
        return None


def _extract_delegation(cfg: dict[str, Any]) -> dict[str, Any]:
    d = cfg.get("delegation", {})
    return {
        "model": d.get("model"),
        "provider": d.get("provider"),
        "max_iterations": d.get("max_iterations"),
    }


def _extract_models(cfg: dict[str, Any]) -> dict[str, Any]:
    m = cfg.get("model", {})
    fb = cfg.get("fallback_model")
    return {
        "default": m.get("default") if isinstance(m, dict) else m,
        "provider": m.get("provider") if isinstance(m, dict) else None,
        "fallback_model": fb,
    }


_RESTART_KEYS = {"platform", "platforms", "telegram", "bot_token", "stt", "port", "host"}


def _needs_restart(old: dict[str, Any], new: dict[str, Any]) -> bool:
    """Check if any changed keys require a supervisor restart."""
    for key in _RESTART_KEYS:
        if old.get(key) != new.get(key):
            return True
    return False


# ── Main handler ──────────────────────────────────────────────────────

def handle_config_reload(
    args: dict[str, Any],
    session_id: Optional[str] = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Execute config_reload tool action. Never raises unhandled exceptions."""
    global _last_reload_ts, _last_config_hash

    action = args.get("action", "reload")
    target = args.get("target", "all")

    try:
        config_path = _resolve_config_path()
        profile_dir = _resolve_profile_dir()
        profile_name = profile_dir.name if profile_dir.name != ".hermes" else "default"

        if action == "status":
            return _handle_status(config_path, profile_name, profile_dir, target)
        elif action == "preview":
            return _handle_preview(config_path, profile_name, target)
        elif action == "reload":
            return _handle_reload(config_path, profile_name, profile_dir, target)
        else:
            return {"status": "error", "message": f"unknown action: {action!r}"}

    except Exception as exc:
        logger.exception("config_reload failed: %s", exc)
        return {
            "status": "error",
            "message": str(exc),
            "action": action,
            "target": target,
        }


def _handle_status(
    config_path: Path,
    profile_name: str,
    profile_dir: Path,
    target: str,
) -> dict[str, Any]:
    """Return current config status."""
    global _last_reload_ts

    result: dict[str, Any] = {
        "status": "ok",
        "action": "status",
        "profile": profile_name,
        "config_path": str(config_path),
        "config_exists": config_path.is_file(),
        "config_mtime": _file_mtime(config_path),
        "last_reload_ts": _last_reload_ts or None,
    }

    if config_path.is_file():
        try:
            cfg = _read_config_yaml(config_path)
            if target in ("all", "delegation"):
                result["delegation"] = _extract_delegation(cfg)
            if target in ("all", "models"):
                result["models"] = _extract_models(cfg)
            if target in ("all", "env"):
                env_path = profile_dir / ".env"
                result["env_file"] = str(env_path) if env_path.is_file() else None
            result["config_version"] = cfg.get("_config_version")
        except Exception as exc:
            result["parse_error"] = str(exc)

    return result


def _handle_preview(
    config_path: Path,
    profile_name: str,
    target: str,
) -> dict[str, Any]:
    """Check for differences between disk config and cached state."""
    global _last_config_hash

    result: dict[str, Any] = {
        "status": "ok",
        "action": "preview",
        "profile": profile_name,
        "config_path": str(config_path),
    }

    if not config_path.is_file():
        result["has_changes"] = False
        result["message"] = "config file does not exist"
        return result

    current_hash = _file_hash(config_path)
    result["has_changes"] = bool(_last_config_hash and current_hash != _last_config_hash)
    result["disk_hash"] = current_hash
    result["cached_hash"] = _last_config_hash or None

    try:
        cfg = _read_config_yaml(config_path)
        masked = _mask_sensitive(cfg)
        sections: dict[str, Any] = {}
        if target in ("all", "delegation"):
            sections["delegation"] = _extract_delegation(masked)
        if target in ("all", "models"):
            sections["models"] = _extract_models(masked)
        if target in ("all", "env"):
            sections["env_vars"] = {
                k: "***" for k in sorted(os.environ)
                if k.startswith("HERMES_") or k.startswith("AGENT_OFFICE_")
            }
        result["disk_config"] = sections
    except Exception as exc:
        result["parse_error"] = str(exc)

    return result


def _handle_reload(
    config_path: Path,
    profile_name: str,
    profile_dir: Path,
    target: str,
) -> dict[str, Any]:
    """Reload config from disk."""
    global _last_reload_ts, _last_config_hash

    result: dict[str, Any] = {
        "status": "ok",
        "action": "reload",
        "profile": profile_name,
        "config_path": str(config_path),
        "changes": [],
    }

    if not config_path.is_file():
        result["status"] = "error"
        result["message"] = f"config file not found: {config_path}"
        return result

    # Read new config
    try:
        new_cfg = _read_config_yaml(config_path)
    except Exception as exc:
        result["status"] = "error"
        result["message"] = f"config parse error: {exc}"
        return result

    old_hash = _last_config_hash
    new_hash = _file_hash(config_path)

    # Invalidate Hermes in-memory config cache
    hermes_cache_cleared = False
    try:
        import sys
        hermes_config_mod = sys.modules.get("hermes_cli.config")
        if hermes_config_mod is not None:
            cache = getattr(hermes_config_mod, "_LOAD_CONFIG_CACHE", None)
            if cache is not None and isinstance(cache, dict):
                cache.clear()
                hermes_cache_cleared = True
                result["changes"].append("hermes_config_cache_cleared")
    except Exception as exc:
        logger.debug("Could not clear Hermes config cache: %s", exc)

    # Reload .env if present and target includes env
    env_reloaded = False
    if target in ("all", "env"):
        env_path = profile_dir / ".env"
        if env_path.is_file():
            try:
                _load_dotenv(env_path)
                env_reloaded = True
                result["changes"].append("env_reloaded")
            except Exception as exc:
                logger.warning("Failed to reload .env: %s", exc)
                result["changes"].append(f"env_reload_failed: {exc}")

    # Detect restart-required changes
    restart_required = False
    if old_hash and old_hash != new_hash:
        try:
            # We don't have the old parsed config in memory, so check known restart keys
            # against a simple heuristic: if any restart-key section changed, flag it.
            restart_required = True  # conservative: flag if hash changed
            result["changes"].append("config_hash_changed")
        except Exception:
            pass

    # Update internal state
    _last_reload_ts = time.time()
    _last_config_hash = new_hash

    # Return effective settings (masked)
    masked_cfg = _mask_sensitive(new_cfg)
    if target in ("all", "delegation"):
        result["delegation"] = _extract_delegation(masked_cfg)
    if target in ("all", "models"):
        result["models"] = _extract_models(masked_cfg)

    result["hermes_cache_cleared"] = hermes_cache_cleared
    result["env_reloaded"] = env_reloaded
    result["restart_required"] = restart_required
    result["config_version"] = new_cfg.get("_config_version")
    result["reload_ts"] = _last_reload_ts

    return result


def _load_dotenv(env_path: Path) -> None:
    """Load a .env file into os.environ (simple key=value parser)."""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # Strip surrounding quotes
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        if key:
            os.environ[key] = value
