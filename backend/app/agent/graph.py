import json
import re
from typing import AsyncIterator, List, Optional, Any

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.agent.tools import get_schemas, execute_tool
from app.config import settings
from app.models.system_prompt import SystemPrompt
from app.models.db_connection import DbConnection
from app.database import SessionLocal


# ── Experience suggestion heuristics ──

_CORRECTION_PATTERNS = re.compile(
    r"不对|不是|错误|错了|重新|再查|再找|换一个|换个|纠正|更正|不对的",
)

_KNOWLEDGE_SIGNALS = re.compile(
    r"根据|依据|按照|规定|标准|流程|方法|步骤|规则|定义|分类|分级|公式",
)


def _detect_learning_moment(
    question: str,
    answer: str,
    history: list[dict] | None,
    tool_call_count: int,
) -> dict | None:
    """Heuristic detection of whether this Q&A pair is worth saving as experience.

    Returns {"topic": str, "summary": str} if worthy, None otherwise.
    """
    if not answer or len(answer) < 80:
        return None

    # ── 1. Correction pattern: user corrected AI ≥2 times in this conversation ──
    correction_count = 0
    if history:
        for msg in history:
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if _CORRECTION_PATTERNS.search(content):
                    correction_count += 1

    # ── 2. Deep exploration: ≥3 user turns + tools used ──
    user_turns = 1  # current question counts as 1
    if history:
        for msg in history:
            if msg.get("role") == "user":
                user_turns += 1

    deep_exploration = user_turns >= 3 and tool_call_count > 0

    # ── 3. Knowledge signal: answer contains domain knowledge patterns ──
    has_knowledge = bool(_KNOWLEDGE_SIGNALS.search(answer)) and len(answer) > 200

    # ── Decide ──
    triggered = False
    reason = ""

    if correction_count >= 2 and has_knowledge:
        triggered = True
        reason = "correction"
    elif deep_exploration and has_knowledge:
        triggered = True
        reason = "deep_exploration"
    elif correction_count >= 2 and tool_call_count > 0:
        triggered = True
        reason = "correction_with_tools"

    if not triggered:
        return None

    # ── Extract topic from question (first 20 chars as topic label) ──
    topic = question.strip()
    # Try to extract key phrase
    for phrase in ["关于", "怎么", "如何", "什么是", "是什么"]:
        idx = topic.find(phrase)
        if idx >= 0:
            topic = topic[idx + len(phrase):]
            break
    topic = topic.strip()[:20]

    # ── Summary: first 150 chars of answer ──
    summary = answer.strip()[:150]
    if len(answer) > 150:
        summary += "…"

    return {"topic": topic, "summary": summary, "reason": reason}


def _load_system_prompt() -> str:
    db = SessionLocal()
    try:
        row = db.query(SystemPrompt).filter(
            SystemPrompt.prompt_key == "default"
        ).first()
        if row:
            return row.prompt_content
    finally:
        db.close()
    from app.agent.prompts import DEFAULT_SYSTEM_PROMPT
    return DEFAULT_SYSTEM_PROMPT


SYSTEM_PROMPT = _load_system_prompt()


def _lookup_connection_name(conn_id: int) -> str:
    if not conn_id:
        return ""
    db = SessionLocal()
    try:
        conn = db.query(DbConnection).filter(DbConnection.id == conn_id).first()
        return str(conn.name) if conn else ""
    finally:
        db.close()


_client: Optional[AsyncOpenAI] = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )
    return _client


async def _build_messages(question: str, history: List[dict] | None = None,
                         user_id: str = "default") -> list[ChatCompletionMessageParam]:
    experience_context = ""
    try:
        from app.services.experience_service import search_relevant
        relevant = await search_relevant(question, user_id=user_id)
        if relevant:
            parts = ["\n\n## 历史相关经验（来自过往对话）\n"]
            for i, r in enumerate(relevant, 1):
                text = r.get("text", "")
                if text:
                    parts.append(f"- {text[:300]}")
            experience_context = "\n".join(parts)
    except Exception as e:
        print(f"[Agent] Experience retrieval skipped: {e}")

    system_content = SYSTEM_PROMPT + experience_context

    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": system_content}
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
    kb_scope: str = "personal",
    db_scope: list[int] | None = None,
    default_category: str = "",
) -> tuple[str, list[str]]:
    client = _get_client()
    model = model or settings.model_name
    data_sources: set[str] = set()
    tool_schemas = get_schemas()

    if not tool_schemas:
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

        if not msg.tool_calls:
            return msg.content or "", list(data_sources)

        for tc in msg.tool_calls:
            func_name = tc.function.name
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                args = {}

            if func_name == "query_rag":
                data_sources.add("检索知识库")
            elif func_name in ("query_db", "list_db_tables"):
                data_sources.add("查询数据库")

            result = await execute_tool(
                func_name, user_id=user_id,
                kb_scope=kb_scope, db_scope=db_scope,
                default_category=default_category, **args,
            )

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

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

    final = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
    )
    return final.choices[0].message.content or "", list(data_sources)


