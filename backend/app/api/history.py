from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter()


class Conversation(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0


class Message(BaseModel):
    id: str
    role: str  # "user" | "assistant"
    content: str
    created_at: str
    data_sources_used: List[str] = []


# Conversation cache — replace with DB layer in production
_conversation_store = [
    Conversation(
        id="conv-001",
        title="上月设备故障率趋势",
        created_at="2026-04-27T10:00:00",
        updated_at="2026-04-27T10:05:00",
        message_count=3,
    ),
]


@router.get("/")
async def list_conversations():
    return {"conversations": sorted(_conversation_store, key=lambda c: c.updated_at, reverse=True)}


@router.post("/")
async def create_conversation(title: Optional[str] = "新对话"):
    conv = Conversation(
        id=f"conv-{datetime.utcnow().timestamp():.0f}",
        title=title or "新对话",
        created_at=datetime.utcnow().isoformat(),
        updated_at=datetime.utcnow().isoformat(),
    )
    _conversation_store.append(conv)
    return conv


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str):
    return {"status": "ok", "deleted": conversation_id}


@router.get("/{conversation_id}/messages")
async def list_messages(conversation_id: str):
    messages = [
        Message(
            id="msg-001", role="user",
            content="上月设备故障率趋势如何？",
            created_at="2026-04-27T10:00:00",
        ),
        Message(
            id="msg-002", role="assistant",
            content="根据设备数据库的数据分析，上月（2026年3月）设备故障率为 **3.2%**，较前月（2.8%）上升 0.4 个百分点。\n\n主要故障集中在：\n1. 生产线 A 的传送带电机（故障 5 次）\n2. 包装机传感器（故障 3 次）\n\n建议关注传送带电机的定期维护。",
            data_sources_used=["设备数据库", "设备日志.xlsx"],
            created_at="2026-04-27T10:00:05",
        ),
    ]
    return {"messages": messages}
