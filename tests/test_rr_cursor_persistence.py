"""Verify round-robin cursor persists across DurableRouteStore re-instantiations.

This is the acceptance-critical 'cursor survives a reload' test.
Uses an on-disk SQLite temp file to prove durability across object lifecycles.
"""

import json
import os
import tempfile
import unittest

from agent_office.routing import DurableRouteStore
from agent_office.storage import OfficeStorage
from agent_office.native_reservations import NativeDispatchReservations


class TestRoundRobinCursorPersistence(unittest.TestCase):
    """Round-robin cursor must survive DurableRouteStore re-instantiation (DB reload)."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.mkdtemp()
        self._db = os.path.join(self._tmpdir, "test_routing.sqlite3")
        self._office_db = os.path.join(self._tmpdir, "test_office.sqlite3")

    def _make_store(self) -> DurableRouteStore:
        return DurableRouteStore(self._db)

    def test_cursor_survives_store_reload(self):
        """Committing a round-robin reservation advances the cursor, and that
        value is visible after creating a brand-new DurableRouteStore backed by
        the same on-disk SQLite file (simulating a process restart)."""
        policy_key = "native-admission:reload-test"
        routes = [
            {"provider": "prov-a", "model": "model-a"},
            {"provider": "prov-b", "model": "model-b"},
            {"provider": "prov-c", "model": "model-c"},
        ]

        store1 = self._make_store()
        # Cursor starts at 0
        self.assertEqual(store1.get_provider_cursor(policy_key), 0)

        # Reserve and commit first turn -> cursor advances to 1
        row = store1.reserve_round_robin(policy_key, routes, "coder")
        token = row["reservation_key"]
        self.assertEqual(int(row["route_id"]), 0)  # first route selected
        ok = store1.commit_round_robin(token, policy_key)
        self.assertTrue(ok)
        self.assertEqual(store1.get_provider_cursor(policy_key), 1)

        # Drop store1 — simulate a process restart by creating store2 from scratch
        del store1
        store2 = self._make_store()

        # store2 must see cursor=1 (not 0)
        self.assertEqual(store2.get_provider_cursor(policy_key), 1,
                         "Cursor must survive DurableRouteStore re-instantiation")

        # Reserve and commit second turn -> cursor advances to 2
        row2 = store2.reserve_round_robin(policy_key, routes, "coder")
        token2 = row2["reservation_key"]
        self.assertEqual(int(row2["route_id"]), 1)  # second route
        self.assertTrue(store2.commit_round_robin(token2, policy_key))
        self.assertEqual(store2.get_provider_cursor(policy_key), 2)

        # Drop store2 again, verify cursor=2 persisted
        del store2
        store3 = self._make_store()
        self.assertEqual(store3.get_provider_cursor(policy_key), 2)
        # Third turn picks route index 2
        row3 = store3.reserve_round_robin(policy_key, routes, "coder")
        self.assertEqual(int(row3["route_id"]), 2)

    def test_round_robin_cursor_in_reservation_cycle(self):
        """NativeDispatchReservations cursor advances correctly and persists
        across separate reservation object instances (same underlying store file)."""
        # Build a 2-entry round-robin policy
        storage = OfficeStorage(db_path=self._office_db)
        storage.register_or_update_agent(
            agent_id="webdev",
            profile_name="WebDev",
            role="Web Engineer",
            status="idle",
            current_model=None,
            last_seen_at=0,
            metadata={"policy_only": True},
        )
        models = [
            {"provider": "prov-x", "model": "model-x", "priority": 1},
            {"provider": "prov-y", "model": "model-y", "priority": 2},
        ]
        storage.set_agent_policy("webdev", models, "round_robin")

        store = DurableRouteStore(self._db)
        res1 = NativeDispatchReservations(storage, store=store)

        # First reservation: round-robin selects first route
        rv1 = res1.reserve("webdev")
        self.assertEqual(rv1["provider"], "prov-x")
        token1 = rv1["reservation_token"]
        self.assertIsNotNone(token1)

        committed1 = res1.commit("webdev", token1)
        self.assertTrue(committed1)

        # Drop reservation object, create fresh one backed by same DB files
        del res1
        store2 = DurableRouteStore(self._db)
        res2 = NativeDispatchReservations(storage, store=store2)

        # Second reservation: must select second route (cursor=1)
        rv2 = res2.reserve("webdev")
        self.assertEqual(rv2["provider"], "prov-y",
                         "Round-robin cursor must persist across object recreation")
        token2 = rv2["reservation_token"]
        self.assertTrue(res2.commit("webdev", token2))

        # Third reservation wraps around: selects first route again (cursor=2 mod 2=0)
        del res2
        store3 = DurableRouteStore(self._db)
        res3 = NativeDispatchReservations(storage, store=store3)
        rv3 = res3.reserve("webdev")
        self.assertEqual(rv3["provider"], "prov-x",
                         "Round-robin must wrap around after full rotation")


if __name__ == "__main__":
    unittest.main()
