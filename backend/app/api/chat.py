from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List, Dict
import json

from starlette.responses import StreamingResponse

from app.agent.graph import run_agent_sync, run_agent_stream_simple
from app.agent.events import FinalAnswerEvent, DataSourceEvent, ErrorEvent
from app.database import SessionLocal
from app.models.user import User
from app.services.experience_service import extract_and_save
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


def _resolve_permissions(user_id: str) -> tuple[str, list[int] | None, bool]:
    """Resolve kb_scope / db_scope / exp_extract_enabled for a user from the DB.

    Returns (kb_scope, db_scope, exp_extract_enabled).  Defaults to
    ('personal', None, False) when user_id is 'default' or not found.
    """
    kb_scope = "personal"
    db_scope = None
    exp_extract_enabled = False
    if user_id and user_id != "default":
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.account == user_id).first()
            if user:
                kb_scope = user.kb_scope or "personal"
                raw_db = user.db_scope
                if raw_db:
                    try:
                        db_scope = json.loads(raw_db)
                    except (json.JSONDecodeError, TypeError):
                        db_scope = None
                exp_extract_enabled = user.exp_extract_enabled or False
        finally:
            db.close()
    return kb_scope, db_scope, exp_extract_enabled


class ChatRequest(BaseModel):
    message: str
    system_prompt: Optional[str] = None  # Template content — prepended to system message
    conversation_id: Optional[str] = None
    data_category: Optional[List[str]] = None  # e.g. ["人事", "设备"]
    data_sources: Optional[List[str]] = None
    response_mode: Optional[str] = "all"  # "text" | "chart" | "all"
    history: Optional[List[Dict[str, str]]] = None
    user_id: Optional[str] = None  # User identifier for knowledge base isolation
    category: Optional[str] = None  # Prompt template title — used as default RAG category


class ChatResponse(BaseModel):
    answer: str
    conversation_id: str
    message_id: str = ""
    data_sources_used: List[str] = []
    chart_config: Optional[dict] = None
    report_text: Optional[str] = None


from app.api.history import persistent_store


def _get_or_create_conversation(conv_id: str | None, user_id: str = "default") -> tuple[str, list]:
    return persistent_store.get_or_create(conv_id, user_id=user_id)


def _add_to_history(conv_id: str, role: str, content: str, template_name: str = ""):
    persistent_store.add_message(conv_id, role, content, template_name=template_name)


@router.post("/")
async def chat(request: ChatRequest):

    user_id = request.user_id or "default"
    conv_id, history = _get_or_create_conversation(request.conversation_id, user_id=user_id)

    agent_history = []
    for msg in history:
        agent_history.append(msg)
    if request.history:
        for msg in request.history:
            agent_history.append(msg)

    kb_scope, db_scope, _exp_enabled = _resolve_permissions(user_id)
    result = await run_agent_sync(
        question=request.message,
        history=agent_history or None,
        user_id=user_id,
        kb_scope=kb_scope,
        db_scope=db_scope,
        default_category=request.category or "",
        system_prompt=request.system_prompt or "",
    )

    _add_to_history(conv_id, "user", request.message)
    assistant_msg_id = ""
    if isinstance(result.get("answer"), str):
        assistant_msg_id = _add_to_history(conv_id, "assistant", result["answer"]) or ""

    return ChatResponse(
        answer=result["answer"],
        conversation_id=conv_id,
        message_id=assistant_msg_id,
        data_sources_used=result.get("data_sources_used", ["query_data"]),
        chart_config=result.get("chart_config"),
        report_text=result.get("report_text"),
    )


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    user_id = request.user_id or "default"
    conv_id, history = _get_or_create_conversation(request.conversation_id, user_id=user_id)

    async def event_generator():
        agent_history = []
        for msg in history:
            agent_history.append(msg)
        if request.history:
            for msg in request.history:
                agent_history.append(msg)

        kb_scope, db_scope, exp_extract_enabled = _resolve_permissions(user_id)
        final_answer = ""
        agent_msg_id = ""
        data_sources: list[str] = []
        try:
            async for event in run_agent_stream_simple(
                question=request.message,
                history=agent_history or None,
                user_id=user_id,
                kb_scope=kb_scope,
                db_scope=db_scope,
                default_category=request.category or "",
                conv_id=conv_id,
                exp_extract_enabled=exp_extract_enabled,
                system_prompt=request.system_prompt or "",
            ):
                if isinstance(event, FinalAnswerEvent):
                    final_answer = event.text
                    agent_msg_id = event.message_id
                elif isinstance(event, DataSourceEvent):
                    data_sources = event.sources
                yield event.to_sse()
        except Exception as e:
            yield ErrorEvent(message=f"流式响应异常: {e}").to_sse()
            logger.exception("[Chat:Stream] 流式响应异常")

        _add_to_history(conv_id, "user", request.message, template_name=request.category or "")
        if final_answer:
            msg_id = persistent_store.add_message(conv_id, "assistant", final_answer, msg_id=agent_msg_id)
            if data_sources and msg_id:
                persistent_store.set_message_sources(conv_id, msg_id, data_sources)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class FeedbackRequest(BaseModel):
    conversation_id: str
    message_id: str           # the AI message being rated
    rating: str               # "up" or "down"
    user_id: Optional[str] = None


@router.post("/feedback")
async def submit_feedback(request: FeedbackRequest):
    user_id = request.user_id or "default"

    extracted = False
    extract_msg = ""

    if request.rating == "up":
        can_extract = False
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.account == user_id).first()
            if user and user.exp_extract_enabled:
                can_extract = True
        finally:
            db.close()

        if not can_extract:
            logger.info(f"[Feedback:Save] Experience extraction disabled for user={user_id}, skip")
            extract_msg = "经验提取未启用，请联系管理员开通权限"
        else:
            conv_id, history = _get_or_create_conversation(request.conversation_id)

            user_question = ""
            ai_answer = ""
            template_name = ""

            # Find the rated message and its preceding user question
            rated_idx = -1
            for i, msg in enumerate(history):
                if msg.get("message_id") == request.message_id or msg.get("id") == request.message_id:
                    if msg["role"] == "assistant":
                        ai_answer = msg["content"]
                        rated_idx = i
                    break

            if rated_idx >= 0:
                # Search backwards from the rated message to find preceding user question
                for j in range(rated_idx - 1, -1, -1):
                    if history[j]["role"] == "user":
                        user_question = history[j]["content"]
                        template_name = history[j].get("template_name", "")
                        break

            if user_question and ai_answer:
                count = await extract_and_save(
                    user_question=user_question,
                    ai_answer=ai_answer,
                    user_id=user_id,
                    conv_id=conv_id,
                    msg_id=request.message_id,
                    category=template_name,
                )
                if count > 0:
                    extracted = True
                    extract_msg = f"成功提取 {count} 条经验"
                else:
                    extract_msg = "未提取到可复用的经验，该回答可能信息量不足"
            else:
                logger.warning(f"[Feedback:Save] Q&A not found for conv={conv_id}, msg={request.message_id}")
                extract_msg = "未找到对应问答对，请刷新页面后重试"

    # Persist feedback rating to conversation file so it survives re-login
    persistent_store.set_message_feedback(request.conversation_id, request.message_id, request.rating)

    return {"ok": True, "rating": request.rating, "extracted": extracted, "extract_msg": extract_msg}


# _extract_experiences_bg removed — extraction now happens inline in submit_feedback
# to ensure accurate feedback to the user
