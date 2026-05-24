# 知微 (Zhiwei) 离线部署指南

## 适用场景

将 Docker 镜像部署到**不联网的 Linux 生产服务器**。

## 前置要求

| 要求 | 说明 |
|------|------|
| Docker | 目标服务器需安装 Docker (>= 20.10) |
| MySQL | 目标服务器或内网可访问的 MySQL 实例 (>= 8.0)，需提前创建好数据库 |
| LLM API | 内网可达的 OpenAI 兼容 API（如 LM Studio、vLLM、Ollama 等），需支持 embedding 模型 |
| 磁盘空间 | >= 10GB（镜像约 3-5GB + 上传文件存储） |

---

## 一、构建镜像（开发机）

```bash
# 在项目根目录执行（需联网）
docker build --platform linux/amd64 -t zhiwei:latest .

# 导出为 tar 文件
docker save zhiwei:latest -o zhiwei.tar
```

---

## 二、传输到服务器

```bash
# 将镜像和初始化脚本传输到目标服务器
scp zhiwei.tar user@production-server:/opt/zhiwei/
scp init_users.py user@production-server:/opt/zhiwei/
```

---

## 三、服务器部署

### 3.1 加载镜像

```bash
cd /opt/zhiwei
docker load -i zhiwei.tar
```

### 3.2 创建环境变量文件

```bash
cat > /opt/zhiwei/.env << 'EOF'
# LLM 配置（必填）
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=http://your-llm-server:1234/v1
MODEL_NAME=qwen3.6-35B-A3B-apex

# Embedding 配置（必填，若不填则回退到 LLM 配置）
EMBEDDING_API_KEY=your-embedding-api-key
EMBEDDING_BASE_URL=http://your-embedding-server:1234/v1
EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
EMBEDDING_DIM=768
EMBEDDING_WORKERS=2

# MySQL 配置（必填）
DB_HOST=your-mysql-host
DB_PORT=3306
DB_USER=zhiwei
DB_PASSWORD=your-password
DB_NAME=zhiwei

# RAG 检索参数（可选）
RAG_CHUNK_TOP_K=5
RAG_COSINE_THRESHOLD=0.3
RAG_MAX_CONTEXT_TOKENS=1200

# 上传限制（可选）
MAX_UPLOAD_SIZE_MB=50
EOF
```

### 3.3 初始化数据库

```bash
# 启动 MySQL 客户端，创建数据库
mysql -h your-mysql-host -u root -p -e "CREATE DATABASE IF NOT EXISTS zhiwei CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 3.4 启动容器

```bash
docker run -d \
  --name zhiwei \
  --restart unless-stopped \
  -p 8000:8000 \
  --env-file /opt/zhiwei/.env \
  -v /opt/zhiwei/uploads:/app/uploads \
  -v /opt/zhiwei/opinions:/app/opinions \
  zhiwei:latest
```

> **注意**：`--env-file` 中的环境变量会覆盖镜像内默认值。`UPLOAD_DIR` 默认已是 `/app/uploads`，通过 volume 挂载即可持久化。

### 3.5 创建默认管理员

```bash
# 进入容器执行初始化
docker exec zhiwei python init_users.py

# 默认管理员账号：193699，密码：193699
# 登录后请立即修改密码
```

### 3.6 验证部署

```bash
# 检查容器状态
docker ps | grep zhiwei

# 检查日志
docker logs zhiwei

# 访问服务
curl http://localhost:8000/api/health
```

用浏览器访问 `http://<服务器IP>:8000`，应看到知微登录页面。

---

## 四、数据目录说明

| 目录 | 用途 | 持久化 |
|------|------|--------|
| `/app/uploads` | 用户上传的文件和 .meta 元数据 | 需挂载 |
| `/app/opinions` | 用户反馈 .txt 文件 | 需挂载 |
| `/app/backend/.rag_storage` | LightRAG 向量索引 | 建议挂载 |
| `/app/backend/.rag_parse_output` | MinerU 解析缓存 | 建议挂载 |

完整启动命令（包含 RAG 数据持久化）：

```bash
docker run -d \
  --name zhiwei \
  --restart unless-stopped \
  -p 8000:8000 \
  --env-file /opt/zhiwei/.env \
  -v /opt/zhiwei/uploads:/app/uploads \
  -v /opt/zhiwei/opinions:/app/opinions \
  -v /opt/zhiwei/rag_storage:/app/backend/.rag_storage \
  -v /opt/zhiwei/rag_parse_output:/app/backend/.rag_parse_output \
  zhiwei:latest
```

---

## 五、常用运维命令

```bash
# 查看日志
docker logs -f zhiwei

# 重启服务
docker restart zhiwei

# 停止服务
docker stop zhiwei

# 进入容器调试
docker exec -it zhiwei bash

# 更新镜像（开发机构建新版本后）
docker stop zhiwei
docker rm zhiwei
docker load -i zhiwei-new.tar
# 然后重新执行 3.4 启动命令
```

---

## 六、环境变量完整清单

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENAI_API_KEY` | lm-studio | LLM API Key |
| `OPENAI_BASE_URL` | http://localhost:1234/v1 | LLM API 地址 |
| `MODEL_NAME` | qwen3.6-35B-A3B-apex | 模型名称 |
| `EMBEDDING_API_KEY` | (回退到 OPENAI_API_KEY) | Embedding API Key |
| `EMBEDDING_BASE_URL` | (回退到 OPENAI_BASE_URL) | Embedding API 地址 |
| `EMBEDDING_MODEL` | text-embedding-nomic-embed-text-v1.5 | Embedding 模型 |
| `EMBEDDING_DIM` | 768 | Embedding 维度 |
| `EMBEDDING_WORKERS` | 2 | Embedding 并发数 |
| `DB_HOST` | localhost | MySQL 主机 |
| `DB_PORT` | 3306 | MySQL 端口 |
| `DB_USER` | root | MySQL 用户名 |
| `DB_PASSWORD` | 123456 | MySQL 密码 |
| `DB_NAME` | zhiwei | MySQL 数据库名 |
| `UPLOAD_DIR` | /app/uploads | 上传文件目录 |
| `PORT` | 8000 | 应用监听端口 |
| `MAX_UPLOAD_SIZE_MB` | 50 | 上传文件大小限制 |
| `RAG_CHUNK_TOP_K` | 5 | RAG 返回片段数 |
| `RAG_COSINE_THRESHOLD` | 0.3 | 向量相似度阈值 |
| `RAG_MAX_CONTEXT_TOKENS` | 1200 | 上下文最大 token 数 |
| `EXPERIENCE_TOP_K` | 3 | 经验检索条数 |
| `EXPERIENCE_COSINE_THRESHOLD` | 0.5 | 经验相似度阈值 |
| `EXPERIENCE_DEDUP_THRESHOLD` | 0.85 | 经验去重阈值 |

---

## 七、可选：安装中文字体（用于图表）

```bash
docker exec zhiwei apt-get update
docker exec zhiwei apt-get install -y fonts-noto-cjk
```

> 仅当使用 plotly/matplotlib 生成含中文的图表时需要。
