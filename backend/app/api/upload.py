"""
File upload endpoint.

Two-step flow:
  1. Client uploads file -> FastAPI saves to uploads/ dir, returns file_id
  2. Backend indexes the file using RAGAnything (async)

Supported formats: PDF, DOCX, XLSX, TXT, CSV, MD (parsed by RAGAnything)
"""

import os
import uuid
import json
import asyncio
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.rag_engine import rag

router = APIRouter()


class UploadResponse(BaseModel):
    file_id: str
    file_name: str
    file_size: int
    file_type: str
    category: str
    uploaded_at: str
    rag_status: str  # "indexed" | "pending" | "failed"
    chunk_count: int = 0


class UploadListResponse(BaseModel):
    files: list[UploadResponse]


# Track indexed files in-memory (replace with DB later)
# This dictionary persists file metadata; on restart it's rebuilt by scanning uploads/
_indexed_files: dict[str, UploadResponse] = {}


def _rebuild_index_from_disk() -> dict[str, UploadResponse]:
    """Scan the uploads/ directory and rebuild _indexed_files from actual files on disk."""
    upload_dir = Path(settings.upload_dir)
    if not upload_dir.exists():
        return {}

    # Pre-load metadata from companion .meta files
    meta_files: dict[str, dict] = {}
    for meta_f in upload_dir.glob("*.meta"):
        try:
            with open(meta_f, "r", encoding="utf-8") as f:
                meta_files[meta_f.stem] = json.load(f)
        except Exception:
            pass

    rebuilt: dict[str, UploadResponse] = {}
    for fpath in upload_dir.iterdir():
        if not fpath.is_file():
            continue
        # Skip internal directories/files (hidden)
        if fpath.name.startswith("."):
            continue
        # Skip .meta files themselves
        if fpath.suffix == ".meta":
            continue
        # Extract file_id from the filename pattern: file-{uuid}_originalname.ext or file-{uuid}.ext
        fname = fpath.name
        if fname.startswith("file-") and "." in fname:
            # New format: file-XXX_originalname.ext → file_id = "file-XXX"
            # Old format: file-XXX.ext → file_id = "file-XXX"
            file_id = fname.rsplit(".", 1)[0]  # strip extension
            # If it has underscore after the uuid part, split off original filename
            # file_id is everything before the first underscore after "file-"
            parts = file_id.split("_", 1)
            if len(parts) > 1 and len(parts[0]) > 5 and parts[0].startswith("file-"):
                file_id = parts[0]
        else:
            file_id = f"file-{uuid.uuid4().hex[:12]}"

        ext = fpath.suffix.lower().lstrip(".")

        # Recover original name: prefer .meta, then extract from filename, then fallback
        meta = meta_files.get(file_id, {})
        if meta.get("original_name"):
            original_name = meta["original_name"]
        else:
            # Try to extract original name from filename: file-XXX_myfile.md → "myfile"
            stem = fpath.stem
            if "_" in stem and stem.startswith("file-"):
                original_name = stem.split("_", 1)[1] + fpath.suffix
            elif meta.get("original_name"):
                original_name = meta["original_name"]
            else:
                original_name = fpath.name
        category = meta.get("category", "上传文件")
        uploaded_at = meta.get("uploaded_at",
                               datetime.fromtimestamp(fpath.stat().st_mtime).isoformat())

        rag_status = "indexed"

        rebuilt[file_id] = UploadResponse(
            file_id=file_id,
            file_name=original_name,
            file_size=fpath.stat().st_size,
            file_type=ext,
            category=category,
            uploaded_at=uploaded_at,
            rag_status=rag_status,
        )

    return rebuilt


async def _index_file_local(file_id: str, file_path: str, file_name: str, category: str) -> tuple[str, int]:
    """Index the uploaded file using RAGAnything (async)."""
    try:
        doc_id = await rag.index_file(
            file_path=file_path,
            file_name=file_name,
            category=category,
        )
        if not doc_id:
            return "failed", 0
        return "indexed", 1
    except Exception as e:
        print(f"[Upload] RAG indexing error: {e}")
        return "failed", 0


