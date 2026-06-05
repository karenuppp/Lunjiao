from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import SessionLocal
from app.models.skill import Skill

router = APIRouter()


class SkillCreate(BaseModel):
    title: str
    content: str
    created_by: str = "admin"


class SkillUpdate(BaseModel):
    title: str | None = None
    content: str | None = None


class SkillGenerateRequest(BaseModel):
    title: str
    requirement: str


@router.get("")
def list_skills() -> list[dict]:
    db = SessionLocal()
    try:
        rows = db.query(Skill).order_by(Skill.created_at.desc()).all()
        return [
            {
                "id": r.id,
                "title": r.title,
                "description": r.description,
                "content": r.content,
                "created_by": r.created_by,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
    finally:
        db.close()


@router.post("")
def create_skill(payload: SkillCreate) -> dict:
    title = payload.title.strip()
    content = payload.content.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be empty")
    if not content:
        raise HTTPException(status_code=422, detail="Content cannot be empty")

    db = SessionLocal()
    try:
        row = Skill(
            title=title,
            description="",
            content=content,
            created_by=payload.created_by or "admin",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "id": row.id,
            "title": row.title,
            "description": row.description,
            "content": row.content,
            "created_by": row.created_by,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    finally:
        db.close()


@router.put("/{skill_id}")
def update_skill(skill_id: int, payload: SkillUpdate) -> dict:
    db = SessionLocal()
    try:
        row = db.query(Skill).filter(Skill.id == skill_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Skill not found")
        if payload.title is not None:
            title = payload.title.strip()
            if not title:
                raise HTTPException(status_code=422, detail="Title cannot be empty")
            row.title = title
        if payload.content is not None:
            content = payload.content.strip()
            if not content:
                raise HTTPException(status_code=422, detail="Content cannot be empty")
            row.content = content
        db.commit()
        db.refresh(row)
        return {
            "id": row.id,
            "title": row.title,
            "description": row.description,
            "content": row.content,
            "created_by": row.created_by,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    finally:
        db.close()


@router.delete("/{skill_id}")
def delete_skill(skill_id: int) -> dict:
    db = SessionLocal()
    try:
        row = db.query(Skill).filter(Skill.id == skill_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Skill not found")
        db.delete(row)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/generate")
async def generate_skill(payload: SkillGenerateRequest) -> dict:
    """Call LLM to generate a Claude Code skill specification from title + requirements."""
    title = payload.title.strip()
    requirement = payload.requirement.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be empty")
    if not requirement:
        raise HTTPException(status_code=422, detail="Requirement cannot be empty")

    prompt = f"""你是一个专业的 Claude Code 技能创建器。请根据用户的需求，生成一个规范的 Claude Code skill 文件（markdown 格式）。

技能名称：{title}
用户需求：{requirement}

请按以下结构生成技能文件：

---
name: {title}
description: 简要描述这个技能的功能（一句话）
---

# {title}

## 概述
简要说明这个技能的用途和适用场景。

## 触发条件
描述什么情况下应该调用这个技能。

## 工作流程
详细说明执行步骤：

## 输出格式
说明技能执行后的输出格式。

## 注意事项
列出使用时需要注意的要点。

请确保生成的 skill 内容完整、专业、可直接使用。只输出 skill 的 markdown 内容，不要加额外的说明。
"""

    try:
        from openai import AsyncOpenAI
        from app.config import settings

        client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )

        response = await client.chat.completions.create(
            model=settings.model_name,
            messages=[
                {"role": "system", "content": "你是一个专业的 Claude Code 技能创建器。只输出技能文件的 markdown 内容。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=2048,
        )

        content = response.choices[0].message.content or ""

        # Extract description from generated content (second line after frontmatter name)
        description = ""
        for line in content.split("\n"):
            if line.startswith("description:"):
                description = line.replace("description:", "").strip()
                break

        return {
            "ok": True,
            "content": content.strip(),
            "description": description,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Skill generation failed: {str(e)}")
