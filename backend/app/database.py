from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from app.config import settings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session, declarative_base
from app.logger import get_logger

logger = get_logger(__name__)

DATABASE_URL = (
    f"mysql+pymysql://{settings.db_user}:{settings.db_password}@{settings.db_host}:{settings.db_port}/{settings.db_name}"
    f"?charset=utf8mb4"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# ── Seeded skill content ────────────────────────────────────────────────

_OFFICIAL_DOCUMENT_SKILL_BODY = """\
## 公文格式排版技能

### 触发条件
当用户要求将内容整理为公文格式、生成正式公文/报告/通知，
或提到"公文格式""红头文件""正式文档""整理成公文"时调用此技能。

### 执行步骤

#### 1. 重组文档结构
将回答内容按以下层级重新组织为 markdown 格式：

- **文档标题**：用 `# 标题`（一级 markdown 标题）
- **一类标题**：用 `## 一、标题` 格式，序号用中文数字（一、二、三、…）
- **二类标题**：用 `### （一）标题` 格式，序号用中文数字加括号
- **三类标题**：用 `#### 1. 标题` 格式，序号用阿拉伯数字加点
- **四类标题**：用 `##### （1）标题` 格式，序号用阿拉伯数字加括号
- **正文段落**：普通文字，不加任何标题标记

#### 2. 标题与正文之间保留一个空行

#### 3. 生成 Word 文档（必须执行！）
重组完成后，**必须**调用 `run_skill_script` 将重组后的 markdown 内容转换为格式化的 .docx 文件：
```
run_skill_script(skill_name="公文格式", script_name="format_official_docx.py", content=重组后的完整markdown)
```
- `content` 参数必须是完整的 markdown 原文（包含所有标题和正文）
- 脚本会在沙箱中执行，自动应用公文格式（字体、缩进、行距、页边距）
- 执行成功后会生成下载链接，用户可下载 .docx 文件

#### 4. 完成后提示用户
告知用户：
"已按公文格式整理完毕，请下载 Word 文档查看。文档已自动应用公文排版（标题：方正小标宋简体，一类标题：黑体，二类标题：楷体，正文：仿宋）。"

### 重组示例

输入原文：
```
关于2024年度工作总结
一、工作完成情况
（一）重点项目
1.项目A
已经完成上线…
```

重组为：
```
# 关于2024年度工作总结

## 一、工作完成情况

### （一）重点项目

#### 1. 项目A

已经完成上线…
```

### 注意事项
- 不修改原始文字内容，只调整结构和层级
- 所有标题不加粗（字体加粗由导出端自动处理）
- 正文段落首行缩进由导出端处理，无需手动添加空格
- 如果用户仅要求下载，无需主动调用此技能。仅在用户明确要求公文格式时使用"""

_OFFICIAL_DOCUMENT_SKILL_REFERENCES = """\
## 参考：公文格式详细说明

### 字体对照表
| 中文字号 | 磅值(pt) | 适用场景 |
|----------|----------|----------|
| 二号 | 22pt | 文档标题（方正小标宋简体，居中） |
| 三号 | 16pt | 正文、各级标题 |

### 标题字体映射（由导出端自动应用）
| 标题层级 | Markdown | WORD字体 | 加粗 | 对齐 |
|----------|----------|----------|------|------|
| 文档标题 | `#` | 方正小标宋简体 | 否 | 居中 |
| 一类标题 | `##` | 黑体 | 否 | 左对齐 |
| 二类标题 | `###` | 楷体_GB2312 | 否 | 左对齐 |
| 三类标题 | `####` | 仿宋_GB2312 | 否 | 左对齐 |
| 四类标题 | `#####` | 仿宋_GB2312 | 否 | 左对齐 |
| 正文 | 段落 | 仿宋_GB2312 | 否 | 左对齐,首行缩进2字符 |

### 页面设置（导出时自动应用）
- 上/下边距：2.54cm
- 左/右边距：3.17cm
- 行间距：28 磅

### 边界情况
- 如果用户提供的内容已有 markdown 标题结构，只需调整编号格式使其符合公文规范
- 代码块和表格不参与公文排版，保留原样
- 如客户端未安装指定字体，Word 将使用默认字体回退渲染"""

def _load_skill_scripts() -> list[dict]:
    """Load skill script code from disk files."""
    import os as _os
    skills_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "skills")
    fmt_path = _os.path.join(skills_dir, "format_official_docx.py")
    code = ""
    if _os.path.exists(fmt_path):
        with open(fmt_path, "r", encoding="utf-8") as f:
            code = f.read()
    return [
        {
            "name": "format_official_docx.py",
            "code": code,
            "entry": True,
            "timeout": 30,
        }
    ]


_OFFICIAL_DOCUMENT_SKILL_SCRIPTS = _load_skill_scripts()

