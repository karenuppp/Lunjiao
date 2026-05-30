from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List, Dict
import json
import traceback

from starlette.responses import StreamingResponse

from app.agent.graph import run_agent_sync, run_agent_stream_simple
from app.database import SessionLocal
from app.models.user import User

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
    data_sources_used: List[str] = []
    chart_config: Optional[dict] = None
    report_text: Optional[str] = None


from app.api.history import persistent_store


def _get_or_create_conversation(conv_id: str | None, user_id: str = "default") -> tuple[str, list]:
    return persistent_store.get_or_create(conv_id, user_id=user_id)


def _add_to_history(conv_id: str, role: str, content: str):
    persistent_store.add_message(conv_id, role, content)


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
    result = run_agent_sync(
        question=request.message,
        history=agent_history or None,
        user_id=user_id,
        kb_scope=kb_scope,
        db_scope=db_scope,
        default_category=request.category or "",
    )

    _add_to_history(conv_id, "user", request.message)
    if isinstance(result.get("answer"), str):
        _add_to_history(conv_id, "assistant", result["answer"])

    return ChatResponse(
        answer=result["answer"],
        conversation_id=conv_id,
        data_sources_used=result.get("data_sources_used", ["query_data"]),
        chart_config=result.get("chart_config"),
        report_text=result.get("report_text"),
    )


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    user_id = request.user_id or "default"
    conv_id, history = _get_or_create_conversation(request.conversation_id, user_id=user_id)

    async def event_generator():
        yield "event: connected\ndata: {\"conversation_id\": \"%s\"}\n\n" % conv_id

        agent_history = []
        for msg in history:
            agent_history.append(msg)
        if request.history:
            for msg in request.history:
                agent_history.append(msg)

        kb_scope, db_scope, exp_extract_enabled = _resolve_permissions(user_id)
        async for event_line in run_agent_stream_simple(
            question=request.message,
            history=agent_history or None,
            user_id=user_id,
            kb_scope=kb_scope,
            db_scope=db_scope,
            default_category=request.category or "",
            conv_id=conv_id,
            exp_extract_enabled=exp_extract_enabled,
        ):
            yield event_line

        _add_to_history(conv_id, "user", request.message)

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
async def submit_feedback(request: FeedbackRequest, background_tasks: BackgroundTasks):
    user_id = request.user_id or "default"

    if request.rating == "up":
        can_extract = False
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.account == user_id).first()
            if user and user.exp_extract_enabled:
                can_extract = True
        finally:
            db.close()

        if can_extract:
            conv_id, history = _get_or_create_conversation(request.conversation_id)

            user_question = ""
            ai_answer = ""
            for msg in reversed(history):
                if msg["role"] == "assistant" and not ai_answer:
                    ai_answer = msg["content"]
                elif msg["role"] == "user" and not user_question:
                    user_question = msg["content"]
                if user_question and ai_answer:
                    break

            if user_question and ai_answer:
                background_tasks.add_task(
                    _extract_experiences_bg,
                    user_question=user_question,
                    ai_answer=ai_answer,
                    user_id=user_id,
                    conv_id=conv_id,
                    msg_id=request.message_id,
                )

    return {"ok": True, "rating": request.rating}


def _extract_experiences_bg(
    user_question: str,
    ai_answer: str,
    user_id: str,
    conv_id: str,
    msg_id: str,
):
    try:
        import asyncio
        from app.services.experience_service import extract_and_save

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            count = loop.run_until_complete(
                extract_and_save(
                    user_question=user_question,
                    ai_answer=ai_answer,
                    user_id=user_id,
                    conv_id=conv_id,
                    msg_id=msg_id,
                )
            )
            print(f"[Feedback] Extracted {count} experience(s) for user {user_id}")
        finally:
            loop.close()
    except Exception as e:
        print(f"[Feedback] Background extraction failed: {e}")
        traceback.print_exc()