async def run_agent_sync(
    question: str,
    history: List[dict] | None = None,
    user_id: str = "default",
    kb_scope: str = "personal",
    db_scope: list[int] | None = None,
    default_category: str = "",
) -> dict:
    import asyncio

    async def _run():
        messages = await _build_messages(question, history, user_id=user_id)
        answer, data_sources_used = await _run_react_loop(
            messages, user_id=user_id, kb_scope=kb_scope, db_scope=db_scope,
            default_category=default_category,
        )
        return {
            "answer": answer,
            "data_sources_used": data_sources_used,
        }

    return asyncio.run(_run())


def format_sse_event(event_type: str, data: Any) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def run_agent_stream_simple(
    question: str,
    history: List[dict] | None = None,
    user_id: str = "default",
    kb_scope: str = "personal",
    db_scope: list[int] | None = None,
    default_category: str = "",
    conv_id: str = "",
    exp_extract_enabled: bool = False,
) -> AsyncIterator[str]:
    import time as _time
    msg_id = f"msg-{int(_time.time() * 1000)}-ai"

    yield format_sse_event("connected", {"status": "started", "message_id": msg_id})

    try:
        client = _get_client()
        model = settings.model_name
        messages = await _build_messages(question, history, user_id=user_id)
        tool_schemas = get_schemas()
        data_sources_detected: list[str] = []
        final_answer = ""
        tool_call_count = 0
        max_rounds = 5

        for round_idx in range(max_rounds + 1):
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

                if delta.content:
                    collected_content += delta.content
                    yield format_sse_event("token", {"text": delta.content})

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

            if not tool_calls_buf:
                final_answer = collected_content
                break

            for idx in sorted(tool_calls_buf.keys()):
                tc = tool_calls_buf[idx]
                func_name = tc["name"]
                tool_call_count += 1
                try:
                    args = json.loads(tc["args"])
                except json.JSONDecodeError:
                    args = {}

                if func_name == "query_rag":
                    data_sources_detected.append("检索知识库")
                elif func_name in ("query_db", "list_db_tables"):
                    data_sources_detected.append("查询数据库")
                elif func_name == "find_file_by_name":
                    data_sources_detected.append("查找文件")

                if func_name == "query_rag":
                    kb_label = {
                        "personal": "检索个人知识库",
                        "public": "检索公共知识库",
                        "none": "检索知识库",
                    }.get(kb_scope, "检索知识库")
                    tool_label = f"{kb_label}..."
                elif func_name == "list_db_connections":
                    tool_label = "查看可用数据库..."
                elif func_name == "list_db_tables":
                    conn_id = args.get("connection_id", 0)
                    conn_name = _lookup_connection_name(conn_id) if conn_id else ""
                    tool_label = f"查看{conn_name}表结构..." if conn_name else "查看表结构..."
                elif func_name == "query_db":
                    conn_id = args.get("connection_id", 0)
                    conn_name = _lookup_connection_name(conn_id) if conn_id else ""
                    tool_label = f"查询{conn_name}数据库..." if conn_name else "查询数据库..."
                elif func_name == "find_file_by_name":
                    keyword = args.get("keyword", "")
                    tool_label = f"查找文件「{keyword}」..." if keyword else "查找文件..."
                elif func_name == "use_skill":
                    skill_name = args.get("skill_name", "")
                    tool_label = f"正在调用{skill_name}技能..." if skill_name else "正在调用技能..."
                else:
                    tool_label = func_name

                yield format_sse_event("tool_call_start", {
                    "tool": func_name,
                    "label": tool_label,
                    "input": tc["args"],
                })

                result = await execute_tool(
                    func_name, user_id=user_id,
                    kb_scope=kb_scope, db_scope=db_scope,
                    default_category=default_category, **args,
                )

                yield format_sse_event("tool_call_end", {
                    "tool": func_name,
                    "result_preview": result[:200],
                })

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

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

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

        if data_sources_detected:
            yield format_sse_event(
                "data_source",
                {"sources": list(set(data_sources_detected))},
            )

        if final_answer:
            yield format_sse_event("final_answer", {"text": final_answer, "message_id": msg_id})
        else:
            yield format_sse_event(
                "final_answer",
                {"text": "(Agent produced no text response)", "message_id": msg_id},
            )

        # ── Experience suggestion: detect learning moments ──
        if exp_extract_enabled and conv_id and final_answer:
            suggestion = _detect_learning_moment(
                question=question,
                answer=final_answer,
                history=history,
                tool_call_count=tool_call_count,
            )
            if suggestion:
                from app.services.experience_service import is_suggestion_dismissed
                if not is_suggestion_dismissed(conv_id):
                    yield format_sse_event("experience_suggest", {
                        "topic": suggestion["topic"],
                        "summary": suggestion["summary"],
                        "message_id": msg_id,
                    })

    except Exception as e:
        error_msg = f"Agent execution failed: {str(e)}"
        print(f"[Agent Error] {error_msg}")
        yield format_sse_event("error", {"message": error_msg})
