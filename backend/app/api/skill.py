import hashlib
import json
import re
import yaml

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import SessionLocal
from app.models.skill import Skill

router = APIRouter()

# ── Request models ──

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


# ── Content parser ──

def _parse_content(content: str) -> dict:
    """Parse unified markdown content into structured parts.

    Extracts:
      - description: from YAML frontmatter or first heading
      - body: main workflow section (≤100 lines)
      - references: detailed docs after a "## 参考" / "## Reference" heading
      - scripts: Python code blocks as [{name, code, entry, timeout}]
    """
    result: dict = {
        "description": "",
        "body": "",
        "references": None,
        "scripts": None,
    }

    text = content.strip()

    # 1. Extract YAML frontmatter (--- ... ---)
    frontmatter: dict = {}
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            try:
                frontmatter = yaml.safe_load(text[3:end]) or {}
            except Exception:
                pass
            text = text[end + 3:].strip()

    result["description"] = frontmatter.get("description", "")

    # 2. Extract Python code blocks → scripts
    # Capture optional "### script_name.py" heading before code block
    code_block_pat = re.compile(
        r'(?:###\s+(\S+)\s*\n)?^```python\s*\n(.*?)^```',
        re.MULTILINE | re.DOTALL,
    )
    code_blocks = code_block_pat.findall(text)
    if code_blocks:
        scripts = []
        for i, (heading_name, code) in enumerate(code_blocks):
            code_clean = code.strip()
            if not code_clean:
                continue
            # Prefer heading name, fall back to guessing from code
            name = heading_name.strip() if heading_name else _guess_script_name(code_clean, i)
            scripts.append({
                "name": name,
                "code": code_clean,
                "entry": i == 0,
                "timeout": 60,
            })
        if scripts:
            result["scripts"] = scripts
        # Remove code blocks from text (keep placeholder)
        _replace_idx = [0]

        def _replace_block(m):
            heading = m.group(1) or ''
            name = heading.strip() if heading else _guess_script_name(m.group(2).strip(), _replace_idx[0])
            _replace_idx[0] += 1
            return f'*（脚本 {name} 已提取，可通过 run_skill_script 执行）*\n'

        text = code_block_pat.sub(_replace_block, text)

    # 3. Split body vs references
    ref_pat = re.compile(r'^##\s*(参考|Reference|参考资料|详细说明|详细参考)', re.MULTILINE)
    ref_match = ref_pat.search(text)
    if ref_match:
        result["body"] = text[:ref_match.start()].strip()
        result["references"] = text[ref_match.start():].strip()
    else:
        body = text.strip()
        # Enforce ≤100 lines for body
        lines = body.split("\n")
        if len(lines) > 100:
            result["body"] = "\n".join(lines[:100]).strip()
            result["references"] = "\n".join(lines[100:]).strip()
        else:
            result["body"] = body

    # 4. Extract description from first heading if not in frontmatter
    if not result["description"]:
        for line in result["body"].split("\n"):
            if line.startswith("# ") and not line.startswith("## "):
                result["description"] = line[2:].strip()
                break

    return result


def _guess_script_name(code: str, idx: int) -> str:
    """Guess a script filename from code content or return default."""
    for line in code.split("\n"):
        line_s = line.strip()
        if line_s.startswith("# ") and ("py" in line_s or "脚本" in line_s):
            return line_s.lstrip("# ").strip().replace(" ", "_") + ".py"
    return f"script_{idx}.py"


# ── API routes ──

