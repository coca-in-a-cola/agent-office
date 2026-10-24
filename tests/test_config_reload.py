"""Tests for config_reload tool and API endpoints."""

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

from agent_office.config_reload import (
    CONFIG_RELOAD_SCHEMA,
    _file_hash,
    _mask_sensitive,
    handle_config_reload,
)


SAMPLE_CONFIG = """\
agent:
  max_turns: 12
model:
  default: gpt-4
  provider: openai
delegation:
  provider: custom:antigravity
  model: claude-opus-4
  max_iterations: 25
fallback_model:
  - model: gemini-flash
    provider: google
custom_providers:
  - api_key: sk-secret-key-12345
    name: antigravity
_config_version: 42
"""

CORRUPT_CONFIG = """\
this: is: not: valid: yaml: [
"""


class TestConfigReloadSchema(unittest.TestCase):
    """Verify the tool schema is well-formed."""

    def test_schema_has_name(self) -> None:
        self.assertEqual(CONFIG_RELOAD_SCHEMA["name"], "config_reload")

    def test_schema_has_parameters(self) -> None:
        props = CONFIG_RELOAD_SCHEMA["parameters"]["properties"]
        self.assertIn("action", props)
        self.assertIn("target", props)
        self.assertEqual(props["action"]["enum"], ["reload", "status", "preview"])
        self.assertEqual(props["target"]["enum"], ["all", "delegation", "models", "env"])


class TestMaskSensitive(unittest.TestCase):
    """Verify sensitive field masking."""

    def test_masks_api_key(self) -> None:
        data = {"api_key": "sk-12345", "name": "test"}
        result = _mask_sensitive(data)
        self.assertEqual(result["api_key"], "***")
        self.assertEqual(result["name"], "test")

    def test_masks_nested(self) -> None:
        data = {"providers": [{"api_key": "secret", "token": "tok123", "model": "gpt-4"}]}
        result = _mask_sensitive(data)
        self.assertEqual(result["providers"][0]["api_key"], "***")
        self.assertEqual(result["providers"][0]["token"], "***")
        self.assertEqual(result["providers"][0]["model"], "gpt-4")

    def test_masks_password(self) -> None:
        data = {"db_password": "hunter2"}
        result = _mask_sensitive(data)
        self.assertEqual(result["db_password"], "***")

    def test_no_mask_non_sensitive(self) -> None:
        data = {"model": "gpt-4", "provider": "openai", "max_turns": 12}
        result = _mask_sensitive(data)
        self.assertEqual(result, data)


