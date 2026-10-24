"""Provisional native routing API, NOT registered with the current Hermes SDK.

Required host handshake: reserve -> authorize primary AND every fallback ->
commit at spawn admission -> construct child once. Denial releases the token.
A failed commit requires a new reservation and fresh authorization, never reuse
an approval for a different route. Host owns spawn deduplication/reconciliation;
SQLite admission and child creation are not a distributed atomic transaction.
The current read-only resolver deliberately still rejects round_robin.
"""
from __future__ import annotations

import json
from typing import Any

from .native_policy import _resolve_native_policy
from .routing import DurableRouteStore


class NativeDispatchReservations:
    """Explicit write boundary using canonical Office DB or an injected store.

    Only a trusted host may call commit, after all admission checks succeed.
    Tokens are opaque capabilities; do not expose them to prompts or logs.
    No live telemetry fields or policy revisions are modified by this API.
    """

    def __init__(self, storage: Any, store: DurableRouteStore | None = None):
        self.storage = storage
        if store is None:
            path = getattr(storage, "db_path", None)
            if path is None or str(path) == ":memory:":
                raise ValueError("A durable Office database or explicit route store is required")
            store = DurableRouteStore(str(path))
        self.store = store

    def _policy(self, employee_id: str) -> tuple[dict[str, Any], list[dict[str, str]], str]:
        policy = _resolve_native_policy(self.storage, employee_id, allow_round_robin=True)
        selected = policy["selected_route"]
        routes = [{"provider": selected["provider"], "model": selected["model"]}]
        routes.extend(selected["fallback_providers"])
        # JSON tuple encoding avoids ambiguous identifier delimiters. Including
        # policy content defends against a malformed storage implementation that
        # changes a chain without incrementing its revision.
        key = "native-admission:" + json.dumps(
            [policy["agent_id"], policy["revision"], policy["routing_strategy"], policy["role"], routes],
            sort_keys=True, separators=(",", ":"),
        )
        return policy, routes, key

    def reserve(self, employee_id: str) -> dict[str, Any]:
        """Return a provisional route and token; never advances the cursor.

        Priority remains read-only and has no reservation token.
        """
        policy, routes, key = self._policy(employee_id)
        token = None
        if policy["routing_strategy"] == "round_robin":
            row = self.store.reserve_round_robin(key, routes, policy["role"])
            token = row["reservation_key"]
            index = int(row["route_id"])
            routes = routes[index:] + routes[:index]
        return {
            "employee_id": policy["agent_id"],
            "policy_revision": policy["revision"],
            "provider": routes[0]["provider"],
            "model": routes[0]["model"],
            "fallback_providers": routes[1:],
            "reservation_token": token,
        }

    def commit(self, employee_id: str, token: str) -> bool:
        """After host approval only. False denies spawn; reselect and reapprove.

        Revalidates current saved policy so a revision change rejects an old
        selection. Idempotent success does not authorize duplicate construction.
        Host must coordinate policy changes if they can race final admission.
        """
        policy, _, key = self._policy(employee_id)
        if policy["routing_strategy"] != "round_robin":
            return False
        return self.store.commit_round_robin(token, key)

    def release(self, token: str) -> bool:
        """Host denial/cancellation: leave the next admitted turn unchanged."""
        return self.store.release_round_robin(token)
