"""Offline durable admission tests; no host/SDK/live provider claims."""
import concurrent.futures
from collections import Counter
import os
import sqlite3
import tempfile
import threading
import unittest

from agent_office.delegation_plugin import OfficeRouteResolutionError, make_office_route_resolver
from agent_office.native_policy import NativePolicyError, resolve_native_delegation_policy
from agent_office.native_reservations import NativeDispatchReservations
from agent_office.routing import DurableRouteStore
from agent_office.storage import OfficeStorage


ROUTES = [{"provider": "vendor", "model": model} for model in ("Alpha", "Beta", "Gamma")]


class TestNativeReservations(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "office.sqlite3")
        self.storage = OfficeStorage(self.path)
        self.addCleanup(self.storage.close)
        self.storage.register_or_update_agent("coder", role="coder", last_seen_at=0)
        self.storage.set_agent_policy("coder", ROUTES, "round_robin")
        self.api = NativeDispatchReservations(self.storage)

    def admit(self, api=None):
        api = api or self.api
        selection = api.reserve("coder")
        self.assertTrue(api.commit("coder", selection["reservation_token"]))
        return selection

    def test_first_rotation_cyclic_fallbacks_and_restart(self):
        first = self.admit()
        self.assertEqual(first["model"], "Alpha")
        self.assertEqual(first["fallback_providers"], ROUTES[1:])
        # Fresh OfficeStorage and route-store connections on the same DB.
        reopened = OfficeStorage(self.path)
        self.addCleanup(reopened.close)
        api = NativeDispatchReservations(reopened)
        second = self.admit(api)
        self.assertEqual(second["model"], "Beta")
        self.assertEqual(second["fallback_providers"], [ROUTES[2], ROUTES[0]])
        self.assertEqual(self.admit(api)["model"], "Gamma")
        self.assertEqual(self.admit(api)["model"], "Alpha")

    def test_pending_survives_reopen_and_commit_is_idempotent(self):
        selection = self.api.reserve("coder")
        token = selection["reservation_token"]
        api = NativeDispatchReservations(self.storage, DurableRouteStore(self.path))
        self.assertTrue(api.commit("coder", token))
        self.assertTrue(api.commit("coder", token))
        self.assertFalse(api.release(token))
        self.assertEqual(api.reserve("coder")["model"], "Beta")

    def test_cancel_host_denial_and_abandon_do_not_consume(self):
        abandoned = self.api.reserve("coder")
        denied = self.api.reserve("coder")
        self.assertTrue(self.api.release(denied["reservation_token"]))
        self.assertFalse(self.api.release(denied["reservation_token"]))
        self.assertFalse(self.api.commit("coder", denied["reservation_token"]))
        self.assertEqual(self.admit()["model"], "Alpha")
        self.assertFalse(self.api.commit("coder", abandoned["reservation_token"]))
        self.assertEqual(self.admit()["model"], "Beta")
        self.assertFalse(self.api.commit("coder", "missing-token"))

    def test_noop_revision_keeps_cursor_changed_revision_starts_first(self):
        self.admit()
        before = self.storage.get_agent("coder")
        pending = self.api.reserve("coder")
        self.storage.set_agent_policy("coder", ROUTES, "round_robin")
        self.assertEqual(before, self.storage.get_agent("coder"))
        self.assertTrue(self.api.commit("coder", pending["reservation_token"]))
        self.assertEqual(self.admit()["model"], "Gamma")
        pending = self.api.reserve("coder")
        self.storage.set_agent_policy("coder", [ROUTES[2], ROUTES[0], ROUTES[1]], "round_robin")
        self.assertFalse(self.api.commit("coder", pending["reservation_token"]))
        self.assertEqual(self.admit()["model"], "Gamma")

    def test_no_preview_writes_live_fields_unchanged_and_missing_fail_closed(self):
        before = self.storage.get_agent("coder")
        with sqlite3.connect(self.path) as conn:
            changes = conn.execute("SELECT count(*) FROM route_reservations").fetchone()[0]
        for _ in range(3):
            with self.assertRaises(NativePolicyError):
                resolve_native_delegation_policy(self.storage, "coder")
            request = type("Request", (), {"employee_id": "coder"})()
            with self.assertRaises(OfficeRouteResolutionError):
                make_office_route_resolver(self.storage)(request)
        with sqlite3.connect(self.path) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM route_reservations").fetchone()[0], changes)
        self.admit()
        self.api.reserve("coder")
        self.assertEqual(before, self.storage.get_agent("coder"))
        self.assertEqual(before["last_seen_at"], 0)
        with self.assertRaises(NativePolicyError):
            self.api.reserve("absent")
        with self.assertRaises(NativePolicyError):
            self.api.commit("absent", "missing-token")

    def test_invalid_policies_fail_closed_without_reservations(self):
        for models, strategy in (([], "round_robin"),
                                 ([{"provider": "vendor", "model": "Alpha", "api_key": "forbidden"}], "round_robin"),
                                 (ROUTES, "unrecognized")):
            self.storage.set_agent_policy("coder", models, strategy)
            with self.assertRaises(NativePolicyError):
                self.api.reserve("coder")
        with sqlite3.connect(self.path) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM route_reservations").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM provider_cursors").fetchone()[0], 0)

    def test_priority_has_no_reservation_and_is_unchanged(self):
        self.storage.set_agent_policy("coder", ROUTES, "priority")
        for _ in range(3):
            selected = self.api.reserve("coder")
            self.assertIsNone(selected["reservation_token"])
            self.assertEqual(selected["model"], "Alpha")
            self.assertEqual(selected["fallback_providers"], ROUTES[1:])
        with sqlite3.connect(self.path) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM route_reservations").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM provider_cursors").fetchone()[0], 0)

    def test_optimistic_commit_rejects_stale_even_after_full_rotation(self):
        old = self.api.reserve("coder")
        for _ in range(3):
            self.admit()
        self.assertFalse(self.api.commit("coder", old["reservation_token"]))
        self.assertEqual(self.admit()["model"], "Alpha")

    def test_concurrent_independent_stores_exactly_once_per_admission(self):
        barrier = threading.Barrier(6)

        def worker(_):
            storage = OfficeStorage(self.path)
            try:
                api = NativeDispatchReservations(storage)
                initial = api.reserve("coder")
                barrier.wait(timeout=15)
                models = []
                selection = initial
                for _ in range(5):
                    for attempt in range(200):
                        # Simulated host approval of THIS exact cyclic chain.
                        if api.commit("coder", selection["reservation_token"]):
                            models.append(selection["model"])
                            break
                        api.release(selection["reservation_token"])
                        selection = api.reserve("coder")
                    else:
                        raise AssertionError("retry budget exhausted")
                    selection = api.reserve("coder")
                api.release(selection["reservation_token"])
                return models
            finally:
                storage.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            models = [model for result in pool.map(worker, range(6)) for model in result]
        self.assertEqual(Counter(models), {"Alpha": 10, "Beta": 10, "Gamma": 10})
        with sqlite3.connect(self.path) as conn:
            self.assertEqual(conn.execute("SELECT cursor FROM provider_cursors").fetchone()[0], 30)
            self.assertEqual(conn.execute("SELECT count(*) FROM route_reservations WHERE reservation_state = 'committed'").fetchone()[0], 30)


