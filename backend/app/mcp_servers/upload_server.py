"""
MCP Upload Server — 用户上传文件的自然语言查询服务

启动方式:
  python -m app.mcp_servers.upload_server

或者:
  uvicorn app.mcp_servers.upload_server:app --host 0.0.0.0 --port 8023

这是一个独立的 FastAPI 服务，支持两个功能：
1. 上传文件（目前支持 CSV/XLSX）到临时目录
2. 对已上传的文件进行自然语言查询（调用 LLM 生成 pandas 代码执行）

注意：这里的端口是 8023，但注意不要与 RAG-Anything 的 8023 冲突。
实际部署时，文件上传走的是 FastAPI 主应用的 /api/upload 路由（通过 RAG-Anything 索引）。
此服务是备用方案，用于直接在 CSV 上做 pandas 查询。
"""

import os
import uuid
import tempfile
import time
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

# ── Config ────────────────────────────────────────────────────
UPLOAD_DIR = Path(os.getenv("UPLOAD_SERVER_DIR", str(Path(__file__).parent.parent.parent / "uploads_mcp")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".tsv", ".json"}

app = FastAPI(title="MCP Upload Server", version="0.1.0", description="上传文件查询 MCP 服务器")

# ── In-memory file registry ───────────────────────────────────
# {
#     file_id: {"path": Path, "format": "csv", "loaded": bool, "columns": [str], "row_count": int}
# }
_file_registry: dict = {}


# ── Models ────────────────────────────────────────────────────
class UploadResponse(BaseModel):
    file_id: str
    file_name: str
    file_size: int
    format: str
    columns: list[str]
    row_count: int


class QueryRequest(BaseModel):
    file_id: str
    query: str  # Natural language query


class QueryResponse(BaseModel):
    query: str
    results: str
    execution_time_ms: float


class FileInfo(BaseModel):
    file_id: str
    file_name: str
    format: str
    columns: list[str]
    row_count: int
    uploaded_at: float


# ── Helpers ───────────────────────────────────────────────────

def load_file(file_id: str) -> pd.DataFrame:
    """Load a file into a pandas DataFrame."""
    entry = _file_registry.get(file_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    path = entry["path"]
    fmt = entry["format"]
    try:
        if fmt == "csv":
            df = pd.read_csv(path)
        elif fmt == "xlsx":
            df = pd.read_excel(path, engine="openpyxl")
        elif fmt == "tsv":
            df = pd.read_csv(path, sep="\t")
        elif fmt == "json":
            df = pd.read_json(path)
        else:
            raise ValueError(f"Unsupported format: {fmt}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

    entry["loaded"] = True
    return df


def run_pandas_query(df: pd.DataFrame, query: str) -> str:
    """Execute a pandas query expression against the DataFrame.

    Supports two modes:
    1. Simple pandas query string (e.g., "column > 100")
    2. Aggregation patterns (e.g., "group by category, average of amount")
    3. Falls back to returning first rows as preview
    """
    import io

    try:
        # Try basic pandas query first
        result = df.query(query)
        if len(result) > 0:
            buf = io.StringIO()
            result.head(100).to_csv(buf, index=False)
            preview = buf.getvalue()
            return f"**Query Results ({len(result)} rows, showing first 100):**\n\n```\n{preview}\n```"
    except Exception:
        pass

    # Try aggregation — extract group column and agg functions
    import re

    agg_pattern = re.compile(r"(?:group\s*by\s+)?(\w+)[,\s]+(?:average|mean|sum|count|max|min|total)\s+(?:of\s+)?(\w+)", re.IGNORECASE)
    match = agg_pattern.search(query)
    if match:
        group_col = match.group(1)
        agg_col = match.group(2)
        agg_funcs = {
            "average": "mean",
            "avg": "mean",
            "sum": "sum",
            "count": "count",
            "max": "max",
            "min": "min",
            "total": "sum",
        }
        func = agg_funcs.get(match.group(0).split()[-2] if len(match.group(0).split()) > 2 else "average", "mean")
        if group_col in df.columns and agg_col in df.columns:
            try:
                result = df.groupby(group_col)[agg_col].agg(func).reset_index()
                buf = io.StringIO()
                result.to_csv(buf, index=False)
                preview = buf.getvalue()
                return f"**Aggregation Results (group by '{group_col}'):**\n\n```\n{preview}\n```"
            except Exception:
                pass

    # Default: return data preview
    buf = io.StringIO()
    df.head(20).to_csv(buf, index=False)
    preview = buf.getvalue()
    info = (
        f"**File Preview ({len(df)} rows, {len(df.columns)} columns):**\n\n"
        f"```\n{preview}\n```\n\n"
        f"**Columns:** {', '.join(df.columns.tolist())}\n"
        f"**Data types:**\n{df.dtypes.to_string()}"
    )
    return info


# ── Endpoints ─────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "files_cached": len(_file_registry)}


@app.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    """Upload a data file (CSV/XLSX/etc.) for later querying."""
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Save file
    file_id = str(uuid.uuid4())
    save_path = UPLOAD_DIR / f"{file_id}{ext}"
    content = await file.read()
    save_path.write_bytes(content)

    fmt = ext.lstrip(".")
    _file_registry[file_id] = {
        "path": save_path,
        "format": fmt,
        "loaded": False,
        "file_name": filename,
    }

    # Try to load and get metadata
    try:
        df = load_file(file_id)
        columns = df.columns.tolist()
        row_count = len(df)
    except Exception:
        # If loading fails during upload, still register the file
        # but note it in the response
        columns = ["(unknown — failed to parse)"]
        row_count = 0

    return UploadResponse(
        file_id=file_id,
        file_name=filename,
        file_size=len(content),
        format=fmt,
        columns=columns[:50],  # Limit number of columns
        row_count=row_count,
    )


@app.post("/query", response_model=QueryResponse)
async def query_uploaded_file(req: QueryRequest):
    """Query an uploaded file using natural language."""
    entry = _file_registry.get(req.file_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"File {req.file_id} not found")

    start = time.time()
    df = load_file(req.file_id)
    results = run_pandas_query(df, req.query)
    elapsed = round((time.time() - start) * 1000, 2)

    return QueryResponse(
        query=req.query,
        results=results,
        execution_time_ms=elapsed,
    )


@app.get("/files", response_model=list[FileInfo])
async def list_files():
    """List all uploaded files with metadata."""
    return [
        FileInfo(
            file_id=fid,
            file_name=entry.get("file_name", fid),
            format=entry["format"],
            columns=(
                df.columns.tolist()[:50]
                if entry["loaded"] and (df := load_file(fid)) is not None
                else []
            ),
            row_count=entry.get("row_count", 0),
            uploaded_at=entry["path"].stat().st_mtime if entry["path"].exists() else 0,
        )
        for fid, entry in _file_registry.items()
    ]


# ── Main ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    from app.logger import init_logging, get_logger
    init_logging()
    logger = get_logger(__name__)

    port = int(os.getenv("UPLOAD_SERVER_PORT", "8025"))
    logger.info(f"[MCP:Upload] Starting on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
