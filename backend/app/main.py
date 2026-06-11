from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from app.api import chat, data_sources, history, upload, auth, db_connections, prompt, experience, opinion, skill
from app.database import init_db
from app.config import settings
from app.logger import init_logging
from pathlib import Path

app = FastAPI(
    title="Zhiwei - 部门智能问答系统",
    version="0.1.0",
    description="面向部门级的全能问答系统，支持自然语言查数据、做分析、出报告/图表",
)

# CORS - allow frontend dev server (Vite port 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _verify_embedding_dim() -> None:
    """Check that the configured EMBEDDING_DIM matches the actual model output."""
    from app.logger import get_logger
    log = get_logger(__name__)

    try:
        import httpx, numpy as np
        base_url = settings.embedding_base_url.rstrip("/").replace("/v1", "")
        api_key = settings.embedding_api_key
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

        resp = httpx.post(
            f"{base_url}/v1/embeddings",
            json={"model": settings.embedding_model, "input": ["test"]},
            headers=headers,
            timeout=15.0,
        )
        if resp.status_code != 200:
            log.warning(f"[Init] Cannot verify embedding dim: HTTP {resp.status_code}")
            return

        data = resp.json()
        actual_dim = len(data["data"][0]["embedding"]) if data.get("data") else 0
        expected = settings.embedding_dim

        if actual_dim and actual_dim != expected:
            log.error(
                f"[Init] EMBEDDING DIM MISMATCH: model '{settings.embedding_model}' "
                f"returns {actual_dim}-dim vectors, but EMBEDDING_DIM is set to {expected}. "
                f"Update EMBEDDING_DIM={actual_dim} in .env or environment."
            )
        else:
            log.info(f"[Init] Embedding dim verified: {actual_dim} (model={settings.embedding_model})")
    except Exception as e:
        log.warning(f"[Init] Embedding dim check skipped: {e}")


@app.on_event("startup")
def startup():
    init_logging(settings.log_dir, settings.log_level)
    os.environ.setdefault("OMP_NUM_THREADS", "4")
    try:
        import torch
        torch.set_num_threads(4)
    except ImportError:
        pass
    init_db()
    _verify_embedding_dim()


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(data_sources.router, prefix="/api/data-sources", tags=["data-sources"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(db_connections.router, prefix="/api/db-connections", tags=["db-connections"])
app.include_router(prompt.router, prefix="/api/prompt", tags=["prompt"])
app.include_router(prompt.templates_router, prefix="/api/prompts", tags=["prompts"])
app.include_router(experience.router, prefix="/api/experiences", tags=["experiences"])
app.include_router(opinion.router, prefix="/api", tags=["opinion"])
app.include_router(skill.router, prefix="/api/skills", tags=["skills"])

# ── Production: serve built frontend when dist/ exists ──
dist_dir = Path(__file__).parent.parent.parent / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets")

    index_html = dist_dir / "index.html"

    @app.get("/")
    async def serve_root():
        return FileResponse(index_html)

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = dist_dir / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(index_html)
