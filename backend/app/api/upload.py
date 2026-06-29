import os
import uuid
import json
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from pydantic import BaseModel

from app.config import settings
from app.rag_engine import rag
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


class UploadResponse(BaseModel):
    file_id: str
    file_name: str
    file_size: int
    file_type: str
    category: str
    uploaded_at: str
    rag_status: str  # "indexed" | "pending" | "failed" | "skipped"
    rag_error: str = ""
    chunk_count: int = 0
    user_id: str = "default"
    source: str = "kb"  # "kb" | "chat"


class UploadListResponse(BaseModel):
    files: list[UploadResponse]


_indexed_files: dict[str, UploadResponse] = {}


def _rebuild_index_from_disk() -> dict[str, UploadResponse]:
    upload_dir = Path(settings.upload_dir)
    if not upload_dir.exists():
        return {}

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
        if fpath.name.startswith("."):
            continue
        if fpath.suffix == ".meta":
            continue
        fname = fpath.name
        if fname.startswith("file-") and "." in fname:
            file_id = fname.rsplit(".", 1)[0]
            parts = file_id.split("_", 1)
            if len(parts) > 1 and len(parts[0]) > 5 and parts[0].startswith("file-"):
                file_id = parts[0]
        else:
            file_id = f"file-{uuid.uuid4().hex[:12]}"

        ext = fpath.suffix.lower().lstrip(".")

        meta = meta_files.get(file_id, {})
        if meta.get("original_name"):
            original_name = meta["original_name"]
        else:
            stem = fpath.stem
            if "_" in stem and stem.startswith("file-"):
                original_name = stem.split("_", 1)[1] + fpath.suffix
            elif meta.get("original_name"):
                original_name = meta["original_name"]
            else:
                original_name = fpath.name
        category = meta.get("category", "")
        if category == "上传文件":
            category = ""
        uploaded_at = meta.get("uploaded_at",
                               datetime.fromtimestamp(fpath.stat().st_mtime, tz=timezone.utc).isoformat())
        file_user_id = meta.get("user_id", "default")

        rag_status = meta.get("rag_status", "indexed")
        chunk_count = meta.get("chunk_count", 0)
        rag_error = meta.get("rag_error", "")
        source = meta.get("source", "kb")

        rebuilt[file_id] = UploadResponse(
            file_id=file_id,
            file_name=original_name,
            file_size=fpath.stat().st_size,
            file_type=ext,
            category=category,
            uploaded_at=uploaded_at,
            rag_status=rag_status,
            rag_error=rag_error,
            chunk_count=chunk_count,
            user_id=file_user_id,
            source=source,
        )

    return rebuilt


async def _index_file_local(file_id: str, file_path: str, file_name: str, category: str, user_id: str = "default") -> tuple[str, int, str]:
    try:
        doc_id, chunk_count = await rag.index_file(
            file_path=file_path,
            file_name=file_name,
            category=category,
            user_id=user_id,
        )
        if not doc_id:
            return "failed", 0, "文件内容为空或解析失败"
        return "indexed", chunk_count, ""
    except Exception as e:
        error_msg = str(e) if str(e) else type(e).__name__
        logger.error(f"[Upload:Index] RAG indexing error for {file_name}: {error_msg}")
        return "failed", 0, f"索引过程异常: {error_msg}"


def _update_meta_rag_status(upload_dir: Path, file_id: str, rag_status: str, chunk_count: int = 0, rag_error: str = "") -> None:
    meta_path = upload_dir / f"{file_id}.meta"
    try:
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        else:
            meta = {}
        meta["rag_status"] = rag_status
        meta["chunk_count"] = chunk_count
        if rag_error:
            meta["rag_error"] = rag_error
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
    except Exception:
        pass


