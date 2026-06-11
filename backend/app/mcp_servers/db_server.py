"""
MCP Database Server — 部门数据库只读查询服务

启动方式:
  python -m app.mcp_servers.db_server

或者:
  uvicorn app.mcp_servers.db_server:app --host 0.0.0.0 --port 8024

这是一个独立的 FastAPI 服务，被 agent 的 tools.py 中的 query_db / list_db_tables 调用。
所有查询都是只读的，并有安全过滤。
"""

import asyncio
import os
import re
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# Load .env from the backend project root
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

import sqlalchemy
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import create_engine, text

# ── Database config from env ──────────────────────────────────
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "zhiwei")

DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"

# ── Safe query patterns ───────────────────────────────────────
SAFE_SELECT_RE = re.compile(
    r"^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN|WITH)\s",
    re.IGNORECASE | re.DOTALL,
)
FORBIDDEN_KEYWORDS = re.compile(
    r"\b(DROP|ALTER|DELETE|INSERT|UPDATE|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)\b",
    re.IGNORECASE,
)

# ── Table definitions for known categories ────────────────────
CATEGORY_TABLES = {
    "设备": ["equipment"],
    "事件": ["event"],
    "人事": ["员工表", "employee_info", "人事变更记录", "考勤表"],
    "财务": ["财务表", "budget_records", "expense_details", "invoice_records"],
    "all": [],
}

# ── FastAPI app ───────────────────────────────────────────────
app = FastAPI(title="MCP DB Server", version="0.1.0", description="只读数据库查询 MCP 服务器")

# Engine will be lazily created on first request
_engine = None


def get_engine():
    global _engine
    if _engine is None:
        try:
            _engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
        except Exception as e:
            raise RuntimeError(f"Failed to create database engine: {e}")
    return _engine


# ── Models ────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    sql_query: str
    data_category: str = "all"


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[list]
    row_count: int
    execution_time_ms: float


class TableInfo(BaseModel):
    table_name: str
    row_count: int
    description: str = ""


class TablesRequest(BaseModel):
    data_category: str = "all"


class TablesResponse(BaseModel):
    tables: list[TableInfo]


# ── Security helpers ──────────────────────────────────────────

def validate_sql(sql: str) -> str:
    """Validate and sanitize a SQL query. Returns the normalized query or raises."""
    sql_stripped = sql.strip()

    if not SAFE_SELECT_RE.match(sql_stripped):
        raise HTTPException(
            status_code=400,
            detail=f"Only SELECT/SHOW/DESCRIBE queries are allowed. Got: {sql_stripped[:100]}",
        )
    if FORBIDDEN_KEYWORDS.search(sql_stripped):
        raise HTTPException(
            status_code=400,
            detail="Write operations (DROP/ALTER/DELETE/INSERT/UPDATE/CREATE/TRUNCATE) are not allowed.",
        )

    # Limit query length to prevent abuse
    if len(sql_stripped) > 10_000:
        raise HTTPException(status_code=400, detail="Query too long (max 10,000 chars)")

    return sql_stripped


# ── Endpoints ─────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check — verifies DB connection is alive."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "database": DB_NAME, "host": DB_HOST}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.post("/query", response_model=QueryResponse)
async def query_database(req: QueryRequest):
    """Execute a read-only SQL query and return results as structured data."""
    sql = validate_sql(req.sql_query)
    import time

    engine = get_engine()
    start = time.time()

    try:
        with engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [list(row) for row in result.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query execution failed: {str(e)}")

    elapsed = round((time.time() - start) * 1000, 2)

    return QueryResponse(
        columns=columns,
        rows=rows,
        row_count=len(rows),
        execution_time_ms=elapsed,
    )


@app.post("/tables", response_model=TablesResponse)
async def list_tables(req: TablesRequest):
    """List available tables in the database, optionally filtered by data category."""
    engine = get_engine()

    try:
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    """
                    SELECT TABLE_NAME, TABLE_ROWS
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = :db_name
                    ORDER BY TABLE_NAME
                    """
                ),
                {"db_name": DB_NAME},
            )
            all_tables = {row[0]: row[1] for row in result.fetchall()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cannot list tables: {str(e)}")

    # Filter by category if specified
    if req.data_category != "all":
        allowed = CATEGORY_TABLES.get(req.data_category, [])
        # If no explicit mapping, try to match by name pattern
        if not allowed:
            allowed = [
                t for t in all_tables
                if req.data_category in t.lower().replace("_", "")
            ]
    else:
        allowed = list(all_tables.keys())

    tables = [
        TableInfo(
            table_name=name,
            row_count=int(all_tables.get(name, 0)),
            description=f"Table in database '{DB_NAME}'",
        )
        for name in allowed
    ]

    return TablesResponse(tables=tables)


# ── Main ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    from app.logger import init_logging, get_logger
    init_logging()

    port = int(os.getenv("MCP_SERVER_PORT", "8024"))
    logger = get_logger(__name__)
    logger.info(f"[MCP:DB] Starting on http://0.0.0.0:{port}")
    logger.info(f"[MCP:DB] Target database: {DB_HOST}:{DB_PORT}/{DB_NAME}")
    uvicorn.run(app, host="0.0.0.0", port=port)
