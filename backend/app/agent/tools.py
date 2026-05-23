"""
Tools for the department Q&A Agent.
Three core data retrieval tools:
  - query_rag:          Search uploaded documents via local RAG engine
  - query_db:           Query structured data via DatabaseService (read-only SQL)
  - list_db_tables:     List available tables for a connection
  - list_db_connections: List all connected databases

All tools honour kb_scope / db_scope permissions set by admin in user management.
"""
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


# ============================================================
# Tool 1: query_rag — Local RAG document search
# ============================================================

async def query_rag(query_text: str, category: str = "", top_k: int = 5,
                    user_id: str = "default", kb_scope: str = "personal") -> str:
    """Search uploaded documents via the local RAG engine (user-isolated).

    kb_scope controls which documents are visible:
      - "public":  personal docs + public docs (admin-granted)
      - "none":    personal docs only (default, admin didn't grant public)
    Personal knowledge base is ALWAYS accessible — kb_scope only controls
    whether public documents are added on top.
    """
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


# ============================================================
# Tool 2: list_db_connections — Discover available databases
# ============================================================

def _check_db_access(connection_id: int, db_scope: list[int] | None) -> bool:
    """Return True if connection_id is within the allowed db_scope."""
    if db_scope is None:
        return True
    return connection_id in db_scope


async def list_db_connections(db_scope: list[int] | None = None) -> str:
    """List all connected databases available for querying.

    Returns each connection's ID, name, environment (test/production), table name,
    and status. Use this FIRST before querying any database to discover which
    connections are available.

    db_scope filters which connections are visible:
      - None:  all connections (no restriction)
      - []:    access denied
      - [1,2]: only connections with IDs 1 and 2
    """
    # --- Enforce db_scope ---
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

        # Filter by db_scope if set
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


# ============================================================
# Tool 3: list_db_tables — List tables for a connection
# ============================================================

async def list_db_tables(connection_id: int,
                         db_scope: list[int] | None = None) -> str:
    """List all tables available in a specific database connection.

    Use this to discover table names and their fields before writing SQL queries.

    Args:
        connection_id: The database connection ID (from list_db_connections)
        db_scope:      Allowed connection IDs (None = all allowed)
    """
    # --- Enforce db_scope ---
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

        # Also show cached fields for the configured table
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


# ============================================================
# Tool 4: query_db — Execute read-only SQL
# ============================================================

async def query_db(sql_query: str, connection_id: int,
                   db_scope: list[int] | None = None) -> str:
    """Execute a read-only SQL query on a specific database connection.

    Args:
        sql_query: A read-only SQL query to execute (SELECT, SHOW, DESCRIBE, EXPLAIN)
        connection_id: The database connection ID (from list_db_connections)
        db_scope: Allowed connection IDs (None = all allowed)
    """
    # --- Enforce db_scope ---
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

        # Format as markdown table
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


# ============================================================
# Tool registry
# ============================================================

TOOL_FUNCTIONS: dict[str, callable] = {
    "query_rag": query_rag,
    "list_db_connections": list_db_connections,
    "list_db_tables": list_db_tables,
    "query_db": query_db,
}

TOOL_SCHEMAS: list[dict] = [
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
        elif name in ("list_db_connections", "list_db_tables", "query_db"):
            kwargs["db_scope"] = db_scope
        result = await func(**kwargs)
        return result
    except Exception as e:
        return f"[Tool Error: {name}] {str(e)}"
