FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com
COPY frontend/public ./public
COPY frontend/src ./src
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/*.sources 2>/dev/null || true; \
    sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

# 若需图表中文渲染，在目标服务器执行：
# docker exec <container> apt-get update && apt-get install -y fonts-noto-cjk

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple $(grep -v '^raganything\|^#' /tmp/requirements.txt | grep -v '^$')
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple raganything==1.3.1

# Pre-download tiktoken encodings for offline deployment
ENV TIKTOKEN_CACHE_DIR=/app/.tiktoken_cache
RUN python -m lightrag.tools.download_cache --cache-dir /app/.tiktoken_cache

COPY backend/ /app/backend/
COPY --from=frontend-builder /build/frontend/dist /app/frontend/dist
RUN mkdir -p /app/uploads /app/opinions /app/talk

ENV UPLOAD_DIR=/app/uploads
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

WORKDIR /app/backend
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
