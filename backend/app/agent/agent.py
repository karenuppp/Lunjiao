"""ReActAgent — configurable ReAct loop with streaming and sync modes.

Parameters injected via AgentConfig (not hardcoded). Yields typed AgentEvent
objects instead of raw SSE strings. Single-agent, single-user design.
"""

from __future__ import annotations

import json
import re
import time as _time
from typing import AsyncIterator

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.agent.config import AgentConfig
from app.agent.events import (
    AgentEvent,
    ReplyStartEvent,
    TextDeltaEvent,
    ToolCallStartEvent,
    ToolCallEndEvent,
    DataSourceEvent,
    FinalAnswerEvent,
    ErrorEvent,
    ExperienceSuggestEvent,
    SkillInvokedEvent,
)
from app.agent.tools import get_schemas, execute_tool, TOOL_FUNCTIONS
from app.config import settings
from app.models.system_prompt import SystemPrompt
from app.models.db_connection import DbConnection
from app.database import SessionLocal
from app.logger import get_logger

logger = get_logger(__name__)

# ── Text-based tool call parser (fallback for models without native function calling) ─

_TEXT_TC_PATTERN = re.compile(
    r'<tool_call>\s*'
    r'(?:<function=(\w+)>)?'
    r'(.*?)'
    r'(?:</function>)?'
    r'\s*</tool_call>',
    re.DOTALL,
)

_PARAM_PATTERN = re.compile(
    r'<parameter=(\w+)>\s*(.*?)\s*</parameter>',
    re.DOTALL,
)


def _parse_text_tool_calls(text: str) -> list[dict]:
    """Extract tool calls from model text output when native function calling fails.

    Handles the text format some local models produce, e.g.:
        <tool_call> <function=query_rag> <parameter=query_text>...</parameter>
        <parameter=top_k>5</parameter> </function> </tool_call>

    Returns list of {"name": str, "arguments": str} dicts.
    """
    results: list[dict] = []
    for tc_match in _TEXT_TC_PATTERN.finditer(text):
        func_name = tc_match.group(1) or ""
        body = tc_match.group(2)

        # If no <function=NAME> wrapper, try <function=NAME> inside body
        if not func_name:
            func_match = re.search(r'<function=(\w+)>', body)
            if func_match:
                func_name = func_match.group(1)

        params: dict[str, str] = {}
        for pm in _PARAM_PATTERN.finditer(body):
            params[pm.group(1)] = pm.group(2).strip()

        if func_name:
            results.append({
                "name": func_name,
                "arguments": json.dumps(params, ensure_ascii=False),
            })
    return results


# ── Experience suggestion heuristics ────────────────────────────────────────

_CORRECTION_PATTERNS = re.compile(
    r"不对|不是|错误|错了|重新|再查|再找|换一个|换个|纠正|更正|不对的",
)

_KNOWLEDGE_SIGNALS = re.compile(
    r"根据|依据|按照|规定|标准|流程|方法|步骤|规则|定义|分类|分级|公式",
)


