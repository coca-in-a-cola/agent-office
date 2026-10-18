"""Unit tests verifying Agent Office hook registration, event capture, payloads, and fail-open resilience."""

from __future__ import annotations

import unittest
from typing import Any

from agent_office.events import (
    Event,
    EventDispatcher,
    EventQueue,
    EventType,
    get_default_dispatcher,
    reset_default_dispatcher,
)
from agent_office.hooks import (
    HookManager,
    after_tool_call,
    after_turn,
    before_tool_call,
    before_turn,
    get_default_hook_manager,
    session_end,
    session_start,
)
from agent_office import register


class MockHermesContext:
    """Mock Hermes PluginContext implementing register_hook."""

    def __init__(self, should_fail: bool = False) -> None:
        self.hooks: dict[str, Any] = {}
        self.should_fail = should_fail

    def register_hook(self, name: str, callback: Any) -> str:
        if self.should_fail:
            raise RuntimeError(f"Simulated failure registering hook: {name}")
        self.hooks[name] = callback
        return f"handle_{name}"


class MockAlternativeContext:
    """Mock context implementing alternative .register(name, callback) pattern."""

    def __init__(self) -> None:
        self.registry: dict[str, Any] = {}

    def register(self, name: str, callback: Any) -> str:
        self.registry[name] = callback
        return f"reg_{name}"


class TestHookRegistration(unittest.TestCase):
    """Test hook registration with various context implementations."""

    def test_register_to_hermes_context(self) -> None:
        ctx = MockHermesContext()
        handles = register(ctx)

        # Core required hooks
        required_hooks = [
            "session_start",
            "session_end",
            "before_turn",
            "after_turn",
            "before_tool_call",
            "after_tool_call",
        ]
        for hook_name in required_hooks:
            self.assertIn(hook_name, ctx.hooks)
            self.assertTrue(callable(ctx.hooks[hook_name]))
            self.assertIn(hook_name, handles)

        # Hermes canonical aliases
        hermes_aliases = [
            "on_session_start",
            "on_session_end",
            "pre_llm_call",
            "post_llm_call",
            "pre_tool_call",
            "post_tool_call",
        ]
        for alias in hermes_aliases:
            self.assertIn(alias, ctx.hooks)
            self.assertTrue(callable(ctx.hooks[alias]))

    def test_register_to_alternative_context(self) -> None:
        ctx = MockAlternativeContext()
        manager = HookManager()
        handles = manager.register_to_context(ctx)

        self.assertIn("session_start", ctx.registry)
        self.assertIn("before_tool_call", ctx.registry)
        self.assertEqual(len(handles), 12)

    def test_register_fail_open_on_context_error(self) -> None:
        ctx = MockHermesContext(should_fail=True)
        # Should not raise exception
        handles = register(ctx)
        self.assertEqual(handles, {})