_OFFICIAL_DOCUMENT_SKILL_CONTENT = f"""---
name: 公文格式
description: 按中国公文标准格式化Word文档。Use when exporting documents, formatting reports, or 公文排版/红头文件.
---

{_OFFICIAL_DOCUMENT_SKILL_BODY}

{_OFFICIAL_DOCUMENT_SKILL_REFERENCES}

## 脚本

### format_official_docx.py
```python
{_OFFICIAL_DOCUMENT_SKILL_SCRIPTS[0]['code']}
```
"""


def _migrate():
    """Run schema migrations (call AFTER init_db creates tables)."""
    import sqlalchemy as sa
    with engine.connect() as conn:
        migrations = [
            "ALTER TABLE system_prompt ADD COLUMN title VARCHAR(128) NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN exp_extract_enabled TINYINT(1) NOT NULL DEFAULT 0",
            "ALTER TABLE experience MODIFY COLUMN status ENUM('pending','active','archived','deprecated') NOT NULL DEFAULT 'active'",
            # Migrate kb_scope: "personal" → "none" (personal KB is now always accessible)
            "UPDATE users SET kb_scope = 'none' WHERE kb_scope = 'personal'",
            "CREATE TABLE IF NOT EXISTS skills ("
            " id INT AUTO_INCREMENT PRIMARY KEY,"
            " title VARCHAR(128) NOT NULL,"
            " description VARCHAR(512) NOT NULL DEFAULT '',"
            " content TEXT NOT NULL,"
            " body TEXT NOT NULL,"
            " `references` TEXT,"
            " scripts JSON,"
            " created_by VARCHAR(64) NOT NULL DEFAULT 'admin',"
            " created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
            " updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            # Skill table schema evolution (safe to run even if first-time)
            "ALTER TABLE skills ADD COLUMN body TEXT",
            "ALTER TABLE skills ADD COLUMN `references` TEXT",
            "ALTER TABLE skills ADD COLUMN scripts JSON",
        ]
        for sql in migrations:
            try:
                conn.execute(sa.text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import app.models.user  # noqa: ensure model is registered
    import app.models.db_connection  # noqa: ensure model is registered
    import app.models.system_prompt  # noqa: ensure model is registered
    import app.models.experience  # noqa: ensure model is registered
    import app.models.skill  # noqa: ensure model is registered
    Base.metadata.create_all(bind=engine)
    _migrate()

    from app.models.system_prompt import SystemPrompt
    from app.agent.prompts import DEFAULT_SYSTEM_PROMPT
    db = SessionLocal()
    try:
        existing = db.query(SystemPrompt).filter(SystemPrompt.prompt_key == "default").first()
        if existing is None:
            db.add(SystemPrompt(
                prompt_key="default",
                title="系统默认",
                prompt_content=DEFAULT_SYSTEM_PROMPT,
            ))
            db.commit()
            logger.info("[DB:Init] Seeded '系统默认' (default) with system prompt")
        else:
            # Migrate old titles, fill empty content with current default
            updated = False
            if existing.title != "系统默认":
                existing.title = "系统默认"
                updated = True
            if not existing.prompt_content or not existing.prompt_content.strip():
                existing.prompt_content = DEFAULT_SYSTEM_PROMPT
                updated = True
            if updated:
                db.commit()
                logger.info("[DB:Init] Migrated existing default → '系统默认' (updated)")

        # Seed "公文格式" skill
        from app.models.skill import Skill
        official_skill = db.query(Skill).filter(Skill.title == "公文格式").first()
        if official_skill is None:
            db.add(Skill(
                title="公文格式",
                description="按中国公文标准（方正小标宋简体标题、仿宋GB2312正文、黑体/楷体标题）格式化Word文档。Use when user asks to format a document, export as official document, or mentions 公文格式/红头文件/正式文档.",
                content=_OFFICIAL_DOCUMENT_SKILL_CONTENT,
                body=_OFFICIAL_DOCUMENT_SKILL_BODY,
                references=_OFFICIAL_DOCUMENT_SKILL_REFERENCES,
                scripts=_OFFICIAL_DOCUMENT_SKILL_SCRIPTS,
                created_by="system",
            ))
            db.commit()
            logger.info("[DB:Init] Seeded '公文格式' skill")
        else:
            # Always refresh scripts from disk so code stays up-to-date
            official_skill.scripts = _OFFICIAL_DOCUMENT_SKILL_SCRIPTS
            official_skill.content = _OFFICIAL_DOCUMENT_SKILL_CONTENT
            official_skill.body = _OFFICIAL_DOCUMENT_SKILL_BODY
            official_skill.references = _OFFICIAL_DOCUMENT_SKILL_REFERENCES
            db.commit()
            logger.info("[DB:Init] Refreshed '公文格式' skill scripts")

        # Clean up legacy system_default key
        legacy = db.query(SystemPrompt).filter(SystemPrompt.prompt_key == "system_default").first()
        if legacy:
            db.delete(legacy)
            db.commit()
            logger.info("[DB:Init] Removed legacy system_default template")

        total = db.query(SystemPrompt).count()
        logger.info(f"[DB:Init] system_prompt table has {total} row(s)")
    except Exception as e:
        logger.error(f"[DB:Init] Seed failed: {e}")
    finally:
        db.close()
