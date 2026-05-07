"""
Tools for the department Q&A Agent.
Two core data retrieval tools:
  - query_rag:        Search uploaded documents via local RAG engine (supports category filtering)
  - query_db:         Query structured data via MCP server (read-only SQL)

No langchain dependency -- plain functions with JSON schemas.
All functions are async to accommodate async RAG engine.
"""

from typing import Any, Optional
import httpx
import json
import asyncio

from app.config import settings
from app.rag_engine import rag


# ============================================================
# Tool 1: query_rag -- Local RAG document search
# ============================================================

async def query_rag(query_text: str, category: str = "", top_k: int = 5) -> str:
    """Search uploaded documents via the local RAG engine.

    Use this when the user's question relates to content in uploaded files (PDF, Word, Excel, etc.).
    The system has already indexed all uploaded documents; just pass the question as query_text.

    The '上传文件' (uploaded files) category contains all user-uploaded documents. When the user
    asks about a file they uploaded, use category="上传文件" to search only uploaded documents.

    Args:
        query_text: The natural language question or search query
        category: Optional category filter (e.g., "上传文件" to search only uploaded documents,
                  "设备" for equipment docs, "人事" for personnel docs). Empty string = all categories.
        top_k: Number of relevant document chunks to return (default 5)

    Returns:
        A formatted string with retrieved document snippets and their sources.
    """
    category_param = category if category else None

    try:
        results = await rag.search(query_text, category=category_param, top_k=top_k)
        has_results = bool(results)

        # Fallback to keyword search if semantic search returned nothing
        if not results:
            results = await rag.search_text(query_text, category=category_param, top_k=top_k)

        if not results:
            if category:
                return f"No relevant content found in the '{category}' category documents."
            return "No relevant document content found in the uploaded files."

        # Format results as readable text with source citations
        formatted_parts = [f"**Document Search Results ({len(results)} chunks):**\n"]
        for i, chunk in enumerate(results[:top_k], 1):
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
# Tool 2: query_db -- Database query via MCP server
# ============================================================

async def query_db(sql_query: str, data_category: str = "all") -> str:
    """Query the department database via MCP server (read-only access).

    Use this when the user's question requires structured data from MySQL tables.
    The MCP server enforces read-only access and validates SQL queries for safety.

    Args:
        sql_query: A read-only SQL query to execute
        data_category: Category hint ('equipment', 'personnel', 'finance', or 'all')
    Returns:
        Query results formatted as a markdown table, or an error message.
    """
    mcp_base = settings.mcp_server_base or "http://localhost:8024"

    payload = {
        "sql_query": sql_query,
        "data_category": data_category,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{mcp_base}/query", json=payload)
            if resp.status_code != 200:
                return f"[MCP Server Error] HTTP {resp.status_code}: {resp.text[:500]}"

            data = resp.json()
        rows = data.get("rows", [])
        columns = data.get("columns", [])
        row_count = data.get("row_count", len(rows))

        if not rows:
            return f"No data returned. Query executed successfully but found {row_count} rows."

        # Format as markdown table
        header = "| " + " | ".join(columns) + " |\n"
        separator = "| " + " | ".join(["---"] * len(columns)) + " |\n"
        body_lines = []
        for row in rows:
            body_lines.append("| " + " | ".join(str(v) if v is not None else "" for v in row) + " |")

        result = (
            f"**Database Query Results ({row_count} rows):**\n\n"
            f"{header}{separator}"
            + "\n".join(body_lines[:50])  # Limit to 50 rows preview
        )
        if row_count > 50:
            result += f"\n\n*(Showing first 50 of {row_count} rows)*"
        return result

    except httpx.TimeoutException:
        return "[MCP Server] Request timed out. The service may be unavailable."
    except Exception as e:
        return f"[MCP Server Error] {str(e)}"


async def list_db_tables(data_category: str = "all") -> str:
    """List available database tables for a given data category."""
    mcp_base = settings.mcp_server_base or "http://localhost:8024"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{mcp_base}/tables", json={"data_category": data_category})
            if resp.status_code != 200:
                return f"[MCP Server Error] HTTP {resp.status_code}: {resp.text[:500]}"

        tables = resp.json().get("tables", [])
        if not tables:
            return "No tables found for this category."
        lines = [f"**Tables in '{data_category}':**\n"]
        for t in tables:
            name = t.get("table_name", "")
            row_count = t.get("row_count", 0)
            desc = t.get("description", "")
            lines.append(f"- `{name}` ({row_count} rows) {f'-- {desc}' if desc else ''}")
        return "\n".join(lines)

    except Exception as e:
        return f"[MCP Server] Could not list tables: {str(e)}"


# ============================================================
# Tool registry -- functions + JSON schemas for OpenAI-style tool calling
# ============================================================

TOOL_FUNCTIONS: dict[str, callable] = {
    "query_rag": query_rag,
    "query_db": query_db,
    "list_db_tables": list_db_tables,
}

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "query_rag",
            "description": "Search uploaded documents via the local RAG engine. Call this FIRST for EVERY user question — even if you think you already know the answer, because uploaded documents may contain the most current/correct information. Use when the user asks about: uploaded file content, document knowledge, policies, manuals, workflows, or any topic that might have been documented in uploaded files. If the first query returns nothing, try rephrasing the query text and call again.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query_text": {
                        "type": "string",
                        "description": "The natural language question or search query"
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category filter (e.g., '上传文件' for uploaded documents, '设备' for equipment, '人事' for personnel). Empty = all categories.",
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
            "name": "query_db",
            "description": "Query the department database via MCP server (read-only SQL). Use for structured data: equipment, events, personnel headcount, budget, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql_query": {
                        "type": "string",
                        "description": "A read-only SQL SELECT query to execute"
                    },
                    "data_category": {
                        "type": "string",
                        "description": "Category hint: '设备' for equipment, '事件' for events, '人事' for personnel, '财务' for finance, or 'all'",
                        "default": "all"
                    }
                },
                "required": ["sql_query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_db_tables",
            "description": "List available database tables for a given data category. Call this first before query_db to discover table names and schemas.",
            "parameters": {
                "type": "object",
                "properties": {
                    "data_category": {
                        "type": "string",
                        "description": "Category hint: '设备' for equipment, '事件' for events, '人事' for personnel, '财务' for finance, or 'all'",
                        "default": "all"
                    }
                },
                "required": []
            }
        }
    },
]


def get_schemas() -> list[dict]:
    """Get tool schemas for OpenAI tool-calling API."""
    return TOOL_SCHEMAS


async def execute_tool(name: str, **kwargs) -> str:
    """Execute a tool function by name with given arguments.

    All tool functions are async.

    Args:
        name: Tool function name (key in TOOL_FUNCTIONS)
        **kwargs: Arguments to pass to the tool function

    Returns:
        The tool's output as a string.
    """
    func = TOOL_FUNCTIONS.get(name)
    if func is None:
        return f"[Unknown tool: {name}]"

    try:
        result = await func(**kwargs)
        return result
    except Exception as e:
        return f"[Tool Error: {name}] {str(e)}"
