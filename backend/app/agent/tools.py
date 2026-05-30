from __future__ import annotations
from typing import Any, Optional
import json
import asyncio

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.config import settings
from app.rag_engine import rag
from app.models.db_connection import DbConnection
from app.services import db_service
from app.services import experience_service
from pathlib import Path
import os


async def query_rag(query_text: str, category: str = "", top_k: int = 5,
                    user_id: str = "default", kb_scope: str = "personal") -> str:
    include_public = (kb_scope == "public")

    category_param = category if category else None

    async def _do_search(effective_user: str) -> list[dict]:
        results = await rag.search(query_text, category=category_param,
                                   top_k=top_k, user_id=effective_user)
        if not results:
            results = await rag.search_text(query_text, category=category_param,
                                            top_k=top_k, user_id=effective_user)
        return list(results) if results else []

    try:
        all_results = await _do_search(user_id)

        if include_public and user_id != "default":
            public_results = await _do_search("default")
            seen = {r.get("text", "") for r in all_results}
            for r in public_results:
                if r.get("text", "") not in seen:
                    all_results.append(r)
                    seen.add(r.get("text", ""))

        if not all_results:
            if category:
                return f"No relevant content found in the '{category}' category documents."
            return "No relevant document content found in the uploaded files."

        formatted_parts = [f"**Document Search Results ({len(all_results)} chunks):**\n"]
        for i, chunk in enumerate(all_results[:top_k], 1):
            text = chunk.get("text", "")
            source = chunk.get("file_name", "Unknown file")
            cat = chunk.get("category", "")
            score = chunk.get("score", 0)
            formatted_parts.append(
                f"[{i}] **Source:** {source} (category: {cat}, relevance: {score:.3f})\n    {text[:500]}"
            )
        return "\n\n".join(formatted_parts)

    except Exception as e:
        return f"[RAG Engine Error] {str(e)}"


def _check_db_access(connection_id: int, db_scope: list[int] | None) -> bool:
    if db_scope is None:
        return True
    return connection_id in db_scope


