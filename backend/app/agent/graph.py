"""
ReAct Agent for department Q&A.

Uses native OpenAI SDK (no langchain). Manual ReAct loop with tool-calling.
"""

import json
from typing import AsyncIterator, List, Optional, Any

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.agent.tools import get_schemas, execute_tool
from app.config import settings
from app.models.system_prompt import SystemPrompt
from app.database import SessionLocal


def _load_system_prompt() -> str:
    """Load the active system prompt from DB. Falls back to the built-in
    prompt if no DB row exists."""
    db = SessionLocal()
    try:
        row = db.query(SystemPrompt).filter(
            SystemPrompt.prompt_key == "default"
        ).first()
        if row:
            return row.prompt_content
    finally:
        db.close()
    # Fallback — built-in (copied from DEFAULT_SYSTEM_PROMPT in prompts.py)
    from app.agent.prompts import DEFAULT_SYSTEM_PROMPT
    return DEFAULT_SYSTEM_PROMPT


SYSTEM_PROMPT = _load_system_prompt()


# ============================================================
# OpenAI Client (async)
# ============================================================

_client: Optional[AsyncOpenAI] = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )
    return _client


# ============================================================
# Tool execution helpers
# ============================================================

def _build_messages(question: str, history: List[dict] | None = None) -> list[ChatCompletionMessageParam]:
    """Build message list from history + current question."""
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": SYSTEM_PROMPT}
    ]
    if history:
        for msg in history:
            if msg["role"] == "user":
                messages.append({"role": "user", "content": msg["content"]})
            elif msg["role"] == "assistant":
                messages.append({"role": "assistant", "content": msg["content"]})
    messages.append({"role": "user", "content": question})
    return messages


async def _run_react_loop(
    messages: list[ChatCompletionMessageParam],
    model: str | None = None,
    max_tool_rounds: int = 5,
    user_id: str = "default",
) -> tuple[str, list[str]]:
    """Run a manual ReAct loop using OpenAI tool-calling.

    Returns (final_answer_text, data_sources_used).
    """
    client = _get_client()
    model = model or settings.model_name
    data_sources: set[str] = set()
    tool_schemas = get_schemas()

    if not tool_schemas:
        # No tools registered — simple chat
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.2,
        )
        return response.choices[0].message.content or "", []

    for _ in range(max_tool_rounds + 1):
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tool_schemas,
            tool_choice="auto",
            temperature=0.2,
        )
        msg = response.choices[0].message

        # No tool calls — we're done
        if not msg.tool_calls:
            return msg.content or "", list(data_sources)

        # Execute tool calls
        for tc in msg.tool_calls:
            func_name = tc.function.name
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                args = {}

            # Track data sources
            if func_name == "query_rag":
                data_sources.add("RAG文档检索")
            elif func_name in ("query_db", "list_db_tables"):
                data_sources.add("数据库查询")

            # Execute
            result = await execute_tool(func_name, user_id=user_id, **args)

            # Append assistant message with tool call
            assistant_msg: dict = {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [{
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": func_name, "arguments": tc.function.arguments},
                }],
            }
            messages.append(assistant_msg)

            # Append tool result
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

    # Max rounds exhausted — get final response
    final = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
    )
    return final.choices[0].message.content or "", list(data_sources)


# ============================================================
# Sync API — for non-streaming requests
# ============================================================

def run_agent_sync(question: str, history: List[dict] | None = None, user_id: str = "default") -> dict:
    """Run the agent synchronously and return structured result."""
    import asyncio

    async def _run():
        messages = _build_messages(question, history)
        answer, data_sources_used = await _run_react_loop(messages, user_id=user_id)
        return {
            "answer": answer,
            "data_sources_used": data_sources_used,
        }

    return asyncio.run(_run())


# ============================================================
# Streaming API — SSE events for frontend
# ============================================================

