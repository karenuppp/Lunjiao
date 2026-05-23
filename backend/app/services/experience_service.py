from __future__ import annotations

import json
import hashlib
import asyncio
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.database import SessionLocal
from app.config import settings
from app.models.experience import Experience, ExperienceStatus


def get_available_tags() -> list[str]:
    from app.models.system_prompt import SystemPrompt
    db = SessionLocal()
    try:
        rows = db.query(SystemPrompt).all()
        return sorted([r.title for r in rows if r.title])
    finally:
        db.close()


EXTRACTION_PROMPT = """\
你是一个知识管理助手。请从以下用户认可的对话中提取可复用的经验。

用户问题：{user_question}
AI 回答：{ai_answer}
使用的数据源：{data_sources}

可用标签（必须从中选择）：{available_tags}

请以 JSON 格式返回提取的经验：
{{
  "extracted": [
    {{
      "title": "经验标题（15字以内）",
      "content": "完整的经验描述，包含背景、结论、操作方法",
      "tags": ["标签1"]
    }}
  ],
  "should_save": true
}}

规则：
- tags 必须从可用标签列表中选择，不能随意创建。如果经验不匹配任何标签，选最接近的一个
- 只提取可复用的、有价值的经验。如果回答只是简单问候或无信息量，返回 should_save: false
- 每条经验的 content 应包含足够上下文，使后续检索时能被独立理解
- title 简洁概括经验内容
"""


