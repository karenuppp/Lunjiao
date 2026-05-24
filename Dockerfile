# ── Stage 1: Build frontend ──
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com
COPY frontend/public ./public
COPY frontend/src ./src
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json ./
RUN npm run build

# ── Stage 2: Python runtime ──
FROM python:3.11-slim
WORKDIR /app

# 若需图表中文渲染，在目标服务器执行：
# docker exec <container> apt-get update && apt-get install -y fonts-noto-cjk

# Python 依赖（分两步：先装核心包，再装 RAG 全家桶以避免依赖冲突）
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir $(grep -v '^raganything\|^mineru\|^#' /tmp/requirements.txt | grep -v '^$')
RUN pip install --no-cache-dir raganything==1.3.1

# 后端源码
COPY backend/ /app/backend/

# 前端产物（Stage 1）
COPY --from=frontend-builder /build/frontend/dist /app/frontend/dist

# 运行时数据目录
RUN mkdir -p /app/uploads /app/opinions

ENV UPLOAD_DIR=/app/uploads
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

WORKDIR /app/backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
