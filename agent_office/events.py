"""Event data models, event queue, and callback dispatcher for Agent Office."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set

logger = logging.getLogger("agent_office.events")


class EventType(str, Enum):
    """Enumeration of standard Agent Office event types."""

    SESSION_START = "session_start"
    SESSION_END = "session_end"
    BEFORE_TURN = "before_turn"
    AFTER_TURN = "after_turn"
    BEFORE_TOOL_CALL = "before_tool_call"
    AFTER_TOOL_CALL = "after_tool_call"


@dataclass
class Event:
    """Core structured Event model for Agent Office telemetry and event ingestion."""

    event_type: str
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: float = field(default_factory=time.time)
    session_id: Optional[str] = None
    turn_id: Optional[str] = None
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize event to a plain dictionary."""
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "timestamp": self.timestamp,
            "session_id": self.session_id,
            "turn_id": self.turn_id,
            "data": dict(self.data),
        }


class EventQueue:
    """Thread-safe, bounded in-memory event storage queue."""

    def __init__(self, maxsize: int = 10000) -> None:
        self._maxsize = maxsize
        self._queue: list[Event] = []
        self._lock = threading.Lock()

    def push(self, event: Event) -> bool:
        """Push an event onto the queue; fail-open if queue is full or errors occur."""
        try:
            with self._lock:
                if len(self._queue) >= self._maxsize:
                    # Drop oldest event to make room for newest telemetry
                    self._queue.pop(0)
                self._queue.append(event)
            return True
        except Exception as exc:
            logger.warning("Agent Office: EventQueue.push failed (fail-open): %s", exc)
            return False

    def pop(self) -> Optional[Event]:
        """Pop the oldest event from the queue."""
        try:
            with self._lock:
                if self._queue:
                    return self._queue.pop(0)
                return None
        except Exception as exc:
            logger.warning("Agent Office: EventQueue.pop failed: %s", exc)
            return None

    def peek(self) -> list[Event]:
        """Return a snapshot copy of all events currently in the queue."""
        try:
            with self._lock:
                return list(self._queue)
        except Exception:
            return []

    def clear(self) -> None:
        """Clear all events from the queue."""
        try:
            with self._lock:
                self._queue.clear()
        except Exception:
            pass

    def __len__(self) -> int:
        with self._lock:
            return len(self._queue)


class EventDispatcher:
    """Callback dispatcher and event distributor with fail-open resilience."""

    def __init__(self, queue: Optional[EventQueue] = None) -> None:
        self.queue = queue if queue is not None else EventQueue()
        self._listeners: dict[str, list[Callable[[Event], Any]]] = {}
        self._lock = threading.Lock()

    def subscribe(self, event_type: str, callback: Callable[[Event], Any]) -> Callable[[], None]:
        """Register a listener callback for a specific event type or '*' for all events.

        Returns an unsubscription callable.
        """
        with self._lock:
            self._listeners.setdefault(event_type, []).append(callback)

        def unsubscribe() -> None:
            self.unsubscribe(event_type, callback)

        return unsubscribe

    def unsubscribe(self, event_type: str, callback: Callable[[Event], Any]) -> bool:
        """Remove a previously registered listener callback."""
        with self._lock:
            callbacks = self._listeners.get(event_type, [])
            if callback in callbacks:
                callbacks.remove(callback)
                return True
            return False

    def dispatch(self, event: Event) -> None:
        """Deliver an event to the local queue and all subscribed listeners.

        Enforces Fail-Open: listener exceptions or queue failures never propagate.
        """
        # 1. Enqueue event
        try:
            self.queue.push(event)
        except Exception as exc:
            logger.warning("Agent Office: failed to enqueue event %s: %s", event.event_id, exc)

        # 2. Gather matching listeners
        with self._lock:
            specific_callbacks = list(self._listeners.get(event.event_type, []))
            wildcard_callbacks = list(self._listeners.get("*", []))

        # 3. Invoke listeners defensively
        for cb in specific_callbacks + wildcard_callbacks:
            try:
                cb(event)
            except Exception as exc:
                logger.warning(
                    "Agent Office: Listener %r raised exception on event %s (fail-open): %s",
                    getattr(cb, "__name__", repr(cb)),
                    event.event_type,
                    exc,
                )


_GLOBAL_DISPATCHER: Optional[EventDispatcher] = None
_GLOBAL_LOCK = threading.Lock()


def get_default_dispatcher() -> EventDispatcher:
    """Return the shared global EventDispatcher instance."""
    global _GLOBAL_DISPATCHER
    with _GLOBAL_LOCK:
        if _GLOBAL_DISPATCHER is None:
            _GLOBAL_DISPATCHER = EventDispatcher()
        return _GLOBAL_DISPATCHER


def reset_default_dispatcher() -> EventDispatcher:
    """Reset and reinitialize the default EventDispatcher instance."""
    global _GLOBAL_DISPATCHER
    with _GLOBAL_LOCK:
        _GLOBAL_DISPATCHER = EventDispatcher()
        return _GLOBAL_DISPATCHER