async def _llm_extract_experiences(
    user_question: str,
    ai_answer: str,
    data_sources: list[str],
) -> list[dict]:
    from openai import AsyncOpenAI

    available_tags = get_available_tags()
    if not available_tags:
        available_tags = ["默认提示词"]

    prompt = EXTRACTION_PROMPT.format(
        user_question=user_question,
        ai_answer=ai_answer,
        data_sources=", ".join(data_sources) if data_sources else "无",
        available_tags=", ".join(available_tags),
    )

    client = AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )

    try:
        response = await client.chat.completions.create(
            model=settings.model_name,
            messages=[
                {"role": "system", "content": "你是一个知识提取助手。只输出 JSON，不要添加任何其他内容。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=2048,
        )
        content = response.choices[0].message.content or ""
    except Exception as e:
        print(f"[Experience] LLM extraction call failed: {e}")
        return []

    try:
        # Try direct parse first
        result = json.loads(content)
    except json.JSONDecodeError:
        # Try to extract from code block
        import re
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content, re.DOTALL)
        if match:
            try:
                result = json.loads(match.group(1))
            except json.JSONDecodeError:
                print(f"[Experience] Failed to parse extraction response: {content[:300]}")
                return []
        else:
            print(f"[Experience] No JSON found in extraction response: {content[:300]}")
            return []

    if not result.get("should_save", False):
        return []

    return result.get("extracted", [])


async def _index_experience_to_rag(exp: Experience):
    try:
        from app.rag_engine import rag
        await rag._ensure_ready(f"exp_{exp.user_id}")

        lightrag = rag._rags[f"exp_{exp.user_id}"].lightrag

        doc_key = f"exp_{exp.id}"
        text_content = f"标题: {exp.title}\n内容: {exp.content}\n标签: {', '.join(exp.tags or [])}"

        await lightrag.full_docs.upsert(
            {doc_key: {"content": text_content, "file_path": ""}}
        )

        chunk_key = hashlib.md5(text_content.encode()).hexdigest()[:16]
        inserting_chunks = {
            chunk_key: {
                "content": text_content,
                "full_doc_id": doc_key,
                "tokens": len(text_content.split()),
                "chunk_order_index": 0,
                "file_path": "",
            }
        }
        await lightrag.chunks_vdb.upsert(inserting_chunks)
        await lightrag.text_chunks.upsert(inserting_chunks)
        await lightrag._insert_done()
    except Exception as e:
        print(f"[Experience] Vector index failed for exp_{exp.id}: {e}")


async def _remove_experience_from_rag(exp_id: int, user_id: str):
    print(f"[Experience] Vector removal requested for exp_{exp_id} (soft-skipped)")


def _check_duplicate(title: str, content: str, user_id: str) -> Optional[Experience]:
    db = SessionLocal()
    try:
        existing = db.query(Experience).filter(
            Experience.user_id == user_id,
            Experience.title == title,
            Experience.status == ExperienceStatus.active,
        ).first()
        if existing:
            return existing
        return None
    finally:
        db.close()


async def search_relevant(
    query_text: str,
    user_id: str,
    top_k: int | None = None,
) -> list[dict]:
    top_k = top_k or settings.experience_top_k

    try:
        from app.rag_engine import rag
        await rag._ensure_ready(f"exp_default")

        lightrag = rag._rags[f"exp_default"].lightrag
        from lightrag.base import QueryParam

        param = QueryParam(
            mode="naive",
            only_need_context=True,
            top_k=top_k,
            chunk_top_k=top_k,
            enable_rerank=False,
        )
        result_text = await lightrag.aquery(query_text, param=param)

        if not result_text or not result_text.strip():
            return []

        import re
        content_parts = []
        for block in re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", result_text, re.DOTALL):
            try:
                obj = json.loads(block)
                c = obj.get("content", "")
                if c:
                    content_parts.append(c)
            except json.JSONDecodeError:
                pass
        if not content_parts:
            content_parts.append(result_text.strip())

        results = []
        seen = set()
        db = SessionLocal()
        try:
            for text in content_parts:
                text = text.strip()
                if not text or text in seen:
                    continue
                seen.add(text)
                results.append({
                    "text": text,
                    "source": "历史经验",
                })
                if len(results) >= top_k:
                    break
        finally:
            db.close()

        return results
    except Exception as e:
        print(f"[Experience] Search failed: {e}")
        return []


async def extract_and_save(
    user_question: str,
    ai_answer: str,
    user_id: str,
    conv_id: str,
    msg_id: str,
    data_sources: list[str] | None = None,
) -> int:
    extracted = await _llm_extract_experiences(
        user_question=user_question,
        ai_answer=ai_answer,
        data_sources=data_sources or [],
    )

    if not extracted:
        return 0

    available_tags = get_available_tags()

    saved_count = 0
    db = SessionLocal()
    try:
        for item in extracted:
            title = item.get("title", "").strip()
            content = item.get("content", "").strip()
            tags = item.get("tags", [])

            if not title or not content:
                continue

            valid_tags = [t for t in tags if t in available_tags]
            if not valid_tags and available_tags:
                valid_tags = [available_tags[0]]

            dup = _check_duplicate(title, content, user_id)
            if dup:
                dup.confidence = min(1.0, dup.confidence + 0.05)
                dup.access_count = dup.access_count + 1
                dup.last_accessed = datetime.now()
                dup.tags = valid_tags
                db.commit()
                saved_count += 1
                continue

            exp = Experience(
                user_id=user_id,
                title=title,
                content=content,
                source_conv_id=conv_id,
                source_msg_id=msg_id,
                tags=valid_tags,
                confidence=1.0,
                status=ExperienceStatus.active,
            )
            db.add(exp)
            db.commit()
            db.refresh(exp)

            try:
                await _index_experience_to_rag(exp)
            except Exception as e:
                print(f"[Experience] Vector index warning for exp_{exp.id}: {e}")

            saved_count += 1
    except Exception as e:
        db.rollback()
        print(f"[Experience] Save failed: {e}")
    finally:
        db.close()

    return saved_count


def list_experiences(page: int = 1, page_size: int = 20,
                     user_id: str | None = None,
                     status: str | None = None) -> tuple[list[dict], int]:
    db = SessionLocal()
    try:
        q = db.query(Experience)
        if user_id:
            q = q.filter(Experience.user_id == user_id)
        if status:
            try:
                es = ExperienceStatus(status)
                q = q.filter(Experience.status == es)
            except ValueError:
                pass
        total = q.count()
        rows = q.order_by(desc(Experience.created_at)).offset(
            (page - 1) * page_size
        ).limit(page_size).all()
        return [r.to_dict() for r in rows], total
    finally:
        db.close()


def update_experience(exp_id: int, **kwargs) -> Experience | None:
    db = SessionLocal()
    try:
        exp = db.query(Experience).filter(Experience.id == exp_id).first()
        if not exp:
            return None
        for key, value in kwargs.items():
            if hasattr(exp, key) and value is not None:
                if key == "status" and isinstance(value, str):
                    value = ExperienceStatus(value)
                setattr(exp, key, value)
        db.commit()
        db.refresh(exp)
        return exp
    finally:
        db.close()


def delete_experience(exp_id: int) -> bool:
    db = SessionLocal()
    try:
        exp = db.query(Experience).filter(Experience.id == exp_id).first()
        if not exp:
            return False
        user_id = exp.user_id
        db.delete(exp)
        db.commit()
        try:
            asyncio.ensure_future(_remove_experience_from_rag(exp_id, user_id))
        except RuntimeError:
            pass  # no event loop running
        return True
    finally:
        db.close()