def format_sse_event(event_type: str, data: Any) -> str:
    """Format a server-sent event."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def run_agent_stream_simple(
    question: str, history: List[dict] | None = None, user_id: str = "default"
) -> AsyncIterator[str]:
    """Run the agent with SSE streaming output.

    Yields SSE events:
      - token           -> text token from LLM
      - tool_call_start -> tool name + label for frontend display
      - tool_call_end   -> tool name + result preview
      - data_source     -> which data sources were queried (RAG / DB)
      - final_answer    -> complete AI response text
      - error           -> error details
    """
    yield format_sse_event("connected", {"status": "started"})

    try:
        client = _get_client()
        model = settings.model_name
        messages = _build_messages(question, history)
        tool_schemas = get_schemas()
        data_sources_detected: list[str] = []
        final_answer = ""
        max_rounds = 5

        for round_idx in range(max_rounds + 1):
            # --- Stream LLM response ---
            stream = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tool_schemas or None,
                tool_choice="auto" if tool_schemas else None,
                temperature=0.2,
                stream=True,
                stream_options={"include_usage": False},
            )

            collected_content = ""
            tool_calls_buf: dict[str, dict] = {}  # index -> {id, name, args}

            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if not delta:
                    continue

                # Content tokens
                if delta.content:
                    collected_content += delta.content
                    yield format_sse_event("token", {"text": delta.content})

                # Tool call deltas
                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in tool_calls_buf:
                            tool_calls_buf[idx] = {
                                "id": tc_delta.id or "",
                                "name": tc_delta.function.name or "",
                                "args": tc_delta.function.arguments or "",
                            }
                        else:
                            existing = tool_calls_buf[idx]
                            if tc_delta.id:
                                existing["id"] = tc_delta.id
                            if tc_delta.function and tc_delta.function.name:
                                existing["name"] = tc_delta.function.name
                            if tc_delta.function and tc_delta.function.arguments:
                                existing["args"] += tc_delta.function.arguments

            # --- Process tool calls ---
            if not tool_calls_buf:
                # No tool calls — this is the final answer
                final_answer = collected_content
                break

            # Execute each tool
            for idx in sorted(tool_calls_buf.keys()):
                tc = tool_calls_buf[idx]
                func_name = tc["name"]
                try:
                    args = json.loads(tc["args"])
                except json.JSONDecodeError:
                    args = {}

                # Track data source
                if func_name == "query_rag":
                    data_sources_detected.append("RAG文档检索")
                elif func_name in ("query_db", "list_db_tables"):
                    data_sources_detected.append("数据库查询")

                tool_label = {
                    "query_rag": "RAG文档检索",
                    "query_db": "数据库查询",
                    "list_db_tables": "查看表结构",
                }.get(func_name, func_name)

                yield format_sse_event("tool_call_start", {
                    "tool": func_name,
                    "label": tool_label,
                    "input": tc["args"],
                })

                # Execute
                result = await execute_tool(func_name, user_id=user_id, **args)

                yield format_sse_event("tool_call_end", {
                    "tool": func_name,
                    "result_preview": result[:200],
                })

                # Append assistant message with tool call
                messages.append({
                    "role": "assistant",
                    "content": collected_content,
                    "tool_calls": [{
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": func_name,
                            "arguments": tc["args"],
                        },
                    }],
                })

                # Append tool result
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            # Clear for next round
            collected_content = ""

        else:
            # Max rounds reached — final completion without streaming
            final_stream = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.2,
                stream=True,
            )
            final_answer = ""
            async for chunk in final_stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    final_answer += delta.content
                    yield format_sse_event("token", {"text": delta.content})

        # Emit data sources
        if data_sources_detected:
            yield format_sse_event(
                "data_source",
                {"sources": list(set(data_sources_detected))},
            )

        # Emit final answer
        if final_answer:
            yield format_sse_event("final_answer", {"text": final_answer})
        else:
            yield format_sse_event(
                "final_answer",
                {"text": "(Agent produced no text response)"},
            )

    except Exception as e:
        error_msg = f"Agent execution failed: {str(e)}"
        print(f"[Agent Error] {error_msg}")
        yield format_sse_event("error", {"message": error_msg})
