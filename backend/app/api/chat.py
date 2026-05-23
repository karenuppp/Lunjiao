from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uuid
import json

from starlette.responses import StreamingResponse

from app.agent.graph import run_agent_sync, run_agent_stream_simple
from app.database import SessionLocal
from app.models.user import User

router = APIRouter()


def _resolve_permissions(user_id: str) -> tuple[str, list[int] | None]:
    """Resolve kb_scope / db_scope for a user from the DB.

    Returns (kb_scope, db_scope).  Defaults to ('personal', None) when
    user_id is 'default' or the user is not found.
    """
    kb_scope = "personal"
    db_scope = None
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
        finally:
            db.close()
    return kb_scope, db_scope


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


# ============================================================
# In-memory conversation store (replace with DB later)
# ============================================================

_conversations: Dict[str, list] = {}


def _get_or_create_conversation(conv_id: str | None) -> tuple[str, list]:
    """Get existing or create a new conversation."""
    if conv_id and conv_id in _conversations:
        return conv_id, _conversations[conv_id]

    new_id = f"conv-{uuid.uuid4().hex[:8]}"
    _conversations[new_id] = []
    return new_id, _conversations[new_id]


def _add_to_history(conv_id: str, role: str, content: str):
    """Add message to conversation history."""
    if conv_id in _conversations:
        _conversations[conv_id].append({"role": role, "content": content})


# ============================================================
# Non-streaming endpoint (for backward compatibility)
# ============================================================

@router.post("/")
async def chat(request: ChatRequest):
    """Synchronous chat — returns full answer after agent completes."""

    conv_id, history = _get_or_create_conversation(request.conversation_id)

    # Build messages for the agent
    agent_history = []
    for msg in history:
        agent_history.append(msg)
    if request.history:
        for msg in request.history:
            agent_history.append(msg)

    # Call agent (default to "default" if user_id not provided for backward compat)
    user_id = request.user_id or "default"
    kb_scope, db_scope = _resolve_permissions(user_id)
    result = run_agent_sync(
        question=request.message,
        history=agent_history or None,
        user_id=user_id,
        kb_scope=kb_scope,
        db_scope=db_scope,
        default_category=request.category or "",
    )

    # Store conversation
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


# ============================================================
# Streaming endpoint (SSE) — main interface for frontend
# ============================================================

@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """Streaming chat via Server-Sent Events.

    Event types sent to the client:
      - token:        text chunk from LLM
      - tool_call_start:  when a tool is about to be called
      - tool_call_end:    when a tool call completes
      - final_answer:   complete answer text after streaming finishes
      - error:          on failure
    """

    conv_id, history = _get_or_create_conversation(request.conversation_id)

    async def event_generator():
        # Send initial connection event
        yield "event: connected\ndata: {\"conversation_id\": \"%s\"}\n\n" % conv_id

        agent_history = []
        for msg in history:
            agent_history.append(msg)
        if request.history:
            for msg in request.history:
                agent_history.append(msg)

        user_id = request.user_id or "default"
        kb_scope, db_scope = _resolve_permissions(user_id)
        async for event_line in run_agent_stream_simple(
            question=request.message,
            history=agent_history or None,
            user_id=user_id,
            kb_scope=kb_scope,
            db_scope=db_scope,
            default_category=request.category or "",
        ):
            yield event_line

        # Store conversation after completion
        _add_to_history(conv_id, "user", request.message)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
