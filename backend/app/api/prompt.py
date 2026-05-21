"""
Admin endpoint — manage the AI system prompt.

GET  /api/prompt       → return current prompt text
PUT  /api/prompt       → update the prompt (admin only)
POST /api/prompt/reset → reset to built-in default
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, SessionLocal
from app.models.system_prompt import SystemPrompt
from app.agent.prompts import DEFAULT_SYSTEM_PROMPT
from sqlalchemy.orm import Session

router = APIRouter()

# ── Default key used to store the active prompt ──
DEFAULT_KEY = "default"


class PromptPayload(BaseModel):
    content: str


def _get_or_create_default(db: Session) -> SystemPrompt:
    """Get the default prompt row; create one from the built-in default if
    no row exists yet."""
    row = db.query(SystemPrompt).filter(
        SystemPrompt.prompt_key == DEFAULT_KEY
    ).first()
    if row is None:
        row = SystemPrompt(
            prompt_key=DEFAULT_KEY,
            prompt_content=DEFAULT_SYSTEM_PROMPT,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("")
def get_prompt() -> dict:
    """Return the current active system prompt."""
    db = SessionLocal()
    try:
        row = _get_or_create_default(db)
        return {
            "key": row.prompt_key,
            "content": row.prompt_content,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    finally:
        db.close()


@router.put("")
def update_prompt(payload: PromptPayload) -> dict:
    """Update the active system prompt (admin only).

    The prompt is stored in the DB and will be picked up by the agent
    on the next request.
    """
    if not payload.content or not payload.content.strip():
        raise HTTPException(status_code=422, detail="Prompt content cannot be empty")

    db = SessionLocal()
    try:
        row = _get_or_create_default(db)
        row.prompt_content = payload.content.strip()
        db.commit()
        db.refresh(row)
        return {
            "ok": True,
            "key": row.prompt_key,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    finally:
        db.close()


@router.post("/reset")
def reset_prompt() -> dict:
    """Reset prompt to the built-in default (hardcoded in prompts.py)."""
    db = SessionLocal()
    try:
        row = _get_or_create_default(db)
        row.prompt_content = DEFAULT_SYSTEM_PROMPT
        db.commit()
        db.refresh(row)
        return {
            "ok": True,
            "content": DEFAULT_SYSTEM_PROMPT,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    finally:
        db.close()
