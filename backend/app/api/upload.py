import os
import uuid
import json
import asyncio
import shutil
import tempfile
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
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
    rag_error: str = ""  # human-readable error message when rag_status="failed"
    chunk_count: int = 0
    user_id: str = "default"
    is_archive: bool = False
    extracted_files: list[dict] = []  # [{name, status, error?}] for archives


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
                               datetime.fromtimestamp(fpath.stat().st_mtime).isoformat())
        file_user_id = meta.get("user_id", "default")

        rag_status = meta.get("rag_status", "indexed")  # default indexed for legacy files without status in meta
        chunk_count = meta.get("chunk_count", 0)

        rebuilt[file_id] = UploadResponse(
            file_id=file_id,
            file_name=original_name,
            file_size=fpath.stat().st_size,
            file_type=ext,
            category=category,
            uploaded_at=uploaded_at,
            rag_status=rag_status,
            chunk_count=chunk_count,
            user_id=file_user_id,
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
        print(f"[Upload] RAG indexing error for {file_name}: {error_msg}")
        return "failed", 0, f"索引过程异常: {error_msg}"


def _update_meta_rag_status(upload_dir: Path, file_id: str, rag_status: str, chunk_count: int = 0) -> None:
    meta_path = upload_dir / f"{file_id}.meta"
    try:
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        else:
            meta = {}
        meta["rag_status"] = rag_status
        meta["chunk_count"] = chunk_count
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
    except Exception:
        pass


ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z", ".tar.gz", ".tgz"}


def _is_archive(filename: str) -> bool:
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in ARCHIVE_EXTENSIONS)


