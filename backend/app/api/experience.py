from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.services.experience_service import (
    list_experiences,
    update_experience,
    delete_experience,
    get_available_tags,
    approve_experience,
    reject_experience,
    extract_and_save,
    dismiss_suggestion,
    is_suggestion_dismissed,
)

router = APIRouter()


class ExperienceUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    status: str | None = None


@router.get("")
def list_experiences_api(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_id: str | None = None,
    status: str | None = None,
):
    """List experiences with optional filters."""
    items, total = list_experiences(
        page=page, page_size=page_size,
        user_id=user_id, status=status,
    )
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.put("/{experience_id}")
def update_experience_api(experience_id: int, payload: ExperienceUpdate):
    """Update an experience entry."""
    updates = {}
    if payload.title is not None:
        updates["title"] = payload.title.strip()
    if payload.content is not None:
        updates["content"] = payload.content.strip()
    if payload.tags is not None:
        updates["tags"] = payload.tags
    if payload.status is not None:
        updates["status"] = payload.status

    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    result = update_experience(experience_id, **updates)
    if not result:
        raise HTTPException(status_code=404, detail="Experience not found")
    return {"ok": True, "experience": result.to_dict()}


@router.delete("/{experience_id}")
def delete_experience_api(experience_id: int):
    """Delete an experience entry."""
    ok = delete_experience(experience_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Experience not found")
    return {"ok": True}


@router.get("/tags")
def get_tags():
    """Return available tags (prompt template titles)."""
    return {"tags": get_available_tags()}


@router.post("/{experience_id}/approve")
def approve_experience_api(experience_id: int):
    """Approve a pending experience → active."""
    result = approve_experience(experience_id)
    if not result:
        raise HTTPException(status_code=404, detail="Experience not found or not pending")
    return {"ok": True, "experience": result.to_dict()}


@router.post("/{experience_id}/reject")
def reject_experience_api(experience_id: int):
    """Reject a pending experience → delete it."""
    result = reject_experience(experience_id)
    if not result:
        raise HTTPException(status_code=404, detail="Experience not found or not pending")
    return {"ok": True}


class ExperienceSuggestRequest(BaseModel):
    user_question: str
    ai_answer: str
    user_id: str
    conv_id: str
    msg_id: str
    data_sources: list[str] = []


@router.post("/suggest")
async def suggest_experience(req: ExperienceSuggestRequest):
    """User confirmed a proactive suggestion → extract and save as pending."""
    count = await extract_and_save(
        user_question=req.user_question,
        ai_answer=req.ai_answer,
        user_id=req.user_id,
        conv_id=req.conv_id,
        msg_id=req.msg_id,
        data_sources=req.data_sources,
    )
    return {"ok": True, "extracted": count}


class ExperienceDismissRequest(BaseModel):
    conv_id: str


@router.post("/suggest/dismiss")
def dismiss_suggestion_api(req: ExperienceDismissRequest):
    """Mark a conversation's experience suggestion as dismissed."""
    dismiss_suggestion(req.conv_id)
    return {"ok": True}


@router.get("/suggest/dismissed/{conv_id}")
def check_dismissed(conv_id: str):
    """Check if suggestion was already dismissed for this conversation."""
    return {"dismissed": is_suggestion_dismissed(conv_id)}