async def list_db_connections(db_scope: list[int] | None = None) -> str:
    if db_scope is not None and len(db_scope) == 0:
        return ("数据库查询已被管理员限制，您当前无权使用此功能。"
                "请联系管理员开通权限。")

    db: Session = SessionLocal()
    try:
        conns = db.query(DbConnection).filter(
            DbConnection.status == "connected"
        ).all()

        if not conns:
            return ("No connected databases found. "
                    "Ask the admin to add and connect databases in '数据库管理'.")

        visible = conns
        if db_scope is not None:
            visible = [c for c in conns if c.id in db_scope]

        if not visible:
            return ("No database connections available within your access scope. "
                    "Contact the admin to adjust permissions.")

        lines = ["**Available Database Connections:**\n"]
        for c in visible:
            env_label = "🔬测试" if c.environment == "test" else "🏭生产"
            fields_count = 0
            if c.table_fields:
                try:
                    fields_count = len(json.loads(c.table_fields))
                except Exception:
                    pass
            lines.append(
                f"- ID:{c.id} | {c.name} | {env_label} | 表: `{c.table_name}` "
                f"({fields_count} 字段) | {c.host}:{c.port}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"[Database Error] Could not list connections: {str(e)}"
    finally:
        db.close()


async def list_db_tables(connection_id: int,
                         db_scope: list[int] | None = None) -> str:
    if db_scope is not None and len(db_scope) == 0:
        return ("数据库查询已被管理员限制，您当前无权使用此功能。"
                "请联系管理员开通权限。")

    if not _check_db_access(connection_id, db_scope):
        return (f"Access denied: connection {connection_id} is not within "
                "your authorised database scope. "
                "Please use list_db_connections to see available databases.")

    db: Session = SessionLocal()
    try:
        conn = db.query(DbConnection).filter(DbConnection.id == connection_id).first()
        if not conn:
            return f"Connection ID {connection_id} not found."

        if conn.status != "connected":
            return f"Connection '{conn.name}' is not connected. Status: {conn.status}"

        result = db_service.list_tables(
            host=conn.host, port=conn.port,
            user=conn.db_user, password=conn.db_password,
        )

        if not result["success"]:
            return f"Could not list tables: {result.get('message', 'Unknown error')}"

        tables = result["tables"]
        if not tables:
            return f"No tables found in database '{conn.name}' ({conn.host}:{conn.port})."

        lines = [f"**Tables in '{conn.name}' ({conn.host}:{conn.port}):**\n"]
        for t in tables:
            lines.append(f"- `{t['database']}`.`{t['table']}`")

        if conn.table_fields:
            try:
                fields = json.loads(conn.table_fields)
                field_info = ", ".join(f"{f['name']} ({f['type']})" for f in fields)
                lines.append(f"\n**Table `{conn.table_name}` fields:** {field_info}")
            except Exception:
                pass

        return "\n".join(lines)
    except Exception as e:
        return f"[Database Error] {str(e)}"
    finally:
        db.close()


async def query_db(sql_query: str, connection_id: int,
                   db_scope: list[int] | None = None) -> str:
    if db_scope is not None and len(db_scope) == 0:
        return ("数据库查询已被管理员限制，您当前无权使用此功能。"
                "请联系管理员开通权限。")

    if not _check_db_access(connection_id, db_scope):
        return (f"Access denied: connection {connection_id} is not within "
                "your authorised database scope. "
                "Please use list_db_connections to see available databases.")

    db: Session = SessionLocal()
    try:
        conn = db.query(DbConnection).filter(DbConnection.id == connection_id).first()
        if not conn:
            return f"Connection ID {connection_id} not found."

        if conn.status != "connected":
            return f"Connection '{conn.name}' is not connected."

        result = db_service.execute_query(
            host=conn.host, port=conn.port,
            user=conn.db_user, password=conn.db_password,
            table_name=conn.table_name,
            sql_query=sql_query,
        )

        if not result["success"]:
            return f"Query failed: {result.get('message', 'Unknown error')}"

        data = result["data"]
        columns = result["columns"]

        if not data:
            return "Query executed successfully but returned no rows."

        header = "| " + " | ".join(columns) + " |\n"
        separator = "| " + " | ".join(["---"] * len(columns)) + " |\n"
        body_lines = []
        for row in data:
            body_lines.append("| " + " | ".join(
                str(row.get(c, "")) if row.get(c) is not None else "" for c in columns
            ) + " |")

        result_text = (
            f"**Database Query Results ({len(data)} rows):**\n\n"
            f"{header}{separator}"
            + "\n".join(body_lines[:50])
        )
        if len(data) > 50:
            result_text += f"\n\n*(Showing first 50 of {len(data)} rows)*"
        return result_text

    except ValueError as e:
        return f"[SQL Validation Error] {str(e)}"
    except Exception as e:
        return f"[Database Error] {str(e)}"
    finally:
        db.close()


async def find_file_by_name(keyword: str, user_id: str = "default") -> str:
    """Search uploaded files by name keyword, returning file content directly.

    Unlike RAG-based search, this tool bypasses vector search and reads
    the actual file contents. Use this when the prompt template explicitly
    specifies a particular file to look up (e.g., "if the user mentions
    turnover, look for 离职报告.pdf").

    The keyword is matched against file names case-insensitively as a
    substring search. The first matching file's content is returned.
    """
    from app.database import SessionLocal
    from app.models.user import User

    upload_dir = Path(settings.upload_dir)
    if not upload_dir.exists():
        return "未找到上传目录。"

    matches = []
    kw = keyword.lower().strip()
    for fpath in upload_dir.iterdir():
        if not fpath.is_file() or fpath.suffix == ".meta" or fpath.name.startswith("."):
            continue
        if kw in fpath.name.lower():
            original_name = fpath.name
            meta_path = upload_dir / f"{fpath.stem.rsplit('_', 1)[0] if '_' in fpath.stem else fpath.stem}.meta"
            if meta_path.exists():
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    original_name = meta.get("original_name", fpath.name)
                except Exception:
                    pass
            matches.append((fpath, original_name))

    if not matches:
        return f"未找到名称包含「{keyword}」的文件。"

    fpath, original_name = matches[0]

    try:
        ext = fpath.suffix.lower()
        if ext in (".txt", ".md", ".csv"):
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
        elif ext in (".xlsx", ".xls"):
            import openpyxl
            wb = openpyxl.load_workbook(str(fpath), data_only=True)
            lines = []
            for sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                lines.append(f"=== Sheet: {sheet_name} ===")
                for row in ws.iter_rows(values_only=True):
                    row_str = " | ".join(str(cell) if cell is not None else "" for cell in row)
                    if row_str.strip():
                        lines.append(row_str)
            content = "\n".join(lines)
            wb.close()
        elif ext == ".pdf":
            try:
                import pymupdf
                doc = pymupdf.open(str(fpath))
                pages = [page.get_text() for page in doc]
                content = "\n\n".join(pages)
                doc.close()
            except ImportError:
                return f"PDF 文件需安装 pymupdf 库才能读取：{original_name}"
        elif ext in (".docx", ".doc"):
            try:
                import docx
                doc = docx.Document(str(fpath))
                content = "\n".join(p.text for p in doc.paragraphs)
            except ImportError:
                return f"Word 文件需安装 python-docx 库才能读取：{original_name}"
        else:
            return f"暂不支持的文件类型：{ext}（{original_name}）"

        if not content or not content.strip():
            return f"文件「{original_name}」内容为空。"

        return (
            f"**文件：{original_name}**\n\n"
            f"{content[:3000]}"
            + (f"\n\n*(内容过长，已截断至前 3000 字符)*" if len(content) > 3000 else "")
        )
    except Exception as e:
        return f"读取文件「{original_name}」时出错：{str(e)}"


async def query_experience(query_text: str, top_k: int = 3,
                           user_id: str = "default") -> str:
    results = await experience_service.search_relevant(
        query_text=query_text, user_id=user_id, top_k=top_k
    )

    if not results:
        return "No relevant historical experiences found."

    lines = [f"**Historical Experiences ({len(results)} found):**\n"]
    for i, r in enumerate(results, 1):
        text = r.get("text", "")
        lines.append(f"[{i}] {text[:500]}")
    return "\n\n".join(lines)


async def use_skill(skill_name: str) -> str:
    """Look up a skill by name and return its specification for the agent to follow."""
    from app.database import SessionLocal
    from app.models.skill import Skill

    db = SessionLocal()
    try:
        row = db.query(Skill).filter(Skill.title == skill_name).first()
        if not row:
            # Try partial match
            row = db.query(Skill).filter(Skill.title.ilike(f"%{skill_name}%")).first()
        if not row:
            available = db.query(Skill.title).all()
            names = [r.title for r in available]
            if names:
                return f"未找到技能「{skill_name}」。可用技能：{', '.join(names)}"
            return f"未找到技能「{skill_name}」，且当前没有已配置的技能。"
        return (
            f"**技能：{row.title}**\n\n"
            f"{row.content}"
        )
    finally:
        db.close()


TOOL_FUNCTIONS: dict[str, callable] = {
    "query_rag": query_rag,
    "list_db_connections": list_db_connections,
    "list_db_tables": list_db_tables,
    "query_db": query_db,
    "query_experience": query_experience,
    "find_file_by_name": find_file_by_name,
    "use_skill": use_skill,
}

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "query_experience",
            "description": "Search historical experiences and knowledge accumulated from past conversations. These experiences are high-quality, user-verified knowledge. Use this when you want to see if similar questions have been answered before.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query_text": {
                        "type": "string",
                        "description": "The question or topic to search for in historical experiences"
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Number of experiences to return",
                        "default": 3
                    }
                },
                "required": ["query_text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_file_by_name",
            "description": "Search for a specific file by name keyword and return its full content. Use this when the prompt template explicitly instructs you to look for a particular file (e.g., 'if the user mentions turnover, find 离职报告.pdf'). This bypasses semantic search and reads the file directly — use it ONLY when a specific file name is mentioned, NOT for general topic searches.",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {
                        "type": "string",
                        "description": "File name keyword to search for (case-insensitive substring match). E.g. '离职报告' or '考勤制度.pdf'."
                    }
                },
                "required": ["keyword"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_rag",
            "description": "Search uploaded documents via the local RAG engine. Call this FIRST for EVERY user question — even if you think you already know the answer, because uploaded documents may contain the most current/correct information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query_text": {
                        "type": "string",
                        "description": "The natural language question or search query"
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category filter (e.g., '上传文件' for uploaded documents, '设备' for equipment). Empty = all.",
                        "default": ""
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Number of document chunks to return",
                        "default": 5
                    }
                },
                "required": ["query_text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_db_connections",
            "description": "List all connected database connections (both test and production). Call this FIRST when the user asks about database data, to discover available connections. Returns each connection's ID, name, environment, table name, and field count.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_db_tables",
            "description": "List all tables and fields for a specific database connection. Call after list_db_connections to explore the schema before writing SQL queries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {
                        "type": "integer",
                        "description": "The connection ID from list_db_connections"
                    }
                },
                "required": ["connection_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "use_skill",
            "description": "Look up and load a skill specification by name. Skills are predefined workflows created by the admin in the '技能工厂' page. Use this when the user's request matches a skill's purpose (e.g., generating reports, data analysis workflows, document processing). The skill content provides step-by-step instructions to follow.",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {
                        "type": "string",
                        "description": "The name/title of the skill to look up. Use partial matching if unsure."
                    }
                },
                "required": ["skill_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_db",
            "description": "Execute a read-only SQL query (SELECT, SHOW, DESCRIBE, EXPLAIN) on a specific database connection. Call list_db_connections first to get the connection ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql_query": {
                        "type": "string",
                        "description": "A read-only SQL SELECT/SHOW/DESCRIBE/EXPLAIN query"
                    },
                    "connection_id": {
                        "type": "integer",
                        "description": "The connection ID from list_db_connections"
                    }
                },
                "required": ["sql_query", "connection_id"]
            }
        }
    },
]


