from __future__ import annotations

import json
import hashlib
import asyncio
import re
from datetime import datetime, timedelta
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


def _compute_recency_weight(created_at, last_accessed) -> float:
    """Calculate recency score (0-1). 90-day linear decay, floor at 0.3."""
    ref_date = last_accessed or created_at
    if ref_date is None:
        return 0.5
    days = (datetime.now() - ref_date).days
    return max(0.3, 1.0 - days / 90.0)


async def _check_semantic_duplicate(content: str, user_id: str) -> Optional[Experience]:
    """Check for near-duplicate by searching the experience vector index."""
    results = await _search_vector_only(content, user_id, top_k=1)
    if not results:
        return None

    top = results[0]
    # Parse title from indexed text (format: "标题: xxx\n内容: yyy\n标签: zzz")
    match = re.search(r'标题:\s*(.+?)(?:\n|$)', top["text"])
    if not match:
        return None
    title = match.group(1).strip()

    db = SessionLocal()
    try:
        exp = db.query(Experience).filter(
            Experience.user_id == user_id,
            Experience.title == title,
            Experience.status == ExperienceStatus.active,
        ).first()
        return exp
    finally:
        db.close()


async def _search_vector_only(
    query_text: str, user_id: str, top_k: int = 3,
) -> list[dict]:
    """Raw vector search without scoring, used internally for dedup."""
    try:
        from app.rag_engine import rag
        await rag._ensure_ready(f"exp_default")
        from lightrag.base import QueryParam

        lightrag = rag._rags[f"exp_default"].lightrag
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

        return [{"text": t.strip()} for t in content_parts if t.strip()]
    except Exception as e:
        print(f"[Experience] Vector search failed: {e}")
        return []


async def search_relevant(
    query_text: str,
    user_id: str,
    top_k: int | None = None,
) -> list[dict]:
    top_k = top_k or settings.experience_top_k

    # ── 1. Vector search ──
    vector_results = await _search_vector_only(query_text, user_id, top_k=top_k * 2)

    # ── 2. DB keyword search for recency / access boosts ──
    db = SessionLocal()
    try:
        keywords = query_text.strip().split()
        db_results: list[dict] = []
        if keywords:
            db_query = db.query(Experience).filter(
                Experience.user_id == user_id,
                Experience.status == ExperienceStatus.active,
            )
            keyword_filter = db_query.filter(
                db_query.column_descriptions[0] == db_query.column_descriptions[0]  # dummy, will rebuild
            )
            # Build OR conditions for keyword matching on title and content
            from sqlalchemy import or_
            conditions = []
            for kw in keywords[:3]:  # limit to 3 keywords
                conditions.append(Experience.title.contains(kw))
                conditions.append(Experience.content.contains(kw))
            if conditions:
                db_rows = db.query(Experience).filter(
                    Experience.user_id == user_id,
                    Experience.status == ExperienceStatus.active,
                    or_(*conditions),
                ).order_by(desc(Experience.last_accessed)).limit(top_k * 2).all()
                for row in db_rows:
                    recency = _compute_recency_weight(row.created_at, row.last_accessed)
                    access_score = min(1.0, row.access_count / 10.0)
                    db_results.append({
                        "text": f"标题: {row.title}\n内容: {row.content}",
                        "source": "历史经验",
                        "_recency": recency,
                        "_access": access_score,
                        "_exp_id": row.id,
                    })
    finally:
        db.close()

    # ── 3. Merge & composite score ──
    merged: dict[str, dict] = {}  # keyed by normalized text prefix

    for r in vector_results:
        key = r["text"][:80]
        r["_sim"] = 1.0  # vector hits get base similarity score
        r["_recency"] = 0.5
        r["_access"] = 0.0
        merged[key] = r

    for r in db_results:
        key = r["text"][:80]
        r["_sim"] = 0.7  # keyword hits get lower base similarity
        if key not in merged or r["_recency"] > merged[key].get("_recency", 0):
            merged[key] = r  # keep the match with better recency

    # ── 4. Score & rank ──
    scored = []
    for r in merged.values():
        sim = r.get("_sim", 0.5)
        recency = r.get("_recency", 0.5)
        access = r.get("_access", 0.0)
        composite = sim * 0.5 + recency * 0.3 + access * 0.2

        # Update access tracking for matched DB experiences
        exp_id = r.get("_exp_id")
        if exp_id:
            _bump_access(exp_id)

        # Clean internal keys
        out = {"text": r["text"], "source": r.get("source", "历史经验")}
        scored.append((composite, out))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [s[1] for s in scored[:top_k]]


def _bump_access(exp_id: int):
    """Increment access_count and update last_accessed for an experience."""
    db = SessionLocal()
    try:
        exp = db.query(Experience).filter(Experience.id == exp_id).first()
        if exp:
            exp.access_count = (exp.access_count or 0) + 1
            exp.last_accessed = datetime.now()
            db.commit()
    except Exception:
        pass
    finally:
        db.close()


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

            dup = await _check_semantic_duplicate(content, user_id)
            if dup:
                dup.confidence = min(1.0, dup.confidence + 0.05)
                dup.access_count = (dup.access_count or 0) + 1
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
