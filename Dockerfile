# ── Stage 1: Build frontend ──
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com
COPY frontend/public ./public
COPY frontend/src ./src
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json ./
RUN npm run build

# ── Stage 2: Python runtime ──
FROM python:3.11-slim
WORKDIR /app

# 系统依赖（plotly/matplotlib 字体 & pymysql 编译）
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# 后端源码
COPY backend/ /app/backend/

# 前端产物（Stage 1）
COPY --from=frontend-builder /build/frontend/dist /app/frontend/dist

# 运行时数据目录
RUN mkdir -p /app/uploads

ENV UPLOAD_DIR=/app/uploads
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

WORKDIR /app/backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
