"""Hook implementations capturing session lifecycle and tool calls for Agent Office.

All hooks strictly adhere to the Fail-Open principle: defensive boundaries ensure
telemetry or queue/listener errors never raise or disrupt agent execution.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Mapping, Optional, Union

from .events import Event, EventDispatcher, EventType, get_default_dispatcher

logger = logging.getLogger("agent_office.hooks")


def _safe_str(val: Any) -> Optional[str]:
    """Safely convert value to string or None."""
    if val is None:
        return None
    try:
        return str(val)
    except Exception:
        return None


def _extract_session_id(payload: Mapping[str, Any] | Any) -> Optional[str]:
    """Safely extract session_id from payload."""
    if not isinstance(payload, dict):
        return None
    val = payload.get("session_id")
    if val is None:
        val = payload.get("session_key")
    return _safe_str(val)


def _extract_turn_id(payload: Mapping[str, Any] | Any) -> Optional[str]:
    """Safely extract turn_id or task_id from payload."""
    if not isinstance(payload, dict):
        return None
    val = payload.get("turn_id")
    if val is None:
        val = payload.get("task_id")
    return _safe_str(val)


class HookManager:
    """Manages Agent Office lifecycle and tool hooks with fail-open dispatch."""

    def __init__(self, dispatcher: Optional[EventDispatcher] = None) -> None:
        self._dispatcher = dispatcher

    @property
    def dispatcher(self) -> EventDispatcher:
        if self._dispatcher is not None:
            return self._dispatcher
        return get_default_dispatcher()

    def session_start(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        """Capture session start lifecycle event. Fail-open."""
        try:
            payload = dict(kwargs)
            if args and isinstance(args[0], dict):
                payload = {**args[0], **payload}
            session_id = _extract_session_id(payload)
            turn_id = _extract_turn_id(payload)

            event = Event(
                event_type=EventType.SESSION_START.value,
                session_id=session_id,
                turn_id=turn_id,
                data=payload,
            )
            self.dispatcher.dispatch(event)
        except Exception as exc:
            logger.warning("Agent Office: session_start hook exception (fail-open): %s", exc)
        return None

    def session_end(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        """Capture session end lifecycle event. Fail-open."""
        try:
            payload = dict(kwargs)
            if args and isinstance(args[0], dict):
                payload = {**args[0], **payload}
            session_id = _extract_session_id(payload)
            turn_id = _extract_turn_id(payload)

            event = Event(
                event_type=EventType.SESSION_END.value,
                session_id=session_id,
                turn_id=turn_id,
                data=payload,
            )
            self.dispatcher.dispatch(event)
        except Exception as exc:
            logger.warning("Agent Office: session_end hook exception (fail-open): %s", exc)
        return None

    def before_turn(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        """Capture turn start / pre-LLM call event. Fail-open."""
        try:
            payload = dict(kwargs)
            if args and isinstance(args[0], dict):
                payload = {**args[0], **payload}
            session_id = _extract_session_id(payload)
            turn_id = _extract_turn_id(payload)

            event = Event(
                event_type=EventType.BEFORE_TURN.value,
                session_id=session_id,
                turn_id=turn_id,
                data=payload,
            )
            self.dispatcher.dispatch(event)
        except Exception as exc:
            logger.warning("Agent Office: before_turn hook exception (fail-open): %s", exc)
        return None

    def after_turn(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        """Capture turn completion / post-LLM call event. Fail-open."""
        try:
            payload = dict(kwargs)
            if args and isinstance(args[0], dict):
                payload = {**args[0], **payload}
            session_id = _extract_session_id(payload)
            turn_id = _extract_turn_id(payload)

            event = Event(
                event_type=EventType.AFTER_TURN.value,
                session_id=session_id,
                turn_id=turn_id,
                data=payload,
            )
            self.dispatcher.dispatch(event)
        except Exception as exc:
            logger.warning("Agent Office: after_turn hook exception (fail-open): %s", exc)
        return None

    def before_tool_call(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        """Capture pre-tool invocation event. Fail-open."""
        try:
            payload = dict(kwargs)
            if args and isinstance(args[0], dict):
                payload = {**args[0], **payload}
            session_id = _extract_session_id(payload)
            turn_id = _extract_turn_id(payload)

            event = Event(
                event_type=EventType.BEFORE_TOOL_CALL.value,
                session_id=session_id,
                turn_id=turn_id,
                data=payload,
            )
            self.dispatcher.dispatch(event)
        except Exception as exc:
            logger.warning("Agent Office: before_tool_call hook exception (fail-open): %s", exc)
        return None

    def after_tool_call(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        """Capture post-tool invocation event. Fail-open."""
        try:
            payload = dict(kwargs)
            if args and isinstance(args[0], dict):
                payload = {**args[0], **payload}
            session_id = _extract_session_id(payload)
            turn_id = _extract_turn_id(payload)

            event = Event(
                event_type=EventType.AFTER_TOOL_CALL.value,
                session_id=session_id,
                turn_id=turn_id,
                data=payload,
            )
            self.dispatcher.dispatch(event)
        except Exception as exc:
            logger.warning("Agent Office: after_tool_call hook exception (fail-open): %s", exc)
        return None

    # Aliases for Hermes canonical hook names
    def on_session_start(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        return self.session_start(*args, **kwargs)

    def on_session_end(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        return self.session_end(*args, **kwargs)

    def pre_llm_call(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        return self.before_turn(*args, **kwargs)

    def post_llm_call(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        return self.after_turn(*args, **kwargs)

    def pre_tool_call(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        return self.before_tool_call(*args, **kwargs)

    def post_tool_call(self, *args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
        return self.after_tool_call(*args, **kwargs)

    def register_to_context(self, ctx: Any) -> dict[str, Any]:
        """Register all hooks with a Hermes PluginContext or duck-typed registry.

        Registers both direct names and Hermes canonical hook names.
        """
        registered: dict[str, Any] = {}
        hook_bindings = [
            ("session_start", self.session_start),
            ("session_end", self.session_end),
            ("before_turn", self.before_turn),
            ("after_turn", self.after_turn),
            ("before_tool_call", self.before_tool_call),
            ("after_tool_call", self.after_tool_call),
            # Hermes canonical lifecycle and tool hooks
            ("on_session_start", self.on_session_start),
            ("on_session_end", self.on_session_end),
            ("pre_llm_call", self.pre_llm_call),
            ("post_llm_call", self.post_llm_call),
            ("pre_tool_call", self.pre_tool_call),
            ("post_tool_call", self.post_tool_call),
        ]

        for name, callback in hook_bindings:
            try:
                if hasattr(ctx, "register_hook"):
                    handle = ctx.register_hook(name, callback)
                    registered[name] = handle
                elif hasattr(ctx, "register"):
                    handle = ctx.register(name, callback)
                    registered[name] = handle
            except Exception as exc:
                logger.warning("Agent Office: Failed registering hook %s with ctx: %s", name, exc)

        return registered


# Shared global hook manager instance
_GLOBAL_HOOK_MANAGER: Optional[HookManager] = None


def get_default_hook_manager() -> HookManager:
    """Return the shared global HookManager instance."""
    global _GLOBAL_HOOK_MANAGER
    if _GLOBAL_HOOK_MANAGER is None:
        _GLOBAL_HOOK_MANAGER = HookManager()
    return _GLOBAL_HOOK_MANAGER


# Module-level hook functions delegating to the default HookManager
def session_start(*args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
    return get_default_hook_manager().session_start(*args, **kwargs)


def session_end(*args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
    return get_default_hook_manager().session_end(*args, **kwargs)


def before_turn(*args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
    return get_default_hook_manager().before_turn(*args, **kwargs)


def after_turn(*args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
    return get_default_hook_manager().after_turn(*args, **kwargs)


def before_tool_call(*args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
    return get_default_hook_manager().before_tool_call(*args, **kwargs)


def after_tool_call(*args: Any, **kwargs: Any) -> Optional[dict[str, Any]]:
    return get_default_hook_manager().after_tool_call(*args, **kwargs)


# Hermes canonical aliases
on_session_start = session_start
on_session_end = session_end
pre_llm_call = before_turn
post_llm_call = after_turn
pre_tool_call = before_tool_call
post_tool_call = after_tool_call
