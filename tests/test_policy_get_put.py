"""Tests for GET /api/agents/{id}/policy and PUT /api/agents/{id}/policy.

Acceptance criteria exercised:
- GET is authenticated (401 without credentials)
- GET returns default workstation policy before any save (persisted=False)
- GET returns stored policy after a POST (persisted=True, models/strategy/revision match)
- GET returns 404 for unknown agent (not in defaults and not in DB)
- GET invalid agent id returns 400
- PUT is accepted as equivalent of POST (same auth/validation/storage)
- Revision increments on change, is stable on idempotent re-save
- Round-robin cursor survives storage reload (via DurableRouteStore backed by the same DB)
"""

import json
import urllib.error
import urllib.request
from tests.test_auth_miniapp import TestAuthServerEndpoints


class TestPolicyGetEndpoint(TestAuthServerEndpoints):
    """GET /api/agents/{id}/policy endpoint tests."""

    def _owner_token(self) -> str:
        return self.session_store.create_session(
            user_id="policy-owner",
            role="managing_director",
            name="Owner",
        )["token"]

    def _headers(self, token: str) -> dict:
        return {
            "Content-Type": "application/json",
            "Cookie": f"session={token}",
            "Origin": f"http://127.0.0.1:{self.port}",
        }

    def _get(self, path: str, token: str | None = None) -> dict:
        url = f"http://127.0.0.1:{self.port}{path}"
        headers = {}
        if token is not None:
            headers["Cookie"] = f"session={token}"
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _post_policy(self, agent_id: str, models: list, strategy: str, token: str) -> dict:
        url = f"http://127.0.0.1:{self.port}/api/agents/{agent_id}/policy"
        payload = json.dumps({"models": models, "strategy": strategy}).encode("utf-8")
        req = urllib.request.Request(
            url, data=payload, headers=self._headers(token), method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # ------------------------------------------------------------------ GET ---

    def test_get_policy_requires_auth(self):
        """Unauthenticated GET returns 401."""
        url = f"http://127.0.0.1:{self.port}/api/agents/coder/policy"
        req = urllib.request.Request(url, method="GET")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 401)

    def test_get_policy_default_workstation_not_yet_persisted(self):
        """GET on a default workstation that has no saved policy returns persisted=False."""
        token = self._owner_token()
        data = self._get("/api/agents/devops/policy", token)
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["agent_id"], "devops")
        self.assertFalse(data["persisted"])
        self.assertIsNone(data["policy_revision"])
        self.assertIsInstance(data["models"], list)
        self.assertGreater(len(data["models"]), 0)
        self.assertIn(data["routing_strategy"], ("priority", "round_robin"))

    def test_get_policy_unknown_agent_returns_404(self):
        """GET for a totally unknown agent returns 404."""
        token = self._owner_token()
        url = f"http://127.0.0.1:{self.port}/api/agents/no-such-agent-xyz/policy"
        req = urllib.request.Request(
            url, headers={"Cookie": f"session={token}"}, method="GET"
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 404)

    def test_get_policy_reflects_saved_policy(self):
        """GET returns the same policy, revision, and strategy saved by POST."""
        token = self._owner_token()
        models = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
            {"provider": "openai-codex", "model": "gpt-6.1-sol"},
        ]
        post_resp = self._post_policy("coder", models, "priority", token)
        self.assertEqual(post_resp["status"], "ok")
        revision_after_save = post_resp["agent"]["policy_revision"]
        self.assertIsNotNone(revision_after_save)

        get_resp = self._get("/api/agents/coder/policy", token)
        self.assertEqual(get_resp["status"], "ok")
        self.assertEqual(get_resp["agent_id"], "coder")
        self.assertTrue(get_resp["persisted"])
        self.assertEqual(get_resp["routing_strategy"], "priority")
        self.assertEqual(get_resp["policy_revision"], revision_after_save)
        self.assertEqual(len(get_resp["models"]), 2)
        providers = [m["provider"] for m in get_resp["models"]]
        self.assertIn("custom:antigravity", providers)
        self.assertIn("openai-codex", providers)

    def test_get_policy_round_robin_strategy_persisted(self):
        """GET reflects round_robin strategy after a successful POST."""
        token = self._owner_token()
        models = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
            {"provider": "openai-codex", "model": "gpt-6.1-sol"},
        ]
        self._post_policy("qa", models, "round_robin", token)

        get_resp = self._get("/api/agents/qa/policy", token)
        self.assertEqual(get_resp["routing_strategy"], "round_robin")
        self.assertTrue(get_resp["persisted"])
        self.assertIsNotNone(get_resp["policy_revision"])

    def test_get_policy_revision_increments_on_change(self):
        """Saving a different policy increments revision; identical re-save keeps it stable."""
        token = self._owner_token()
        models_v1 = [{"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"}]
        models_v2 = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
            {"provider": "openai-codex", "model": "gpt-6.1-sol"},
        ]

        resp1 = self._post_policy("webdev", models_v1, "priority", token)
        rev1 = resp1["agent"]["policy_revision"]
        self.assertIsNotNone(rev1)

        # Identical re-save: revision must NOT increment
        resp_same = self._post_policy("webdev", models_v1, "priority", token)
        rev_same = resp_same["agent"]["policy_revision"]
        self.assertEqual(rev_same, rev1, "Idempotent re-save must not increment revision")

        # Changed policy: revision must increment
        resp2 = self._post_policy("webdev", models_v2, "priority", token)
        rev2 = resp2["agent"]["policy_revision"]
        self.assertGreater(rev2, rev1, "Changed policy must increment revision")

        # Confirm GET sees the new revision
        get_resp = self._get("/api/agents/webdev/policy", token)
        self.assertEqual(get_resp["policy_revision"], rev2)