class TestHandleConfigReload(unittest.TestCase):
    """Test the main handler with a temporary config file."""

    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp()
        self.config_path = Path(self.tmpdir) / "config.yaml"
        self.config_path.write_text(SAMPLE_CONFIG, encoding="utf-8")

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _call(self, action: str = "status", target: str = "all") -> dict[str, Any]:
        with patch("agent_office.config_reload._resolve_config_path", return_value=self.config_path), \
             patch("agent_office.config_reload._resolve_profile_dir", return_value=Path(self.tmpdir)):
            return handle_config_reload({"action": action, "target": target})

    def test_status_returns_ok(self) -> None:
        result = self._call("status")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["action"], "status")
        self.assertTrue(result["config_exists"])
        self.assertEqual(result["config_version"], 42)

    def test_status_delegation(self) -> None:
        result = self._call("status", "delegation")
        self.assertEqual(result["delegation"]["model"], "claude-opus-4")
        self.assertEqual(result["delegation"]["provider"], "custom:antigravity")
        self.assertEqual(result["delegation"]["max_iterations"], 25)

    def test_status_models(self) -> None:
        result = self._call("status", "models")
        self.assertEqual(result["models"]["default"], "gpt-4")
        self.assertEqual(result["models"]["provider"], "openai")

    def test_preview_no_prior_hash(self) -> None:
        result = self._call("preview")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["action"], "preview")
        # No prior hash → has_changes should be False
        self.assertFalse(result["has_changes"])

    def test_preview_detects_change(self) -> None:
        # First reload to set the hash
        self._call("reload")
        # Modify config
        self.config_path.write_text(SAMPLE_CONFIG.replace("42", "43"), encoding="utf-8")
        result = self._call("preview")
        self.assertTrue(result["has_changes"])

    def test_reload_returns_ok(self) -> None:
        result = self._call("reload")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["action"], "reload")
        self.assertIsNotNone(result.get("reload_ts"))
        self.assertEqual(result["config_version"], 42)

    def test_reload_delegation_masked(self) -> None:
        result = self._call("reload")
        self.assertEqual(result["delegation"]["model"], "claude-opus-4")

    def test_reload_env(self) -> None:
        env_path = Path(self.tmpdir) / ".env"
        env_path.write_text('TEST_CONFIG_RELOAD_VAR="hello"\n', encoding="utf-8")
        result = self._call("reload", "env")
        self.assertTrue(result["env_reloaded"])
        self.assertEqual(os.environ.get("TEST_CONFIG_RELOAD_VAR"), "hello")
        # Cleanup
        os.environ.pop("TEST_CONFIG_RELOAD_VAR", None)

    def test_corrupt_config_status(self) -> None:
        self.config_path.write_text(CORRUPT_CONFIG, encoding="utf-8")
        result = self._call("status")
        # Should still return ok with parse_error
        self.assertEqual(result["status"], "ok")
        self.assertIn("parse_error", result)

    def test_corrupt_config_reload(self) -> None:
        self.config_path.write_text(CORRUPT_CONFIG, encoding="utf-8")
        result = self._call("reload")
        self.assertEqual(result["status"], "error")
        self.assertIn("parse error", result.get("message", "").lower())

    def test_missing_config_reload(self) -> None:
        self.config_path.unlink()
        result = self._call("reload")
        self.assertEqual(result["status"], "error")
        self.assertIn("not found", result.get("message", "").lower())

    def test_unknown_action(self) -> None:
        result = self._call("bogus")
        self.assertEqual(result["status"], "error")
        self.assertIn("unknown action", result.get("message", ""))


class TestToolRegistration(unittest.TestCase):
    """Test that register() attempts to register the config_reload tool."""

    def test_register_tool_called(self) -> None:
        ctx = MagicMock()
        ctx.register_tool = MagicMock()
        ctx.register_delegation_route_resolver = MagicMock()

        from agent_office import register
        result = register(ctx)

        ctx.register_tool.assert_called_once()
        call_kwargs = ctx.register_tool.call_args
        # Verify it was called with config_reload name
        self.assertEqual(call_kwargs.kwargs["name"], "config_reload")
        self.assertEqual(call_kwargs.kwargs["toolset"], "agent-office")
        self.assertIn("capabilities", result)
        self.assertTrue(result["capabilities"]["config_reload_tool"])

    def test_register_without_register_tool(self) -> None:
        """When ctx lacks register_tool, tool registration is skipped gracefully."""
        ctx = MagicMock(spec=[])  # no attributes at all
        # Ensure it doesn't have register_tool or register_delegation_route_resolver
        ctx_limited = type("Ctx", (), {})()

        from agent_office import register
        # Should not raise
        result = register(ctx_limited)
        self.assertIsInstance(result, dict)


class TestFileHash(unittest.TestCase):
    def test_hash_consistency(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("test: value\n")
            f.flush()
            h1 = _file_hash(Path(f.name))
            h2 = _file_hash(Path(f.name))
            self.assertEqual(h1, h2)
            self.assertEqual(len(h1), 16)
            os.unlink(f.name)

    def test_hash_missing_file(self) -> None:
        self.assertEqual(_file_hash(Path("/nonexistent/path.yaml")), "")


if __name__ == "__main__":
    unittest.main()
