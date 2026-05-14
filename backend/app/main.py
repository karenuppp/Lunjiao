from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api import chat, data_sources, history, upload, auth
from pathlib import Path

app = FastAPI(
    title="Lunjiao - 部门智能问答系统",
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


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


# Mount routers
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(data_sources.router, prefix="/api/data-sources", tags=["data-sources"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# ── Production: serve built frontend when dist/ exists ──
# Dev mode   → `npm run dev` (Vite on :5173 proxies /api to :8000)
# Production → `npm run build` then uvicorn (FastAPI serves dist/)
dist_dir = Path(__file__).parent.parent.parent / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="frontend")