def _extract_archive(file_path: str, extract_dir: str) -> list[str]:
    lower = Path(file_path).name.lower()
    extracted: list[str] = []

    if lower.endswith(".zip"):
        import zipfile
        try:
            with zipfile.ZipFile(file_path, "r") as zf:
                for member in zf.namelist():
                    if member.endswith("/") or "__MACOSX" in member or member.startswith("."):
                        continue
                    target_name = Path(member).name
                    if not target_name:
                        continue
                    target_path = os.path.join(extract_dir, target_name)
                    with zf.open(member) as src, open(target_path, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    extracted.append(target_path)
            return extracted
        except Exception as e:
            raise RuntimeError(f"ZIP 解压失败: {e}")

    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        import tarfile
        try:
            with tarfile.open(file_path, "r:gz") as tf:
                for member in tf.getmembers():
                    if not member.isfile():
                        continue
                    target_name = Path(member.name).name
                    if not target_name or target_name.startswith("."):
                        continue
                    target_path = os.path.join(extract_dir, target_name)
                    with tf.extractfile(member) as src, open(target_path, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    extracted.append(target_path)
            return extracted
        except Exception as e:
            raise RuntimeError(f"TAR.GZ 解压失败: {e}")

    if lower.endswith(".rar"):
        try:
            import rarfile
        except ImportError:
            raise RuntimeError(
                "RAR 解压需要 rarfile 库，请运行: pip install rarfile"
            )
        try:
            with rarfile.RarFile(file_path, "r") as rf:
                for member in rf.namelist():
                    target_name = Path(member).name
                    if not target_name or target_name.startswith("."):
                        continue
                    target_path = os.path.join(extract_dir, target_name)
                    with rf.open(member) as src, open(target_path, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    extracted.append(target_path)
            return extracted
        except Exception as e:
            raise RuntimeError(f"RAR 解压失败: {e}")

    if lower.endswith(".7z"):
        try:
            import py7zr
        except ImportError:
            raise RuntimeError(
                "7z 解压需要 py7zr 库，请运行: pip install py7zr"
            )
        try:
            with py7zr.SevenZipFile(file_path, "r") as szf:
                szf.extractall(extract_dir)
                extracted = [
                    os.path.join(extract_dir, f)
                    for f in os.listdir(extract_dir)
                    if os.path.isfile(os.path.join(extract_dir, f))
                ]
            return extracted
        except Exception as e:
            raise RuntimeError(f"7Z 解压失败: {e}")

    raise RuntimeError(f"不支持的压缩格式: {Path(file_path).suffix}")


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

    timestamp = datetime.now().isoformat()

    meta_path = upload_dir / f"{file_id}.meta"
    try:
        with open(meta_path, "w", encoding="utf-8") as mf:
            mf.write(json.dumps({
                "original_name": filename,
                "category": category,
                "uploaded_at": timestamp,
                "user_id": user_id,
            }))
    except Exception:
        pass

    if _is_archive(filename):
        child_allowed = [e for e in allowed_extensions if e not in ARCHIVE_EXTENSIONS
                         and not any(e.endswith(ae) for ae in ARCHIVE_EXTENSIONS)]

        extracted_files: list[dict] = []
        temp_dir = tempfile.mkdtemp(prefix="zhiwei_archive_")
        try:
            extracted_paths = _extract_archive(str(save_path), temp_dir)
        except RuntimeError as e:
            shutil.rmtree(temp_dir, ignore_errors=True)
            _update_meta_rag_status(upload_dir, file_id, "failed", 0)
            return UploadResponse(
                file_id=file_id,
                file_name=filename,
                file_size=file_size,
                file_type=ext.lstrip("."),
                category=category,
                uploaded_at=timestamp,
                rag_status="failed",
                user_id=user_id,
                is_archive=True,
                extracted_files=[{"name": "解压失败", "status": "error", "error": str(e)}],
            )

        if not extracted_paths:
            shutil.rmtree(temp_dir, ignore_errors=True)
            _update_meta_rag_status(upload_dir, file_id, "failed", 0)
            return UploadResponse(
                file_id=file_id,
                file_name=filename,
                file_size=file_size,
                file_type=ext.lstrip("."),
                category=category,
                uploaded_at=timestamp,
                rag_status="failed",
                user_id=user_id,
                is_archive=True,
                extracted_files=[{"name": "空压缩包", "status": "error", "error": "压缩包内无文件"}],
            )

        total_chunks = 0
        any_indexed = False
        for child_path in extracted_paths:
            child_name = Path(child_path).name
            child_ext = Path(child_path).suffix.lower()
            if child_ext not in child_allowed:
                extracted_files.append({
                    "name": child_name,
                    "status": "skipped",
                    "error": f"不支持的文件类型 {child_ext}",
                })
                continue

            rag_status, chunk_count, rag_error = await _index_file_local(
                file_id, child_path, child_name, category, user_id
            )
            total_chunks += chunk_count
            if rag_status == "indexed":
                any_indexed = True
                extracted_files.append({"name": child_name, "status": "done"})
            else:
                extracted_files.append({
                    "name": child_name,
                    "status": "error",
                    "error": rag_error or "索引失败",
                })

        shutil.rmtree(temp_dir, ignore_errors=True)

        response = UploadResponse(
            file_id=file_id,
            file_name=filename,
            file_size=file_size,
            file_type=ext.lstrip("."),
            category=category,
            uploaded_at=timestamp,
            rag_status="indexed" if any_indexed else "failed",
            chunk_count=total_chunks,
            user_id=user_id,
            is_archive=True,
            extracted_files=extracted_files,
        )

        _update_meta_rag_status(upload_dir, file_id, response.rag_status, response.chunk_count)

        return response

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
        rag_status, chunk_count, rag_error = await asyncio.wait_for(rag_task, timeout=60.0)
        response.rag_status = rag_status
        response.chunk_count = chunk_count
        response.rag_error = rag_error
    except asyncio.TimeoutError:
        response.rag_status = "failed"
        response.rag_error = "索引超时（60 秒），可能嵌入服务未启动或文件过大"

    _update_meta_rag_status(upload_dir, file_id, response.rag_status, response.chunk_count)

    _indexed_files[file_id] = response
    return response


@router.post("", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    category: str = Form(""),
    user_id: str = Form("default"),
):
    if not file.filename:
        raise HTTPException(400, "No file provided")

    content = await file.read()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    allowed = settings.allowed_extensions or [
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".csv", ".txt", ".md", ".png", ".jpg", ".jpeg",
        ".zip", ".rar", ".7z", ".tar.gz", ".tgz",
    ]

    return await _process_single_file(content, file.filename, category, upload_dir, allowed, user_id)


@router.post("/batch")
async def upload_files_batch(
    files: list[UploadFile] = File(...),
    category: str = Form(""),
    user_id: str = Form("default"),
):
    if not files:
        raise HTTPException(400, "No files provided")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    allowed = settings.allowed_extensions or [
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".csv", ".txt", ".md", ".png", ".jpg", ".jpeg",
        ".zip", ".rar", ".7z", ".tar.gz", ".tgz",
    ]

    results: list[UploadResponse] = []
    errors: list[dict] = []

    for file in files:
        if not file.filename:
            continue
        try:
            content = await file.read()
            resp = await _process_single_file(content, file.filename, category, upload_dir, allowed, user_id)
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
    upload_dir = Path(settings.upload_dir)

    deleted_any = False
    for fpath in upload_dir.iterdir():
        if not fpath.is_file():
            continue
        if fpath.name.startswith("."):
            continue
        if fpath.stem.startswith(file_id):
            fpath.unlink()
            deleted_any = True

    if not deleted_any:
        raise HTTPException(404, f"File {file_id} not found")

    await rag.remove_file(file_id, user_id=user_id)

    if file_id in _indexed_files:
        del _indexed_files[file_id]

    return {"status": "deleted", "file_id": file_id}