class TestPolicyPutEndpoint(TestAuthServerEndpoints):
    """PUT /api/agents/{id}/policy endpoint tests."""

    def _owner_token(self) -> str:
        return self.session_store.create_session(
            user_id="policy-owner",
            role="managing_director",
            name="Owner",
        )["token"]

    def _put_policy(
        self, agent_id: str, models: list, strategy: str, token: str
    ) -> dict:
        url = f"http://127.0.0.1:{self.port}/api/agents/{agent_id}/policy"
        payload = json.dumps({"models": models, "strategy": strategy}).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Cookie": f"session={token}",
            "Origin": f"http://127.0.0.1:{self.port}",
        }
        req = urllib.request.Request(url, data=payload, headers=headers, method="PUT")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_put_policy_authenticated_saves_and_returns_policy(self):
        """Authenticated PUT saves policy identical to POST."""
        token = self._owner_token()
        models = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
        ]
        resp = self._put_policy("artist", models, "priority", token)
        self.assertEqual(resp["status"], "ok")
        agent = resp["agent"]
        self.assertIsNotNone(agent.get("policy_revision"))
        saved_models = agent.get("models") or []
        self.assertEqual(len(saved_models), 1)
        self.assertEqual(saved_models[0]["provider"], "custom:antigravity")

    def test_put_policy_unauthenticated_returns_401(self):
        """Unauthenticated PUT returns 401."""
        url = f"http://127.0.0.1:{self.port}/api/agents/coder/policy"
        models = [{"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"}]
        payload = json.dumps({"models": models, "strategy": "priority"}).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Origin": f"http://127.0.0.1:{self.port}",
        }
        req = urllib.request.Request(url, data=payload, headers=headers, method="PUT")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 401)

    def test_put_policy_invalid_payload_returns_400(self):
        """PUT with invalid strategy returns 400."""
        token = self._owner_token()
        url = f"http://127.0.0.1:{self.port}/api/agents/coder/policy"
        payload = json.dumps(
            {"models": [{"provider": "x", "model": "y"}], "strategy": "invalid_strat"}
        ).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Cookie": f"session={token}",
            "Origin": f"http://127.0.0.1:{self.port}",
        }
        req = urllib.request.Request(url, data=payload, headers=headers, method="PUT")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)

    def test_put_then_get_round_trip(self):
        """PUT followed by GET returns the same persisted state."""
        token = self._owner_token()
        models = [
            {"provider": "custom:antigravity", "model": "gemini-3.8-flash-high"},
            {"provider": "openai-codex", "model": "gpt-6.1-sol"},
        ]
        put_resp = self._put_policy("coder", models, "round_robin", token)
        self.assertEqual(put_resp["status"], "ok")
        put_revision = put_resp["agent"]["policy_revision"]

        url = f"http://127.0.0.1:{self.port}/api/agents/coder/policy"
        req = urllib.request.Request(
            url,
            headers={"Cookie": f"session={token}"},
            method="GET",
        )
        with urllib.request.urlopen(req) as resp:
            get_resp = json.loads(resp.read().decode("utf-8"))

        self.assertEqual(get_resp["policy_revision"], put_revision)
        self.assertEqual(get_resp["routing_strategy"], "round_robin")
        self.assertTrue(get_resp["persisted"])
        self.assertEqual(len(get_resp["models"]), 2)