def detect_learning_moment(
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

    correction_count = 0
    if history:
        for msg in history:
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if _CORRECTION_PATTERNS.search(content):
                    correction_count += 1

    user_turns = 1
    if history:
        for msg in history:
            if msg.get("role") == "user":
                user_turns += 1

    deep_exploration = user_turns >= 3 and tool_call_count > 0
    has_knowledge = bool(_KNOWLEDGE_SIGNALS.search(answer)) and len(answer) > 200

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

    topic = question.strip()
    for phrase in ["关于", "怎么", "如何", "什么是", "是什么"]:
        idx = topic.find(phrase)
        if idx >= 0:
            topic = topic[idx + len(phrase):]
            break
    topic = topic.strip()[:20]

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


def _build_skills_prompt() -> str:
    """Build a prompt section listing available skills for the agent."""
    from app.database import SessionLocal
    from app.models.skill import Skill
    db = SessionLocal()
    try:
        skills = db.query(Skill).all()
        if not skills:
            return ""
        lines = ["## 可用技能列表", ""]
        for s in skills:
            lines.append(f"- **{s.title}**：{s.description or '（无描述）'}")
        lines.append("")
        lines.append("**重要**：当用户问题匹配上述任一技能时，必须第一时间调用 `use_skill` 加载该技能的工作流程，严格按技能指引执行。不要自行判断或跳过技能调用。")
        return "\n".join(lines)
    finally:
        db.close()


def lookup_connection_name(conn_id: int) -> str:
    if not conn_id:
        return ""
    db = SessionLocal()
    try:
        conn = db.query(DbConnection).filter(DbConnection.id == conn_id).first()
        return str(conn.name) if conn else ""
    finally:
        db.close()


async def build_messages(
    question: str,
    history: list[dict] | None = None,
    user_id: str = "default",
    system_prompt: str = "",
) -> list[ChatCompletionMessageParam]:
    # Experience context is provided by the agent's query_experience tool
    # at runtime — not injected into the system prompt here (avoids double
    # vector search with the same query).
    system_content = (system_prompt + "\n\n" + SYSTEM_PROMPT).strip() if system_prompt else SYSTEM_PROMPT

    # Inject available skills so the agent knows what to match against
    skills_text = _build_skills_prompt()
    if skills_text:
        system_content = system_content + "\n\n" + skills_text

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


def _tool_label(
    func_name: str,
    args: dict,
    kb_scope: str = "none",
) -> str:
    """Human-readable label for a tool call (shown in UI during execution)."""
    if func_name == "query_rag":
        kb_label = {
            "personal": "检索个人知识库",
            "public": "检索公共知识库",
            "none": "检索知识库",
        }.get(kb_scope, "检索知识库")
        return f"{kb_label}..."
    elif func_name == "list_db_connections":
        return "查看可用数据库..."
    elif func_name == "list_db_tables":
        conn_id = args.get("connection_id", 0)
        conn_name = lookup_connection_name(conn_id) if conn_id else ""
        return f"查看{conn_name}表结构..." if conn_name else "查看表结构..."
    elif func_name == "query_db":
        conn_id = args.get("connection_id", 0)
        conn_name = lookup_connection_name(conn_id) if conn_id else ""
        return f"查询{conn_name}数据库..." if conn_name else "查询数据库..."
    elif func_name == "find_file_by_name":
        keyword = args.get("keyword", "")
        return f"查找文件「{keyword}」..." if keyword else "查找文件..."
    elif func_name == "use_skill":
        skill_name = args.get("skill_name", "")
        return f"正在调用{skill_name}技能..." if skill_name else "正在调用技能..."
    elif func_name == "get_skill_reference":
        skill_name = args.get("skill_name", "")
        return f"正在查阅{skill_name}参考文档..." if skill_name else "正在查阅参考文档..."
    elif func_name == "run_skill_script":
        script_name = args.get("script_name", "")
        return f"正在执行{script_name}脚本..." if script_name else "正在执行脚本..."
    elif func_name == "run_code":
        return "正在执行代码..."
    return func_name


def _data_source_for_tool(func_name: str) -> str | None:
    """Map tool name to a data source category string."""
    if func_name == "query_rag":
        return "检索知识库"
    elif func_name in ("query_db", "list_db_tables"):
        return "查询数据库"
    elif func_name == "find_file_by_name":
        return "查找文件"
    elif func_name == "use_skill":
        return "调用技能"
    elif func_name == "run_skill_script":
        return "执行脚本"
    elif func_name == "run_code":
        return "执行代码"
    return None


# ── ReActAgent ──────────────────────────────────────────────────────────────

class ReActAgent:
    """Configurable ReAct agent.

    Parameters injected via AgentConfig instead of hardcoded constants.
    Single-agent, single-user design — no multi-agent orchestration.

    Usage::

        config = AgentConfig(react=ReActConfig(max_rounds=10, temperature=0.1))
        agent = ReActAgent(config)
        async for event in agent.run_stream(question="...", ...):
            yield event.to_sse()
    """

    def __init__(
        self,
        config: AgentConfig | None = None,
        client: AsyncOpenAI | None = None,
    ):
        self.config = config or AgentConfig()
        self._client = client

    @property
    def client(self) -> AsyncOpenAI:
        if self._client is not None:
            return self._client
        return AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )

    # ── Sync mode ───────────────────────────────────────────────────────

    async def run_sync(
        self,
        messages: list[ChatCompletionMessageParam],
        user_id: str = "default",
        kb_scope: str = "none",
        db_scope: list[int] | None = None,
        default_category: str = "",
    ) -> tuple[str, list[str]]:
        """Non-streaming ReAct loop. Returns (answer, data_sources)."""
        model = self.config.model or settings.model_name
        data_sources: set[str] = set()
        tool_schemas = get_schemas()
        max_rounds = self.config.react.max_rounds
        temperature = self.config.react.temperature

        if not tool_schemas:
            response = await self.client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
            )
            return response.choices[0].message.content or "", []

        for _ in range(max_rounds + 1):
            response = await self.client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tool_schemas,
                tool_choice="auto",
                temperature=temperature,
            )
            msg = response.choices[0].message

            if not msg.tool_calls:
                # Fallback: parse text-based tool calls from model output
                content = msg.content or ""
                text_tcs = _parse_text_tool_calls(content)
                if text_tcs:
                    logger.info(
                        f"[Agent:Sync] Parsed {len(text_tcs)} "
                        f"text-based tool call(s): {[t['name'] for t in text_tcs]}"
                    )
                    # Convert to pseudo-tool_calls so the loop below handles them
                    pseudo_calls = []
                    for i, tc in enumerate(text_tcs):
                        pseudo_calls.append(
                            type("PseudoToolCall", (), {
                                "id": f"text-tc-sync-{i}",
                                "type": "function",
                                "function": type("PseudoFunc", (), {
                                    "name": tc["name"],
                                    "arguments": tc["arguments"],
                                }),
                            })()
                        )
                    msg = type("PseudoMsg", (), {
                        "content": _TEXT_TC_PATTERN.sub("", content).strip(),
                        "tool_calls": pseudo_calls,
                    })()
                else:
                    return content, list(data_sources)

            for tc in msg.tool_calls:
                func_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                ds = _data_source_for_tool(func_name)
                if ds:
                    data_sources.add(ds)

                result = await execute_tool(
                    func_name, user_id=user_id,
                    kb_scope=kb_scope, db_scope=db_scope,
                    default_category=default_category, **args,
                )

                messages.append({
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [{
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": func_name, "arguments": tc.function.arguments},
                    }],
                })
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

        final = await self.client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return final.choices[0].message.content or "", list(data_sources)

    # ── Streaming mode ──────────────────────────────────────────────────

    async def run_stream(
        self,
        question: str,
        history: list[dict] | None = None,
        user_id: str = "default",
        kb_scope: str = "none",
        db_scope: list[int] | None = None,
        default_category: str = "",
        conv_id: str = "",
        exp_extract_enabled: bool = False,
        system_prompt: str = "",
    ) -> AsyncIterator[AgentEvent]:
        """Streaming ReAct loop. Yields typed AgentEvent objects.

        Consumer calls ``event.to_sse()`` to serialize for SSE transport.
        """
        model = self.config.model or settings.model_name
        max_rounds = self.config.react.max_rounds
        temperature = self.config.react.temperature

        msg_id = f"msg-{int(_time.time() * 1000)}-ai"

        yield ReplyStartEvent(conversation_id=conv_id)

        try:
            messages = await build_messages(question, history, user_id=user_id, system_prompt=system_prompt)
            tool_schemas = get_schemas()
            data_sources_detected: list[str] = []
            skills_used: list[str] = []
            final_answer = ""
            tool_call_count = 0

            for round_idx in range(max_rounds + 1):
                stream = await self.client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=tool_schemas or None,
                    tool_choice="auto" if tool_schemas else None,
                    temperature=temperature,
                    stream=True,
                    stream_options={"include_usage": False},
                )

                collected_content = ""
                tool_calls_buf: dict[str, dict] = {}
                suppress_stream = False

                async for chunk in stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if not delta:
                        continue

                    if delta.content and not suppress_stream:
                        # Check whether this delta + what we've already
                        # collected crosses into a <tool_call> block.
                        # If so, suppress from this point onward so the
                        # raw markup is never streamed to the user.
                        test = collected_content + delta.content
                        tc_pos = test.find("<tool_call")
                        if tc_pos >= 0:
                            suppress_stream = True
                            # Stream any safe prefix that arrived before
                            # the <tool_call> marker.
                            safe_prefix = test[:tc_pos]
                            already_seen = len(collected_content)
                            if safe_prefix and len(safe_prefix) > already_seen:
                                yield TextDeltaEvent(
                                    round_idx=round_idx,
                                    delta=safe_prefix[already_seen:],
                                )
                        elif self.config.react.stream_tokens:
                            yield TextDeltaEvent(
                                round_idx=round_idx,
                                delta=delta.content,
                            )
                    elif delta.content and self.config.react.stream_tokens:
                        # Still streaming safe content; suppress_stream is
                        # True so we skip tool-call markup.
                        pass

                    if delta.content:
                        collected_content += delta.content

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
                    # Fallback: some local models output text-based tool calls
                    # instead of native function calling. Parse them so tools
                    # still execute correctly.
                    text_tcs = _parse_text_tool_calls(collected_content)
                    if text_tcs:
                        logger.info(
                            f"[Agent:Round{round_idx}] Parsed {len(text_tcs)} "
                            f"text-based tool call(s): {[t['name'] for t in text_tcs]}"
                        )
                        for i, tc in enumerate(text_tcs):
                            tool_calls_buf[str(i)] = {
                                "id": f"text-tc-{round_idx}-{i}",
                                "name": tc["name"],
                                "args": tc["arguments"],
                            }
                        # Strip the raw XML block so it doesn't pollute the answer
                        collected_content = _TEXT_TC_PATTERN.sub("", collected_content).strip()
                    else:
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

                    ds = _data_source_for_tool(func_name)
                    if ds:
                        data_sources_detected.append(ds)

                    label = _tool_label(func_name, args, kb_scope)

                    yield ToolCallStartEvent(
                        round_idx=round_idx,
                        tool_name=func_name,
                        tool_label=label,
                        input_args=tc["args"],
                    )

                    result = await execute_tool(
                        func_name, user_id=user_id,
                        kb_scope=kb_scope, db_scope=db_scope,
                        default_category=default_category, **args,
                    )

                    # Detect skill download results
                    skill_download_id = ""
                    skill_filename = ""
                    if func_name == "run_skill_script":
                        try:
                            parsed = json.loads(result)
                            if isinstance(parsed, dict) and parsed.get("ok") and parsed.get("download_id"):
                                skill_download_id = parsed["download_id"]
                                skill_filename = parsed.get("filename", "")
                        except (json.JSONDecodeError, TypeError):
                            pass
                    elif func_name == "use_skill":
                        skills_used.append(args.get("skill_name", ""))

                    yield ToolCallEndEvent(
                        round_idx=round_idx,
                        tool_name=func_name,
                        result_preview=result[:200],
                    )

                    if skill_download_id:
                        yield SkillInvokedEvent(
                            skill_name=args.get("skill_name", ""),
                            download_id=skill_download_id,
                            filename=skill_filename,
                        )

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
                # Max rounds reached — final completion without tools
                final_stream = await self.client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    stream=True,
                )
                final_answer = ""
                async for chunk in final_stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta and delta.content:
                        final_answer += delta.content
                        if self.config.react.stream_tokens:
                            yield TextDeltaEvent(
                                round_idx=max_rounds,
                                delta=delta.content,
                            )

            if data_sources_detected:
                yield DataSourceEvent(
                    round_idx=-1,  # summary event, not tied to a round
                    sources=list(set(data_sources_detected)),
                )

            if final_answer:
                yield FinalAnswerEvent(text=final_answer, message_id=msg_id)
            else:
                yield FinalAnswerEvent(
                    text="抱歉，我未能检索到相关信息来回答您的问题。建议您：\n"
                         "1. 尝试更换关键词或更具体的问法\n"
                         "2. 确认知识库中已上传相关文档\n"
                         "3. 联系管理员检查知识库索引状态\n"
                         "4. 如果这是通用知识类问题，可尝试重新提问（系统将优先使用模型自身知识回答）",
                    message_id=msg_id,
                )

            # ── Experience suggestion ──────────────────────────────────
            if exp_extract_enabled and conv_id and final_answer:
                suggestion = detect_learning_moment(
                    question=question,
                    answer=final_answer,
                    history=history,
                    tool_call_count=tool_call_count,
                )
                if suggestion:
                    try:
                        from app.services.experience_service import is_suggestion_dismissed
                        if not is_suggestion_dismissed(conv_id):
                            yield ExperienceSuggestEvent(
                                topic=suggestion["topic"],
                                summary=suggestion["summary"],
                                message_id=msg_id,
                                category=default_category,
                            )
                    except Exception:
                        pass

        except Exception as e:
            error_msg = f"Agent execution failed: {str(e)}"
            logger.error(f"[Agent:Error] {error_msg}")
            yield ErrorEvent(message=error_msg)