def get_schemas() -> list[dict]:
    """Get tool schemas for OpenAI tool-calling API."""
    return TOOL_SCHEMAS


async def execute_tool(name: str, user_id: str = "default",
                       kb_scope: str = "personal",
                       db_scope: list[int] | None = None,
                       default_category: str = "",
                       **kwargs) -> str:
    """Execute a tool function by name with given arguments.

    kb_scope / db_scope are forwarded to the individual tools so they can
    enforce the permissions configured by the admin in user management.

    default_category is used for query_rag when the LLM doesn't specify a
    category — typically set from the prompt template the user selected.
    """
    func = TOOL_FUNCTIONS.get(name)
    if func is None:
        return f"[Unknown tool: {name}]"

    try:
        if name == "query_rag":
            kwargs["user_id"] = user_id
            kwargs["kb_scope"] = kb_scope
            if not kwargs.get("category") and default_category:
                kwargs["category"] = default_category
        elif name == "query_experience":
            kwargs["user_id"] = user_id
        elif name == "find_file_by_name":
            kwargs["user_id"] = user_id
        elif name in ("list_db_connections", "list_db_tables", "query_db"):
            kwargs["db_scope"] = db_scope
        result = await func(**kwargs)
        return result
    except Exception as e:
        return f"[Tool Error: {name}] {str(e)}"