class TestRouteStoreTransactions(unittest.TestCase):
    def test_upgrade_existing_reservations_preserves_legacy_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "legacy.sqlite3")
            with sqlite3.connect(path) as conn:
                conn.execute("""CREATE TABLE route_reservations (
                    reservation_key TEXT PRIMARY KEY, run_id TEXT, activation_id TEXT,
                    attempt_no INTEGER, route_id TEXT NOT NULL, provider TEXT NOT NULL,
                    requested_model TEXT NOT NULL, executor TEXT NOT NULL, role TEXT NOT NULL,
                    policy_id TEXT, created_at TEXT NOT NULL)""")
                conn.execute("""INSERT INTO route_reservations VALUES
                    ('legacy-token', 'run', 'activation', 1, 'route', 'vendor',
                     'Alpha', 'native', 'coder', 'legacy-policy', 'timestamp')""")
            store = DurableRouteStore(path)
            legacy = store.get_reservation("legacy-token")
            assert legacy is not None
            self.assertEqual(legacy["run_id"], "run")
            self.assertIsNone(legacy["reservation_state"])
            self.assertFalse(store.commit_round_robin("legacy-token", "legacy-policy"))
            row = store.reserve_round_robin("new-policy", ROUTES, "coder")
            self.assertTrue(store.commit_round_robin(row["reservation_key"], "new-policy"))
            self.assertEqual(DurableRouteStore(path).get_provider_cursor("new-policy"), 1)

    def test_independent_instances_initialize_and_advance_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "runtime.sqlite3")
            barrier = threading.Barrier(8)

            def worker(_):
                barrier.wait(timeout=15)
                store = DurableRouteStore(path)
                return [store.advance_cursor_atomic("legacy", 3) for _ in range(15)]

            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                selected = [item for result in pool.map(worker, range(8)) for item in result]
            self.assertEqual(Counter(selected), {0: 40, 1: 40, 2: 40})

    def test_explicit_store_required_for_memory_and_policy_key_binding(self):
        storage = OfficeStorage(":memory:")
        self.addCleanup(storage.close)
        with self.assertRaises(ValueError):
            NativeDispatchReservations(storage)
        store = DurableRouteStore(":memory:")
        row = store.reserve_round_robin("revision-one", ROUTES, "coder")
        self.assertFalse(store.commit_round_robin(row["reservation_key"], "revision-two"))
        self.assertEqual(store.get_provider_cursor("revision-one"), 0)
        self.assertTrue(store.commit_round_robin(row["reservation_key"], "revision-one"))


if __name__ == "__main__":
    unittest.main()