class TestEventCapturePayloads(unittest.TestCase):
    """Test event capture across full, partial, and malformed payloads."""

    def setUp(self) -> None:
        self.dispatcher = EventDispatcher()
        self.manager = HookManager(dispatcher=self.dispatcher)

    def test_full_payload_session_start(self) -> None:
        payload = {
            "session_id": "ses_123",
            "agent_id": "hermes_default",
            "model": "claude-sonnet-4-6",
            "platform": "cli",
            "metadata": {"env": "prod"},
        }
        res = self.manager.session_start(**payload)
        self.assertIsNone(res)

        events = self.dispatcher.queue.peek()
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.event_type, EventType.SESSION_START.value)
        self.assertEqual(event.session_id, "ses_123")
        self.assertEqual(event.data["agent_id"], "hermes_default")
        self.assertEqual(event.data["model"], "claude-sonnet-4-6")
        self.assertIsNotNone(event.event_id)
        self.assertGreater(event.timestamp, 0)

    def test_full_payload_session_end(self) -> None:
        payload = {
            "session_id": "ses_123",
            "task_id": "task_456",
            "turn_id": "turn_789",
            "completed": True,
            "failed": False,
            "exit_reason": "stop",
            "duration": 42.5,
        }
        res = self.manager.session_end(**payload)
        self.assertIsNone(res)

        events = self.dispatcher.queue.peek()
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.event_type, EventType.SESSION_END.value)
        self.assertEqual(event.session_id, "ses_123")
        self.assertEqual(event.turn_id, "turn_789")
        self.assertTrue(event.data["completed"])
        self.assertEqual(event.data["exit_reason"], "stop")

    def test_full_payload_before_and_after_turn(self) -> None:
        before_payload = {
            "session_id": "ses_123",
            "turn_id": "turn_1",
            "user_message": "Hello agent",
            "model": "claude-sonnet-4-6",
            "platform": "desktop",
        }
        self.manager.before_turn(**before_payload)

        after_payload = {
            "session_id": "ses_123",
            "turn_id": "turn_1",
            "assistant_message": "Hello user",
            "usage": {"input_tokens": 150, "output_tokens": 40},
            "duration_ms": 1200,
        }
        self.manager.after_turn(**after_payload)

        events = self.dispatcher.queue.peek()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].event_type, EventType.BEFORE_TURN.value)
        self.assertEqual(events[0].data["user_message"], "Hello agent")
        self.assertEqual(events[1].event_type, EventType.AFTER_TURN.value)
        self.assertEqual(events[1].data["assistant_message"], "Hello user")
        self.assertEqual(events[1].data["usage"]["input_tokens"], 150)

    def test_full_payload_before_and_after_tool_call(self) -> None:
        before_payload = {
            "session_id": "ses_123",
            "turn_id": "turn_1",
            "tool_call_id": "call_abc",
            "tool_name": "terminal",
            "args": {"command": "ls -la"},
        }
        self.manager.before_tool_call(**before_payload)

        after_payload = {
            "session_id": "ses_123",
            "turn_id": "turn_1",
            "tool_call_id": "call_abc",
            "tool_name": "terminal",
            "args": {"command": "ls -la"},
            "result": "total 0",
            "duration_ms": 15,
            "error": None,
        }
        self.manager.after_tool_call(**after_payload)

        events = self.dispatcher.queue.peek()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].event_type, EventType.BEFORE_TOOL_CALL.value)
        self.assertEqual(events[0].data["tool_name"], "terminal")
        self.assertEqual(events[0].data["args"]["command"], "ls -la")

        self.assertEqual(events[1].event_type, EventType.AFTER_TOOL_CALL.value)
        self.assertEqual(events[1].data["tool_name"], "terminal")
        self.assertEqual(events[1].data["result"], "total 0")
        self.assertEqual(events[1].data["duration_ms"], 15)

    def test_partial_payloads(self) -> None:
        # Calling hooks with empty or missing fields
        self.manager.session_start()
        self.manager.session_end(session_id="ses_only")
        self.manager.before_turn(user_message="hi without session")
        self.manager.after_turn()
        self.manager.before_tool_call(tool_name="read_file")
        self.manager.after_tool_call(duration_ms=10)

        events = self.dispatcher.queue.peek()
        self.assertEqual(len(events), 6)
        self.assertIsNone(events[0].session_id)
        self.assertEqual(events[1].session_id, "ses_only")
        self.assertIsNone(events[2].session_id)
        self.assertEqual(events[2].data["user_message"], "hi without session")
        self.assertEqual(events[4].data["tool_name"], "read_file")
        self.assertEqual(events[5].data["duration_ms"], 10)

    def test_malformed_payloads(self) -> None:
        # None or non-dict passed as positional args
        self.manager.session_start(None)
        self.manager.session_start(12345)
        self.manager.session_start("arbitrary string")

        # Non-string session_id or turn_id
        self.manager.before_tool_call(session_id=99999, turn_id=False, tool_name=["not", "a", "string"])

        events = self.dispatcher.queue.peek()
        self.assertEqual(len(events), 4)
        # 99999 safely converted to "99999"
        self.assertEqual(events[3].session_id, "99999")
        self.assertEqual(events[3].turn_id, "False")
        self.assertEqual(events[3].data["tool_name"], ["not", "a", "string"])

    def test_positional_dict_payload(self) -> None:
        # Some frameworks pass single dict arg: hook(payload_dict)
        self.manager.session_start({"session_id": "ses_pos", "custom": "value"}, extra="kw")
        events = self.dispatcher.queue.peek()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].session_id, "ses_pos")
        self.assertEqual(events[0].data["custom"], "value")
        self.assertEqual(events[0].data["extra"], "kw")


