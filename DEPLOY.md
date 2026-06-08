# 知微 (Zhiwei) 部署指南

## 环境要求

- Docker（生产服务器）
- MySQL 数据库（可容器化或独立部署）
- 不要求联网（镜像已包含所有依赖）

## 部署步骤

### 1. 传输镜像到服务器

```bash
# 在构建机上导出镜像（已完成）
docker save zhiwei:latest | gzip > zhiwei_0.3.tar.gz

# 传输到生产服务器
scp zhiwei_0.3.tar.gz user@production-server:/opt/zhiwei/
```

### 2. 在生产服务器上加载镜像

```bash
cd /opt/zhiwei
docker load -i zhiwei_0.3.tar.gz
```

### 3. 准备环境变量

在服务器上创建 `/opt/zhiwei/.env`：

```bash
# LLM 配置
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=http://your-llm-server:1234/v1
MODEL_NAME=qwen3.6-35B-A3B-apex

# Embedding 配置（如与 LLM 共用可省略）
EMBEDDING_API_KEY=your-api-key
EMBEDDING_BASE_URL=http://your-llm-server:1234/v1
EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
EMBEDDING_DIM=768

# MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_NAME=zhiwei
```

### 4. 启动容器

```bash
docker run -d \
  --name zhiwei \
  --network host \
  --restart unless-stopped \
  -v /opt/zhiwei/uploads:/app/uploads \
  -v /opt/zhiwei/opinions:/app/opinions \
  -v /opt/zhiwei/talk:/app/talk \
  --env-file /opt/zhiwei/.env \
  zhiwei:latest
```

> 也可用 `-e` 逐个传参代替 `--env-file`，效果相同。

### 5. 初始化数据库（自动）

容器首次启动会自动执行 `init_db()`：
- 创建所有表（如不存在则会创建）
- 执行 schema migration（向后兼容，可重复执行不会报错）
- 种子「系统默认」提示词模板
- 创建默认管理员账户 `193699 / 193699`

查看初始化日志：
```bash
docker logs zhiwei | grep "\[Init\]"
```

### 6. 验证部署

```bash
# 检查服务状态
curl http://localhost:8000/api/health

# 检查模板初始化
docker logs zhiwei | grep "system_prompt"
```

## 挂载目录说明

| 目录 | 用途 | 可复用 |
|------|------|:--:|
| `/app/uploads/` | 用户上传的文件 | 是 |
| `/app/uploads/.rag_storage/` | LightRAG 向量索引 | 谨慎 |
| `/app/uploads/.rag_parse_output/` | MinerU 解析缓存 | 谨慎 |
| `/app/opinions/` | 用户意见反馈 | 是 |
| `/app/talk/` | 对话记录 | 是 |

## 版本升级与数据库复用

### 沿用旧数据库是否安全？

**安全。** 每次部署新版时沿用原有 MySQL 数据库不会导致问题，因为所有初始化操作都是幂等的：

1. **`Base.metadata.create_all()`** — 使用 `CREATE TABLE IF NOT EXISTS`，已存在的表不会被修改
2. **`_migrate()`** — 所有 ALTER TABLE 包裹在 `try/except` 中，重复执行直接跳过，不会报错
3. **种子数据** — `init_db()` 先检查记录是否存在，已存在则只更新空字段，不会覆盖自定义内容
4. **ENUM 修改** — 只追加新值（如 `pending`），不影响已有数据

### 什么时候需要重建 RAG 索引？

如果新版本修改了以下任一项，需要重建：
- embedding 模型（`EMBEDDING_MODEL`）
- chunk 策略参数（`RAG_CHUNK_TOP_K`、`RAG_COSINE_THRESHOLD`）
- LightRAG 或 RAGAnything 版本

重建方法：
```bash
docker exec zhiwei rm -rf /app/uploads/.rag_storage /app/uploads/.rag_parse_output
docker restart zhiwei
# 重新上传文件触发索引重建
```

### 升级流程

```bash
# 1. 停止旧容器
docker stop zhiwei

# 2. 备份数据库（建议）
mysqldump -u root -p zhiwei > zhiwei_backup_$(date +%Y%m%d).sql

# 3. 删除旧容器
docker rm zhiwei

# 4. 加载新镜像
docker load -i zhiwei_0.3.tar.gz

# 5. 启动新容器（挂载相同目录和数据库）
docker run -d \
  --name zhiwei \
  --network host \
  --restart unless-stopped \
  -v /opt/zhiwei/uploads:/app/uploads \
  -v /opt/zhiwei/opinions:/app/opinions \
  -v /opt/zhiwei/talk:/app/talk \
  --env-file /opt/zhiwei/.env \
  zhiwei:latest

# 6. 检查启动日志
docker logs zhiwei --tail 30
```

## 环境变量参考

所有变量也可在 `.env` 文件中配置。完整默认值见 `backend/app/config.py`。

## Tiktoken 缓存说明

构建镜像时会下载 tiktoken 编码文件（约 10MB），保存在容器的 `/app/.tiktoken_cache`：

```
Downloading gpt-4o-mini... ✓
Downloading gpt-4o... ✓
Downloading gpt-4... ✓
...
```

这些文件是 **文本分词器（tokenizer）的编码表**，LightRAG 用它们来切分文档。虽然文件名带 `gpt-4o` 等，但只是编码名称，与调用哪个 LLM 无关——你的模型是 qwen 也不影响，分词器只是做文本切割。

预下载是因为生产服务器不联网，避免 LightRAG 启动时尝试连接 `openaipublic.blob.core.windows.net` 下载编码文件导致超时报错。

## 故障排查

### 提示词模板下拉无法展开 / 删除确认框无响应

前端组件渲染问题，已在 v0.3 修复。

### 文件上传失败 / 经验保存无反应

查看日志是否出现 `openaipublic.blob.core.windows.net` 连接错误。镜像已预下载 tiktoken 缓存，无需联网。

### RAG 查询报错 `NoneType has no attribute 'aquery'`

LightRAG 未初始化。检查 embedding 配置是否正确，查看 `[RAG] Init failed` 相关日志。

### 图表中文乱码

容器未安装中文字体，在服务器执行：
```bash
docker exec zhiwei apt-get update && docker exec zhiwei apt-get install -y fonts-noto-cjk
```
