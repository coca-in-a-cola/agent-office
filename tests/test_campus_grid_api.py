import unittest
import tempfile
import shutil
from pathlib import Path
from agent_office.storage import OfficeStorage

class TestCampusGridStorage(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = Path(self.test_dir) / "test_office.sqlite3"
        self.storage = OfficeStorage(db_path=self.db_path, auto_migrate=True)

    def tearDown(self):
        self.storage.close()
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_get_empty_grid_returns_none(self):
        self.assertIsNone(self.storage.get_campus_grid())

    def test_save_and_get_grid_roundtrip(self):
        sample_layout = {
            "width": 28,
            "height": 28,
            "tiles": {
                "0,0": {"x": 0, "y": 0, "type": "floor", "propId": "cooler"}
            },
            "rooms": {}
        }
        saved = self.storage.save_campus_grid(sample_layout)
        self.assertTrue(saved)
        loaded = self.storage.get_campus_grid()
        self.assertEqual(loaded, sample_layout)

    def test_upsert_updates_layout(self):
        layout1 = {"version": 1}
        layout2 = {"version": 2}
        self.storage.save_campus_grid(layout1)
        self.assertEqual(self.storage.get_campus_grid(), layout1)
        self.storage.save_campus_grid(layout2)
        self.assertEqual(self.storage.get_campus_grid(), layout2)

if __name__ == "__main__":
    unittest.main()