def _validate_file_type(filename: str, allowed: list[str]) -> str:
    """Validate that filename has an allowed extension. Returns the extension."""
    ext = Path(filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(
            400,
            f"File type '{ext}' not allowed. Supported: {', '.join(allowed)}",
        )
    return ext


async def _process_single_file(
    content: bytes,
    filename: str,
    category: str,
    upload_dir: Path,
    allowed_extensions: list[str],
) -> UploadResponse:
    """Save a single file to disk, write .meta, trigger async RAG indexing, and return response."""
    ext = _validate_file_type(filename, allowed_extensions)
    file_size = len(content)

    if file_size > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            413,
            f"File too large. Max allowed: {settings.max_upload_size_mb}MB, "
            f"got {file_size / 1024 / 1024:.1f}MB",
        )

    file_id = f"file-{uuid.uuid4().hex[:12]}"
    safe_filename = f"{file_id}_{Path(filename).stem}{ext}"
    save_path = upload_dir / safe_filename

    with open(save_path, "wb") as f:
        f.write(content)

    timestamp = datetime.now().isoformat()

    # Write companion .meta file
    meta_path = upload_dir / f"{file_id}.meta"
    try:
        with open(meta_path, "w", encoding="utf-8") as mf:
            mf.write(json.dumps({
                "original_name": filename,
                "category": category,
                "uploaded_at": timestamp,
            }))
    except Exception:
        pass

    # Trigger async RAG indexing
    rag_task = asyncio.create_task(
        _index_file_local(file_id, str(save_path), filename, category)
    )

    response = UploadResponse(
        file_id=file_id,
        file_name=filename,
        file_size=file_size,
        file_type=ext.lstrip("."),
        category=category,
        uploaded_at=timestamp,
        rag_status="pending",
    )

    # Wait for RAG indexing (max 60s per file)
    try:
        rag_status, chunk_count = await asyncio.wait_for(rag_task, timeout=60.0)
        response.rag_status = rag_status
        response.chunk_count = chunk_count
    except asyncio.TimeoutError:
        response.rag_status = "pending"

    _indexed_files[file_id] = response
    return response


@router.post("", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    category: str = Form("上传文件"),
):
    """Upload a file. Accepts any format -- will be parsed and indexed by RAGAnything."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    content = await file.read()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    allowed = settings.allowed_extensions or [
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".csv", ".txt", ".md", ".png", ".jpg", ".jpeg"
    ]

    return await _process_single_file(content, file.filename, category, upload_dir, allowed)


@router.post("/batch")
async def upload_files_batch(
    files: list[UploadFile] = File(...),
    category: str = Form("上传文件"),
):
    """Upload multiple files at once. No limit on number of files."""
    if not files:
        raise HTTPException(400, "No files provided")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    allowed = settings.allowed_extensions or [
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".csv", ".txt", ".md", ".png", ".jpg", ".jpeg"
    ]

    results: list[UploadResponse] = []
    errors: list[dict] = []

    for file in files:
        if not file.filename:
            continue
        try:
            content = await file.read()
            resp = await _process_single_file(content, file.filename, category, upload_dir, allowed)
            results.append(resp)
        except HTTPException as e:
            errors.append({"filename": file.filename, "error": e.detail})
        except Exception as e:
            errors.append({"filename": file.filename, "error": str(e)})

    return {
        "files": [r.model_dump() for r in results],
        "errors": errors,
        "total": len(results) + len(errors),
        "success_count": len(results),
    }


@router.get("/files", response_model=UploadListResponse)
async def list_uploaded_files():
    """List all uploaded files and their indexing status.

    Scans the uploads/ directory every time to reflect actual files on disk,
    so knowledge base list always shows what's actually there even after restart.
    """
    rebuilt = _rebuild_index_from_disk()
    return UploadListResponse(files=list(rebuilt.values()))


@router.get("/stats")
async def rag_stats():
    """Get RAG engine statistics."""
    try:
        stats = await rag.stats()
        return stats or {"message": "RAG not yet initialized"}
    except Exception as e:
        return {"message": f"Stats not available: {str(e)}"}


@router.delete("/files/{file_id}")
async def delete_uploaded_file(file_id: str):
    """Delete an uploaded file and remove from RAG index."""
    upload_dir = Path(settings.upload_dir)

    # Find the actual file on disk — match file_id as prefix of the stem
    # Old format: file-53053b325f49.md  → stem = "file-53053b325f49"
    # New format: file-53053b325f49_mo.md → stem = "file-53053b325f49_mo"
    deleted_any = False
    for fpath in upload_dir.iterdir():
        if not fpath.is_file():
            continue
        if fpath.name.startswith("."):
            continue
        # Match file_id as prefix of the stem (e.g. "file-53053b325f49" matches "file-53053b325f49" or "file-53053b325f49_mo")
        if fpath.stem.startswith(file_id):
            fpath.unlink()
            deleted_any = True

    if not deleted_any:
        raise HTTPException(404, f"File {file_id} not found")

    # Remove from RAG index
    await rag.remove_file(file_id)

    # Also clean up in-memory cache
    if file_id in _indexed_files:
        del _indexed_files[file_id]

    return {"status": "deleted", "file_id": file_id}
