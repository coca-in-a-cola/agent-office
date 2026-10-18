"""Agent Office Plugin for Hermes.

Provides telemetry and event hook ingestion capturing session lifecycle and tool calls.
"""

from __future__ import annotations

from typing import Any

from .events import (
    Event,
    EventDispatcher,
    EventQueue,
    EventType,
    get_default_dispatcher,
    reset_default_dispatcher,
)
from .hooks import (
    HookManager,
    after_tool_call,
    after_turn,
    before_tool_call,
    before_turn,
    get_default_hook_manager,
    on_session_end,
    on_session_start,
    post_llm_call,
    post_tool_call,
    pre_llm_call,
    pre_tool_call,
    session_end,
    session_start,
)
from .storage import (
    EventSink,
    OfficeStorage,
    get_default_db_path,
    get_default_sink,
    get_default_storage,
    reset_default_storage,
)

__version__ = "0.1.0"
__all__ = [
    "Event",
    "EventType",
    "EventQueue",
    "EventDispatcher",
    "get_default_dispatcher",
    "reset_default_dispatcher",
    "HookManager",
    "get_default_hook_manager",
    "session_start",
    "session_end",
    "before_turn",
    "after_turn",
    "before_tool_call",
    "after_tool_call",
    "on_session_start",
    "on_session_end",
    "pre_llm_call",
    "post_llm_call",
    "pre_tool_call",
    "post_tool_call",
    "OfficeStorage",
    "EventSink",
    "get_default_db_path",
    "get_default_storage",
    "reset_default_storage",
    "get_default_sink",
    "register",
]


def register(ctx: Any) -> dict[str, Any]:
    """Hermes plugin entry point. Registers all lifecycle and tool hooks with the context

    and ensures the local storage event sink is attached.
    """
    try:
        get_default_sink().attach()
    except Exception:
        pass

    manager = get_default_hook_manager()
    return manager.register_to_context(ctx)