def _validate_file_type(filename: str, allowed: list[str]) -> str:
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
    user_id: str = "default",
    source: str = "kb",
    conv_id: str = "",
) -> UploadResponse:
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

    timestamp = datetime.now(timezone.utc).isoformat()

    meta_path = upload_dir / f"{file_id}.meta"
    try:
        with open(meta_path, "w", encoding="utf-8") as mf:
            mf.write(json.dumps({
                "original_name": filename,
                "category": category,
                "uploaded_at": timestamp,
                "user_id": user_id,
                "source": source,
                "conv_id": conv_id,
            }))
    except Exception:
        pass

    rag_task = asyncio.create_task(
        _index_file_local(file_id, str(save_path), filename, category, user_id)
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

    try:
        rag_status, chunk_count, rag_error = await asyncio.wait_for(rag_task, timeout=settings.rag_indexing_timeout)
        response.rag_status = rag_status
        response.chunk_count = chunk_count
        response.rag_error = rag_error
    except asyncio.TimeoutError:
        response.rag_status = "failed"
        response.rag_error = f"索引超时（{settings.rag_indexing_timeout} 秒），可调大 RAG_INDEXING_TIMEOUT 环境变量"
    except Exception as exc:
        response.rag_status = "failed"
        response.rag_error = f"索引异常: {exc}"

    _update_meta_rag_status(upload_dir, file_id, response.rag_status, response.chunk_count, response.rag_error)

    _indexed_files[file_id] = response
    return response


@router.post("", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    category: str = Form(""),
    user_id: str = Form("default"),
    source: str = Form("kb"),
    conv_id: str = Form(""),
):
    if not file.filename:
        raise HTTPException(400, "No file provided")

    content = await file.read()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    allowed = settings.allowed_extensions or [
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".md",
    ]

    return await _process_single_file(content, file.filename, category, upload_dir, allowed, user_id, source, conv_id)


@router.post("/batch")
async def upload_files_batch(
    files: list[UploadFile] = File(...),
    category: str = Form(""),
    user_id: str = Form("default"),
    source: str = Form("kb"),
    conv_id: str = Form(""),
):
    if not files:
        raise HTTPException(400, "No files provided")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    allowed = settings.allowed_extensions or [
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".md",
    ]

    results: list[UploadResponse] = []
    errors: list[dict] = []

    for file in files:
        if not file.filename:
            continue
        try:
            content = await file.read()
            resp = await _process_single_file(content, file.filename, category, upload_dir, allowed, user_id, source, conv_id)
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
async def list_uploaded_files(
    scope: str = Query("all", pattern="^(public|personal|all)$"),
    user_id: str = "default",
    keyword: str = "",
):
    rebuilt = _rebuild_index_from_disk()

    filtered: list[UploadResponse] = []
    for f in rebuilt.values():
        if f.source == "chat":
            continue
        if scope == "public":
            if f.user_id != "default":
                continue
        elif scope == "personal":
            if f.user_id != user_id:
                continue
        if keyword and keyword.lower() not in f.file_name.lower():
            continue
        filtered.append(f)

    return UploadListResponse(files=filtered)


@router.get("/stats")
async def rag_stats(user_id: str = "default"):
    try:
        stats = await rag.stats(user_id=user_id)
        return stats or {"message": "RAG not yet initialized"}
    except Exception as e:
        return {"message": f"Stats not available: {str(e)}"}


@router.put("/files/{file_id}/category")
async def update_file_category(file_id: str, category: str = Form(...)):
    upload_dir = Path(settings.upload_dir)
    meta_path = upload_dir / f"{file_id}.meta"

    if not meta_path.exists():
        raise HTTPException(404, f"File metadata not found for {file_id}")

    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        normalized = "" if category == "上传文件" else category
        meta["category"] = normalized
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
    except Exception as e:
        raise HTTPException(500, f"Failed to update category: {e}")

    return {"ok": True, "file_id": file_id, "category": category}


@router.delete("/files/{file_id}")
async def delete_uploaded_file(file_id: str, user_id: str = "default"):
    import hashlib
    upload_dir = Path(settings.upload_dir)

    to_delete: list[tuple[Path, str]] = []
    for fpath in upload_dir.iterdir():
        if not fpath.is_file():
            continue
        if fpath.name.startswith("."):
            continue
        if fpath.stem.startswith(file_id):
            doc_id = hashlib.md5(str(fpath.resolve()).encode()).hexdigest()[:16]
            to_delete.append((fpath, doc_id))

    if not to_delete:
        raise HTTPException(404, f"File {file_id} not found")

    for fpath, doc_id in to_delete:
        await rag.remove_file(doc_id, user_id=user_id)

    for fpath, _doc_id in to_delete:
        fpath.unlink()

    if file_id in _indexed_files:
        del _indexed_files[file_id]

    return {"status": "deleted", "file_id": file_id}
