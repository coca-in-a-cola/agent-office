"""Tests for the WebDev workstation, Task Bridge ingestion and the Workstation Monitor API."""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from agent_office.server import DEFAULT_WORKSTATIONS, get_office_state
from agent_office.storage import OfficeStorage


def _workstation(agent_id: str) -> dict:
    return next(ws for ws in DEFAULT_WORKSTATIONS if ws["id"] == agent_id)


class TestWorkstationRoster(unittest.TestCase):
    """WebDev joins the office and Coder specialises in Godot."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.mkdtemp()
        self.storage = OfficeStorage(db_path=Path(self.temp_dir) / "office.sqlite3")

    def tearDown(self) -> None:
        self.storage.close()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_webdev_workstation_properties(self) -> None:
        ws = _workstation("webdev")
        self.assertEqual(ws["profile_name"], "WebDev")
        self.assertEqual(ws["role"], "Web Engineer")
        self.assertEqual(ws["status"], "idle")
        self.assertEqual(ws["current_model"], "anthropic/claude-3-5-sonnet")
        self.assertEqual(ws["capabilities"], ["react", "typescript", "tailwind", "vite",
                                              "web_apis", "browser_testing", "performance"])
        self.assertEqual(ws["metadata"], {"desk": "frontend", "position": [2, 0],
                                          "avatar": "webdev"})

    def test_coder_specialises_in_godot(self) -> None:
        ws = _workstation("coder")
        self.assertEqual(ws["role"], "Game Developer (Godot)")
        self.assertEqual(ws["capabilities"], ["godot4", "gdscript", "c_sharp", "shaders",
                                              "physics", "rendering"])

    def test_webdev_listed_in_office_state(self) -> None:
        state = get_office_state(self.storage)
        agent_ids = [a["id"] for a in state["agents"]]
        self.assertIn("webdev", agent_ids)
        self.assertEqual(len(set(agent_ids)), len(agent_ids))
        positions = [tuple(ws["metadata"]["position"]) for ws in DEFAULT_WORKSTATIONS]
        self.assertEqual(len(set(positions)), len(positions), "desks must not overlap")


if __name__ == "__main__":
    unittest.main()