class TestFailOpenResilience(unittest.TestCase):
    """Test that all hooks strictly observe the Fail-Open principle."""

    def setUp(self) -> None:
        self.dispatcher = EventDispatcher()
        self.manager = HookManager(dispatcher=self.dispatcher)

    def test_failing_listener_does_not_crash_hook(self) -> None:
        executed_second = []

        def failing_listener(event: Event) -> None:
            raise RuntimeError("Catastrophic listener failure")

        def successful_listener(event: Event) -> None:
            executed_second.append(event.event_type)

        self.dispatcher.subscribe(EventType.SESSION_START.value, failing_listener)
        self.dispatcher.subscribe(EventType.SESSION_START.value, successful_listener)

        # Hook call MUST NOT raise
        res = self.manager.session_start(session_id="ses_123")
        self.assertIsNone(res)

        # Second listener must have received event despite the first raising
        self.assertEqual(executed_second, [EventType.SESSION_START.value])

        # Event must still be in the queue
        self.assertEqual(len(self.dispatcher.queue), 1)

    def test_wildcard_listener_failure_fail_open(self) -> None:
        executed = []

        def broken_wildcard(event: Event) -> None:
            raise ValueError("Wildcard crash")

        def normal_listener(event: Event) -> None:
            executed.append(event.event_id)

        self.dispatcher.subscribe("*", broken_wildcard)
        self.dispatcher.subscribe(EventType.BEFORE_TOOL_CALL.value, normal_listener)

        res = self.manager.before_tool_call(tool_name="bash")
        self.assertIsNone(res)
        self.assertEqual(len(executed), 1)

    def test_queue_push_failure_fail_open(self) -> None:
        class BrokenQueue(EventQueue):
            def push(self, event: Event) -> bool:
                raise OSError("Disk full / memory allocation error")

        dispatcher = EventDispatcher(queue=BrokenQueue())
        manager = HookManager(dispatcher=dispatcher)

        # Must not raise
        res = manager.after_tool_call(tool_name="bash", result="ok")
        self.assertIsNone(res)

    def test_module_level_hooks_with_default_dispatcher(self) -> None:
        reset_default_dispatcher()
        d = get_default_dispatcher()

        received = []
        d.subscribe("*", lambda e: received.append(e.event_type))

        session_start(session_id="s1")
        before_turn(turn_id="t1")
        before_tool_call(tool_name="calc")
        after_tool_call(tool_name="calc", result=42)
        after_turn(turn_id="t1")
        session_end(session_id="s1")

        self.assertEqual(
            received,
            [
                "session_start",
                "before_turn",
                "before_tool_call",
                "after_tool_call",
                "after_turn",
                "session_end",
            ],
        )


class TestEventQueueAndModels(unittest.TestCase):
    """Test Event serialization and EventQueue bounded behavior."""

    def test_event_to_dict(self) -> None:
        ev = Event(
            event_type="test_event",
            session_id="ses_abc",
            turn_id="turn_xyz",
            data={"foo": "bar", "num": 123},
        )
        d = ev.to_dict()
        self.assertEqual(d["event_type"], "test_event")
        self.assertEqual(d["session_id"], "ses_abc")
        self.assertEqual(d["turn_id"], "turn_xyz")
        self.assertEqual(d["data"], {"foo": "bar", "num": 123})
        self.assertIsInstance(d["timestamp"], float)
        self.assertIsInstance(d["event_id"], str)

    def test_event_queue_bounded_drop_oldest(self) -> None:
        q = EventQueue(maxsize=3)
        ev1 = Event(event_type="e1")
        ev2 = Event(event_type="e2")
        ev3 = Event(event_type="e3")
        ev4 = Event(event_type="e4")

        q.push(ev1)
        q.push(ev2)
        q.push(ev3)
        self.assertEqual(len(q), 3)

        # Pushing 4th should drop ev1
        q.push(ev4)
        self.assertEqual(len(q), 3)
        peeked = q.peek()
        self.assertEqual([e.event_type for e in peeked], ["e2", "e3", "e4"])

        popped = q.pop()
        self.assertEqual(popped.event_type, "e2")
        self.assertEqual(len(q), 2)

        q.clear()
        self.assertEqual(len(q), 0)
        self.assertIsNone(q.pop())

    def test_unsubscribe(self) -> None:
        dispatcher = EventDispatcher()
        received = []

        def listener(ev: Event) -> None:
            received.append(ev.event_id)

        unsub = dispatcher.subscribe("test", listener)
        dispatcher.dispatch(Event(event_type="test"))
        self.assertEqual(len(received), 1)

        unsub()
        dispatcher.dispatch(Event(event_type="test"))
        self.assertEqual(len(received), 1)


if __name__ == "__main__":
    unittest.main()
