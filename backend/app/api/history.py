import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter()


class Conversation(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0
    user_id: str = "default"


class Message(BaseModel):
    id: str
    role: str  # "user" | "assistant"
    content: str
    created_at: str
    data_sources_used: list[str] = []
    feedback_rating: str | None = None


def _talk_dir() -> Path:
    d = Path(settings.talk_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _conv_path(conv_id: str) -> Path:
    return _talk_dir() / f"{conv_id}.json"


def _read_conv(conv_id: str) -> dict | None:
    p = _conv_path(conv_id)
    if not p.exists():
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_conv(conv: dict):
    p = _conv_path(conv["id"])
    with open(p, "w", encoding="utf-8") as f:
        json.dump(conv, f, ensure_ascii=False, indent=2)


def _load_all_conversations(user_id: str | None = None) -> list[Conversation]:
    convs = []
    for fp in sorted(_talk_dir().glob("*.json"), key=os.path.getmtime, reverse=True):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
            if user_id and data.get("user_id", "default") != user_id:
                continue
            convs.append(Conversation(
                id=data["id"],
                title=data.get("title", "未命名对话"),
                created_at=data.get("created_at", ""),
                updated_at=data.get("updated_at", ""),
                message_count=len(data.get("messages", [])),
                user_id=data.get("user_id", "default"),
            ))
        except Exception:
            pass
    return convs


def _load_messages(conv_id: str) -> list[Message]:
    data = _read_conv(conv_id)
    if not data:
        return []
    messages = []
    for i, m in enumerate(data.get("messages", [])):
        messages.append(Message(
            id=m.get("id", f"msg-{i:03d}"),
            role=m.get("role", "user"),
            content=m.get("content", ""),
            created_at=m.get("created_at", ""),
            data_sources_used=m.get("data_sources_used", []),
            feedback_rating=m.get("feedback_rating"),
        ))
    return messages


# ── Shared persistent store (also used by chat.py) ──

class ConversationStore:
    """Persistent, file-backed conversation store shared with chat.py."""

    def get_or_create(self, conv_id: str | None, title: str = "新对话", user_id: str = "default") -> tuple[str, list[dict]]:
        if conv_id:
            data = _read_conv(conv_id)
            if data:
                return conv_id, data.setdefault("messages", [])

        new_id = conv_id or f"conv-{int(datetime.now().timestamp() * 1000)}"
        now = datetime.now(timezone.utc).isoformat()
        conv = {
            "id": new_id,
            "title": title[:80],
            "created_at": now,
            "updated_at": now,
            "messages": [],
            "user_id": user_id,
        }
        _write_conv(conv)
        return new_id, conv["messages"]

    def add_message(self, conv_id: str, role: str, content: str, template_name: str = "") -> str | None:
        data = _read_conv(conv_id)
        if not data:
            return None
        msg_id = f"msg-{len(data['messages']) + 1:03d}"
        msg_entry = {
            "id": msg_id,
            "role": role,
            "content": content,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "data_sources_used": [],
        }
        if template_name:
            msg_entry["template_name"] = template_name
        data["messages"].append(msg_entry)
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        if len(data["messages"]) <= 1:
            data["title"] = content[:80]
        _write_conv(data)
        return msg_id

    def delete(self, conv_id: str) -> bool:
        p = _conv_path(conv_id)
        if p.exists():
            p.unlink()
            return True
        return False

    def set_message_sources(self, conv_id: str, msg_id: str, sources: list[str]):
        data = _read_conv(conv_id)
        if not data:
            return
        for m in data.get("messages", []):
            if m.get("id") == msg_id and m.get("role") == "assistant":
                m["data_sources_used"] = sources
                _write_conv(data)
                break

    def set_message_feedback(self, conv_id: str, msg_id: str, rating: str):
        data = _read_conv(conv_id)
        if not data:
            return
        for m in data.get("messages", []):
            if m.get("id") == msg_id:
                m["feedback_rating"] = rating
                _write_conv(data)
                break


persistent_store = ConversationStore()


# ── API routes ──

@router.get("/")
async def list_conversations(user_id: Optional[str] = None):
    return {"conversations": _load_all_conversations(user_id)}


class CreateConversationRequest(BaseModel):
    title: Optional[str] = "新对话"
    user_id: Optional[str] = "default"


@router.post("/")
async def create_conversation(req: CreateConversationRequest):
    conv_id, _ = persistent_store.get_or_create(None, req.title or "新对话", user_id=req.user_id or "default")
    data = _read_conv(conv_id)
    return Conversation(
        id=data["id"],
        title=data.get("title", "新对话"),
        created_at=data.get("created_at", ""),
        updated_at=data.get("updated_at", ""),
        message_count=len(data.get("messages", [])),
        user_id=data.get("user_id", "default"),
    )


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str):
    ok = persistent_store.delete(conversation_id)
    return {"status": "ok" if ok else "not_found", "deleted": conversation_id}


@router.get("/search")
async def search_messages(keyword: str, user_id: str = "default"):
    """Search all conversation messages for a keyword (user-scoped)."""
    kw = keyword.strip().lower()
    if not kw or len(kw) < 1:
        return {"results": []}

    results = []
    for fp in sorted(_talk_dir().glob("*.json"), key=os.path.getmtime, reverse=True):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
            if user_id and data.get("user_id", "default") != user_id:
                continue
            conv_title = data.get("title", "未命名对话")
            conv_id = data["id"]
            for m in data.get("messages", []):
                content = m.get("content", "")
                if kw in content.lower():
                    # Extract context around the match
                    idx = content.lower().index(kw)
                    start = max(0, idx - 30)
                    end = min(len(content), idx + len(kw) + 60)
                    excerpt = content[start:end]
                    if start > 0:
                        excerpt = "…" + excerpt
                    if end < len(content):
                        excerpt = excerpt + "…"
                    results.append({
                        "conversation_id": conv_id,
                        "conversation_title": conv_title[:60],
                        "message_id": m.get("id", ""),
                        "role": m.get("role", "user"),
                        "excerpt": excerpt,
                        "keyword": keyword,
                        "created_at": m.get("created_at", ""),
                    })
        except Exception:
            pass

    # Return top 20 results
    return {"results": results[:20]}


@router.get("/{conversation_id}/messages")
async def list_messages(conversation_id: str):
    return {"messages": _load_messages(conversation_id)}
