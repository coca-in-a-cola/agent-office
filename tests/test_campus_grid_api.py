import unittest
import tempfile
import shutil
import json
import time
import threading
import urllib.request
import urllib.error
from pathlib import Path
from agent_office.storage import OfficeStorage
from agent_office.server import create_server

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
            "schemaVersion": 2,
            "width": 28,
            "height": 28,
            "tiles": {
                "0,0": {"x": 0, "y": 0, "type": "floor", "propId": "cooler"}
            },
            "rooms": {},
            "furniture": [],
        }
        saved = self.storage.save_campus_grid(sample_layout)
        self.assertTrue(saved)
        loaded = self.storage.get_campus_grid()
        self.assertEqual(loaded, sample_layout)

    def test_upsert_updates_layout(self):
        layout1 = {"version": 1, "schemaVersion": 2, "furniture": []}
        layout2 = {"version": 2, "schemaVersion": 2, "furniture": []}
        self.storage.save_campus_grid(layout1)
        self.assertEqual(self.storage.get_campus_grid(), layout1)
        self.storage.save_campus_grid(layout2)
        self.assertEqual(self.storage.get_campus_grid(), layout2)

    def test_v1_to_v2_transparent_migration(self):
        legacy_v1 = {
            "width": 28,
            "height": 28,
            "tiles": {"0,0": {"x": 0, "y": 0, "type": "floor"}},
            "rooms": {}
        }
        # Save raw V1 directly into db to simulate legacy record
        now = 123456.0
        with self.storage._lock:
            conn = self.storage.get_connection()
            import json
            conn.execute(
                "INSERT INTO campus_grid (id, layout_json, updated_at) VALUES (?, ?, ?);",
                ("default", json.dumps(legacy_v1), now)
            )
        loaded = self.storage.get_campus_grid()
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.get("schemaVersion"), 2)
        self.assertEqual(loaded.get("furniture"), [])
        self.assertEqual(loaded.get("width"), 28)

    def test_save_v2_furniture_array(self):
        v2_data = {
            "schemaVersion": 2,
            "width": 8,
            "height": 8,
            "furniture": [
                {"id": "furn_1", "defId": "desk_wood", "gx": 3, "gy": 3, "rotation": 0}
            ]
        }
        self.assertTrue(self.storage.save_campus_grid(v2_data))
        loaded = self.storage.get_campus_grid()
        self.assertEqual(loaded.get("schemaVersion"), 2)
        self.assertEqual(len(loaded.get("furniture", [])), 1)
        self.assertEqual(loaded["furniture"][0]["defId"], "desk_wood")

    def test_rejects_non_dict_payload(self):
        self.assertFalse(self.storage.save_campus_grid("invalid string"))
        self.assertFalse(self.storage.save_campus_grid([1, 2, 3]))


class TestCampusGridApiEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = Path(cls.temp_dir) / "server_test.sqlite3"
        cls.storage = OfficeStorage(db_path=cls.db_path)
        cls.static_dir = Path(cls.temp_dir) / "static"
        cls.static_dir.mkdir(parents=True, exist_ok=True)
        (cls.static_dir / "index.html").write_text("<!DOCTYPE html><html><body>Test</body></html>")
        cls.server = create_server(
            host="127.0.0.1",
            port=0,
            storage=cls.storage,
            static_dir=cls.static_dir,
        )
        cls.port = cls.server.server_address[1]
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.storage.close()
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def test_post_grid_object_and_get(self):
        url = f"http://127.0.0.1:{self.port}/api/office/grid"
        payload = {"width": 10, "height": 10, "tiles": {}}
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data.get("status"), "ok")
            self.assertTrue(data.get("saved"))

        # GET to verify
        req_get = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req_get, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data.get("status"), "ok")
            grid = data.get("grid")
            self.assertEqual(grid.get("schemaVersion"), 2)
            self.assertEqual(grid.get("furniture"), [])

    def test_post_grid_wrapped_object(self):
        url = f"http://127.0.0.1:{self.port}/api/office/grid"
        payload = {"grid": {"width": 12, "height": 12, "furniture": [{"id": "f1"}]}}
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data.get("status"), "ok")
            self.assertTrue(data.get("saved"))

    def test_post_grid_invalid_non_dict_rejected(self):
        url = f"http://127.0.0.1:{self.port}/api/office/grid"
        payload = ["invalid", "list"]
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(ctx.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