@router.get("")
def list_skills() -> list[dict]:
    db = SessionLocal()
    try:
        rows = db.query(Skill).order_by(Skill.created_at.desc()).all()
        return [r.to_dict() for r in rows]
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

    parsed = _parse_content(content)

    db = SessionLocal()
    try:
        row = Skill(
            title=title,
            description=parsed["description"] or "",
            content=content,
            body=parsed["body"] or "",
            references=parsed["references"],
            scripts=parsed["scripts"],
            created_by=payload.created_by or "admin",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.to_dict()
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
            parsed = _parse_content(content)
            row.content = content
            row.description = parsed["description"] or row.description
            row.body = parsed["body"] or ""
            row.references = parsed["references"]
            row.scripts = parsed["scripts"]

        db.commit()
        db.refresh(row)
        return row.to_dict()
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
    """Call LLM to generate structured skill specification from title + requirements."""
    title = payload.title.strip()
    requirement = payload.requirement.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be empty")
    if not requirement:
        raise HTTPException(status_code=422, detail="Requirement cannot be empty")

    prompt = f"""你是一个专业的 Claude Code 技能创建器。请根据用户需求，生成一个结构化的技能文件。

技能名称：{title}
用户需求：{requirement}

请严格按以下 JSON 格式输出，不要输出任何其他内容：

```json
{{
  "body": "# 技能工作流程\\n\\n## 触发条件\\n...\\n\\n## 执行步骤\\n...",
  "references": "## 参考\\n\\n详细的参考文档...（可选，null 表示无）",
  "scripts": [
    {{
      "name": "main.py",
      "code": "import pandas as pd\\n...",
      "entry": true,
      "timeout": 60
    }}
  ]
}}
```

规则：
1. **body**: 核心工作流程，≤100 行。包含触发条件、执行步骤、注意事项。简要精炼。
2. **references**: 详细参考文档（可选）。放 body 放不下的细节、示例、边界情况说明。不需要时填 null。
3. **scripts**: 可执行的 Python 脚本列表（可选）。不需要时填 []。每个脚本包含：
   - name: 脚本文件名
   - code: 完整可执行的 Python 代码（使用 print() 输出结果）
   - entry: 是否入口脚本（只有一个为 true）
   - timeout: 超时秒数（默认 60）
4. body 中如果需要引用脚本，写 "调用 run_skill_script 执行 {name}"。
5. 脚本已有预装库：pandas, numpy, matplotlib, plotly, openpyxl, tabulate。不要用需要网络下载的包。

只输出 JSON，不要加 markdown 代码块标记。"""

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
                {"role": "system", "content": "你是一个专业的技能创建器。只输出 JSON，不要加任何标记或说明。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=4096,
        )

        raw_output = (response.choices[0].message.content or "").strip()

        # Strip markdown code fences if present
        if raw_output.startswith("```"):
            raw_output = re.sub(r'^```(?:json)?\s*\n', '', raw_output)
            raw_output = re.sub(r'\n```\s*$', '', raw_output)

        parsed = _parse_llm_output(raw_output)

        body = parsed.get("body", "").strip()
        references = parsed.get("references") or None
        if references and isinstance(references, str):
            references = references.strip() or None
        scripts = parsed.get("scripts") or []

        # Normalize scripts
        normalized_scripts = []
        if isinstance(scripts, list):
            for s in scripts:
                if isinstance(s, dict) and s.get("code"):
                    normalized_scripts.append({
                        "name": s.get("name", f"script_{len(normalized_scripts)}.py"),
                        "code": s["code"],
                        "entry": bool(s.get("entry", len(normalized_scripts) == 0)),
                        "timeout": int(s.get("timeout", 60)),
                    })

        # Assemble unified content for frontend
        content_parts = []
        content_parts.append(f"---\nname: {title}\ndescription: {requirement}\n---\n")
        content_parts.append(body)
        if references:
            content_parts.append("\n")
            content_parts.append(references)
        if normalized_scripts:
            content_parts.append("\n## 脚本\n")
            for s in normalized_scripts:
                content_parts.append(f"### {s['name']}\n```python\n{s['code']}\n```\n")
        content = "\n".join(content_parts)

        # Description from requirement (truncated for display)
        description = requirement.strip().split("\n")[0]
        if len(description) > 200:
            description = description[:200] + "..."

        return {
            "ok": True,
            "content": content,
            "description": description,
            "body": body,
            "references": references,
            "scripts": normalized_scripts,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Skill generation failed: {str(e)}")


def _parse_llm_output(raw: str) -> dict:
    """Parse LLM output into structured dict. Tries JSON first, falls back to regex extraction."""
    try:
        return json.loads(raw)
    except Exception:
        pass

    # Fallback: try to extract JSON from the middle of text
    m = re.search(r'\{.*\}', raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass

    return {}
