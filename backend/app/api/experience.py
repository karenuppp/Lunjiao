from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.services.experience_service import (
    list_experiences,
    update_experience,
    delete_experience,
    get_available_tags,
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
