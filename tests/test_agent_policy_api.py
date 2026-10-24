import json
import urllib.error
import urllib.request
from tests.test_auth_miniapp import TestAuthServerEndpoints


class TestAgentPolicyApi(TestAuthServerEndpoints):
    def test_anonymous_and_guest_policy_write_denied(self):
        baseline = self.storage.get_agent('coder')
        valid_payload = {
            'models': [{'provider': 'custom:antigravity', 'model': 'gemini-3.8-flash-high', 'priority': 1}],
            'routing_strategy': 'priority',
        }
        data = json.dumps(valid_payload).encode('utf-8')
        url = f"http://127.0.0.1:{self.port}/api/agents/coder/policy"

        guest_token = self.session_store.create_session(
            user_id='guest',
            role='guest',
            name='Guest',
        )['token']

        cases = [
            ('anonymous', None, 401),
            ('guest', guest_token, 403),
        ]

        for role, token, expected_status in cases:
            with self.subTest(role=role):
                headers = {
                    'Content-Type': 'application/json',
                    'Origin': f"http://127.0.0.1:{self.port}",
                }
                if token is not None:
                    headers['Cookie'] = f"session={token}"

                req = urllib.request.Request(url, data=data, headers=headers, method='POST')
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(req)

                self.assertEqual(ctx.exception.code, expected_status)
                self.assertEqual(self.storage.get_agent('coder'), baseline)

    def test_invalid_policy_and_origin_leave_existing_policy_unchanged(self):
        self.storage.register_or_update_agent(
            'coder',
            last_seen_at=123,
            current_model='actual-test-model',
            metadata={'preserve': True},
        )
        baseline = [
            {'provider': 'custom:antigravity', 'model': 'gemini-3.8-flash-high', 'priority': 1}
        ]
        self.storage.set_agent_policy('coder', baseline, 'priority')
        before = self.storage.get_agent('coder')

        token = self.session_store.create_session(
            user_id='managing-director',
            role='managing_director',
            name='Director',
        )['token']
        cookie_header = f"session={token}"
        valid_origin = f"http://127.0.0.1:{self.port}"

        import copy

        valid_payload = {
            'strategy': 'priority',
            'models': [
                {'provider': 'custom:antigravity', 'model': 'gemini-3.8-flash-high', 'priority': 1}
            ],
        }

        cases = [
            ('invalidstrategy', {'strategy': 'bogus'}, None, None, 400),
            ('empty_models', {'models': []}, None, None, 400),
            (
                'duplicate_same_pair_twice',
                {
                    'models': [
                        {'provider': 'custom:antigravity', 'model': 'gemini-3.8-flash-high', 'priority': 1},
                        {'provider': 'custom:antigravity', 'model': 'gemini-3.8-flash-high', 'priority': 2},
                    ]
                },
                None,
                None,
                400,
            ),
            (
                'model_whitespace',
                {
                    'models': [
                        {'provider': 'custom:antigravity', 'model': ' ', 'priority': 1}
                    ]
                },
                None,
                None,
                400,
            ),
            ('unknownagent', {}, 'no-such-agent-test', None, 404),
            ('badOrigin', {}, None, 'https://untrusted.invalid', 403),
        ]

        for name, payload_override, target_agent, origin_override, expected_status in cases:
            with self.subTest(case=name):
                target = target_agent or 'coder'
                origin = origin_override or valid_origin
                payload = copy.deepcopy(valid_payload)
                payload.update(payload_override)

                data = json.dumps(payload).encode('utf-8')
                req = urllib.request.Request(
                    f"http://127.0.0.1:{self.port}/api/agents/{target}/policy",
                    data=data,
                    headers={
                        'Content-Type': 'application/json',
                        'Cookie': cookie_header,
                        'Origin': origin,
                    },
                    method='POST',
                )

                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(req)

                self.assertEqual(ctx.exception.code, expected_status)
                self.assertEqual(self.storage.get_agent('coder'), before)
                self.assertIsNone(self.storage.get_agent('no-such-agent-test'))

    def test_owner_save_repeat_revision_and_storage(self):
        token = self.session_store.create_session(
            user_id='policy-owner',
            role='managing_director',
            name='Owner',
        )['token']

        url = f"http://127.0.0.1:{self.port}/api/agents/coder/policy"
        headers = {
            'Content-Type': 'application/json',
            'Cookie': f'session={token}',
            'Origin': f'http://127.0.0.1:{self.port}',
        }
        payload = {
            'models': [
                {'provider': 'custom:antigravity', 'model': 'gemini-3.8-flash-high', 'priority': 99},
                {'provider': 'openai-codex', 'model': 'gpt-6.1-sol', 'priority': 99},
            ],
            'routing_strategy': 'priority',
            'strategy': 'priority',
        }
        data = json.dumps(payload).encode('utf-8')

        # First save
        req1 = urllib.request.Request(url, data=data, headers=headers, method='POST')
        with urllib.request.urlopen(req1) as resp1:
            self.assertEqual(resp1.status, 200)
            body1 = json.loads(resp1.read().decode('utf-8'))

        self.assertEqual(body1.get('status'), 'ok')
        agent1 = body1.get('agent', {})
        models1 = agent1.get('models', [])
        self.assertEqual(len(models1), 2)
        self.assertEqual(models1[0].get('priority'), 1)
        self.assertEqual(models1[1].get('priority'), 2)
        revision1 = agent1.get('policy_revision')
        self.assertIsNotNone(revision1)

        # Repeat save with exact same raw payload
        req2 = urllib.request.Request(url, data=data, headers=headers, method='POST')
        with urllib.request.urlopen(req2) as resp2:
            self.assertEqual(resp2.status, 200)
            body2 = json.loads(resp2.read().decode('utf-8'))

        self.assertEqual(body2.get('status'), 'ok')
        agent2 = body2.get('agent', {})
        self.assertEqual(agent2.get('policy_revision'), revision1)

        # Validate storage exact models, last_seen_at=0, current_model=None
        stored = self.storage.get_agent('coder')
        self.assertIsNotNone(stored)
        last_seen_at = stored.get('last_seen_at') if isinstance(stored, dict) else getattr(stored, 'last_seen_at', None)
        current_model = stored.get('current_model') if isinstance(stored, dict) else getattr(stored, 'current_model', None)
        stored_revision = stored.get('policy_revision') if isinstance(stored, dict) else getattr(stored, 'policy_revision', None)
        stored_models = stored.get('models') if isinstance(stored, dict) else getattr(stored, 'models', None)

        self.assertEqual(last_seen_at, 0)
        self.assertIsNone(current_model)
        self.assertEqual(stored_revision, revision1)
        self.assertEqual(len(stored_models), 2)
        p1 = stored_models[0].get('priority') if isinstance(stored_models[0], dict) else getattr(stored_models[0], 'priority', None)
        p2 = stored_models[1].get('priority') if isinstance(stored_models[1], dict) else getattr(stored_models[1], 'priority', None)
        self.assertEqual(p1, 1)
        self.assertEqual(p2, 2)
        m1 = stored_models[0].get('model') if isinstance(stored_models[0], dict) else getattr(stored_models[0], 'model', None)
        m2 = stored_models[1].get('model') if isinstance(stored_models[1], dict) else getattr(stored_models[1], 'model', None)
        self.assertEqual(m1, 'gemini-3.8-flash-high')
        self.assertEqual(m2, 'gpt-6.1-sol')

        # State endpoint assertions
        state_req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/state",
            headers={'Cookie': f"session={token}"},
        )
        with urllib.request.urlopen(state_req) as resp:
            self.assertEqual(resp.status, 200)
            state_data = json.loads(resp.read().decode('utf-8'))

        coder = next(a for a in state_data['agents'] if a['id'] == 'coder')
        self.assertEqual(coder.get('models'), stored_models)
        self.assertEqual(coder.get('routing_strategy'), 'priority')
        self.assertEqual(coder.get('last_seen_at'), 0)
        self.assertEqual(coder.get('current_model'), 'unknown')
        self.assertEqual(coder.get('policy_revision'), revision1)

