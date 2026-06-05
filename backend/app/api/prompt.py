from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import SessionLocal
from app.models.system_prompt import SystemPrompt
from app.agent.prompts import DEFAULT_SYSTEM_PROMPT

router = APIRouter()
templates_router = APIRouter()

DEFAULT_KEY = "default"
SYSTEM_DEFAULT_KEY = "system_default"


class PromptPayload(BaseModel):
    content: str


class TemplateCreate(BaseModel):
    title: str
    content: str


class TemplateUpdate(BaseModel):
    title: str | None = None
    content: str | None = None


def _get_or_create_default(db) -> SystemPrompt:
    row = db.query(SystemPrompt).filter(
        SystemPrompt.prompt_key == DEFAULT_KEY
    ).first()
    if row is None:
        row = SystemPrompt(
            prompt_key=DEFAULT_KEY,
            title="默认提示词",
            prompt_content=DEFAULT_SYSTEM_PROMPT,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    elif not row.title:
        row.title = "默认提示词"
        db.commit()
    return row


@router.get("")
def get_prompt() -> dict:
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


@templates_router.get("")
def list_templates() -> list[dict]:
    db = SessionLocal()
    try:
        rows = db.query(SystemPrompt).order_by(SystemPrompt.id.asc()).all()
        return [
            {
                "id": r.id,
                "prompt_key": r.prompt_key,
                "title": r.title or r.prompt_key,
                "content": r.prompt_content,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
    finally:
        db.close()


@templates_router.post("")
def create_template(payload: TemplateCreate) -> dict:
    title = payload.title.strip()
    content = payload.content.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be empty")
    if not content:
        raise HTTPException(status_code=422, detail="Content cannot be empty")

    import re
    key = re.sub(r'[^a-zA-Z0-9_\u4e00-\u9fff]+', '_', title).strip('_') or f"prompt_{title}"
    db = SessionLocal()
    try:
        existing = db.query(SystemPrompt).filter(
            SystemPrompt.prompt_key == key
        ).first()
        if existing:
            from time import time
            key = f"{key}_{time():.0f}"
        row = SystemPrompt(prompt_key=key, title=title, prompt_content=content)
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "id": row.id,
            "prompt_key": row.prompt_key,
            "title": row.title,
            "content": row.prompt_content,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    finally:
        db.close()


@templates_router.put("/{template_id}")
def update_template(template_id: int, payload: TemplateUpdate) -> dict:
    db = SessionLocal()
    try:
        row = db.query(SystemPrompt).filter(SystemPrompt.id == template_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Template not found")
        if payload.title is not None:
            title = payload.title.strip()
            if not title:
                raise HTTPException(status_code=422, detail="Title cannot be empty")
            row.title = title
        if payload.content is not None:
            content = payload.content.strip()
            if not content:
                raise HTTPException(status_code=422, detail="Content cannot be empty")
            row.prompt_content = content
        db.commit()
        db.refresh(row)
        return {
            "id": row.id,
            "prompt_key": row.prompt_key,
            "title": row.title,
            "content": row.prompt_content,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    finally:
        db.close()


@templates_router.delete("/{template_id}")
def delete_template(template_id: int) -> dict:
    db = SessionLocal()
    try:
        row = db.query(SystemPrompt).filter(SystemPrompt.id == template_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Template not found")
        if row.prompt_key == DEFAULT_KEY:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the default system prompt template",
            )
        if row.prompt_key == SYSTEM_DEFAULT_KEY:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the system default template",
            )
        db.delete(row)
        db.commit()
        return {"ok": True}
    finally:
        db.close()
