"""Typed event dataclasses for the ReAct agent SSE stream.

Event names use AG-UI-compatible naming: TEXT_BLOCK_DELTA, TOOL_CALL_START,
TOOL_CALL_END, etc.  Every event carries event_id, timestamp, round_idx.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


def _make_sse(event_type: str, data: dict[str, Any]) -> str:
    return (
        f"event: {event_type}\n"
        f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
    )


@dataclass
class AgentEvent:
    event_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    round_idx: int = 0
    event_type: str = ""

    def to_sse(self) -> str:
        """Serialize to SSE wire format.

        event_type used as the SSE ``event:`` field, excluded from JSON body.
        """
        payload = {
            k: v
            for k, v in asdict(self).items()
            if k not in ("event_type",) and v is not None
        }
        payload = {k: v for k, v in payload.items() if v is not None and v != ""}
        return _make_sse(self.event_type, payload)


@dataclass
class ReplyStartEvent(AgentEvent):
    """Signals the start of an agent reply (was "connected" in legacy code)."""
    event_type: str = "reply_start"
    conversation_id: str = ""


@dataclass
class TextDeltaEvent(AgentEvent):
    """Incremental text content (was "token"). AG-UI: TEXT_BLOCK_DELTA."""
    event_type: str = "text_delta"
    delta: str = ""


@dataclass
class ThinkingDeltaEvent(AgentEvent):
    """Thinking/reasoning text delta. AG-UI: THINKING_BLOCK_DELTA."""
    event_type: str = "thinking_delta"
    delta: str = ""


@dataclass
class ToolCallStartEvent(AgentEvent):
    """Tool execution begins. AG-UI: TOOL_CALL_START."""
    event_type: str = "tool_call_start"
    tool_name: str = ""
    tool_label: str = ""
    input_args: str = ""


@dataclass
class ToolCallEndEvent(AgentEvent):
    """Tool execution ends. AG-UI: TOOL_CALL_END."""
    event_type: str = "tool_call_end"
    tool_name: str = ""
    result_preview: str = ""


@dataclass
class DataSourceEvent(AgentEvent):
    event_type: str = "data_source"
    sources: list[str] = field(default_factory=list)


@dataclass
class FinalAnswerEvent(AgentEvent):
    event_type: str = "final_answer"
    text: str = ""
    message_id: str = ""


@dataclass
class ErrorEvent(AgentEvent):
    event_type: str = "error"
    message: str = ""


@dataclass
class ExperienceSuggestEvent(AgentEvent):
    event_type: str = "experience_suggest"
    topic: str = ""
    summary: str = ""
    message_id: str = ""
    category: str = ""
