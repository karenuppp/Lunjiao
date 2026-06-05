"""Public API for agent execution.

Thin wrappers around ReActAgent.  Kept for backward compatibility with
all existing callers (chat.py API routes, tests, etc.).
"""

from __future__ import annotations

from typing import AsyncIterator

from app.agent.agent import ReActAgent, build_messages
from app.agent.config import AgentConfig
from app.agent.events import AgentEvent


async def run_agent_sync(
    question: str,
    history: list[dict] | None = None,
    user_id: str = "default",
    kb_scope: str = "personal",
    db_scope: list[int] | None = None,
    default_category: str = "",
    system_prompt: str = "",
) -> dict:
    """Non-streaming: build messages, run ReAct loop, return {answer, data_sources_used}."""
    agent = ReActAgent()
    messages = await build_messages(question, history, user_id=user_id, system_prompt=system_prompt)
    answer, data_sources_used = await agent.run_sync(
        messages,
        user_id=user_id,
        kb_scope=kb_scope,
        db_scope=db_scope,
        default_category=default_category,
    )
    return {
        "answer": answer,
        "data_sources_used": data_sources_used,
    }


async def run_agent_stream_simple(
    question: str,
    history: list[dict] | None = None,
    user_id: str = "default",
    kb_scope: str = "personal",
    db_scope: list[int] | None = None,
    default_category: str = "",
    conv_id: str = "",
    exp_extract_enabled: bool = False,
    system_prompt: str = "",
) -> AsyncIterator[AgentEvent]:
    """Streaming: yield typed AgentEvent objects.

    Caller converts to SSE via ``event.to_sse()``. This lets the caller
    inspect events (e.g. to capture the final answer for persistence).
    """
    agent = ReActAgent()
    async for event in agent.run_stream(
        question=question,
        history=history,
        user_id=user_id,
        kb_scope=kb_scope,
        db_scope=db_scope,
        default_category=default_category,
        conv_id=conv_id,
        exp_extract_enabled=exp_extract_enabled,
        system_prompt=system_prompt,
    ):
        yield event
