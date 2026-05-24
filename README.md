# Zhiwei — 部门智能问答系统

面向部门级的自然语言数据查询与分析工具。用户用中文提问，系统自动检索知识库文档和数据库，生成回答。

## 架构

```
  ┌─────────────────────────────────────────────┐
  │  浏览器 (React SPA)                          │
  │  端口 5173(dev) / FastAPI serve dist(prod)   │
  └──────────────┬──────────────────────────────┘
                 │ SSE 流式
  ┌──────────────▼──────────────────────────────┐
  │  FastAPI (uvicorn :8000)                     │
  │  ├─ ReAct Agent (原生 OpenAI SDK)             │
  │  ├─ RAG 引擎 (LightRAG)                       │
  │  └─ MCP Client → :8023/:8024                │
  └──────┬──────────┬──────────┬────────────────┘
         │          │          │
  ┌──────▼──┐ ┌─────▼───┐ ┌──▼─────────────┐
  │  LLM    │ │  MySQL  │ │ MCP Servers     │
  │  :1234  │ │  :3306  │ │ :8023 (upload)  │
  │         │ │         │ │ :8024 (db)      │
  └─────────┘ └─────────┘ └────────────────┘
```

- **前端**: React 18 + TypeScript + Ant Design 5 + Vite
- **后端**: Python 3.11 + FastAPI + SSE 流式
- **Agent**: 原生 OpenAI SDK — ReAct 循环 + Function Calling（无 LangChain/LangGraph）
- **LLM**: OpenAI-compatible API（本地 LM Studio / vLLM / 任意兼容服务）
- **Embedding**: text-embedding-nomic-embed-text-v1.5 (768 维)
- **RAG**: RAG-Anything + LightRAG（naive 向量检索）

## 本地开发

### 前置条件

- Python 3.11+, Node.js 22+
- 本地 LLM 服务（OpenAI-compatible API，默认 `localhost:1234/v1`）
- MySQL（默认 `localhost:3306`，库名 `zhiwei`）

### 启动

```bash
# 1. 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. MCP 服务（可选，Agent 工具调用依赖）
python -m app.mcp_servers.db_server      # :8024
python -m app.mcp_servers.upload_server  # :8023

# 3. 前端
cd frontend
npm install
npm run dev  # http://localhost:5173
```

## Docker 部署（离线环境）

### 构建镜像

在联网的开发机上构建：

```bash
# 在项目根目录
docker build -t zhiwei:latest .
```

### 导出 / 导入

```bash
# 导出为 tar（传输到离线服务器）
docker save zhiwei:latest | gzip > zhiwei.tar.gz

# 在离线服务器上导入
docker load < zhiwei.tar.gz
```

### 运行

容器内只包含应用（FastAPI + 前端静态文件），以下组件需要外部提供：

| 组件 | 默认地址 | 环境变量 |
|---|---|---|
| LLM API | `localhost:1234/v1` | `OPENAI_BASE_URL`, `MODEL_NAME` |
| MySQL | `localhost:3306` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` |
| RAG API | `localhost:8023` | `RAG_API_BASE`, `RAG_API_KEY` |
| MCP DB Server | `localhost:8024` | `MCP_SERVER_BASE` |

```bash
# 基本启动（全部使用默认值，适合本地模型在同一台机器上）
docker run -d --name zhiwei --network host zhiwei:latest

# 指定 LLM 地址
docker run -d --name zhiwei --network host \
  -e OPENAI_BASE_URL=http://192.168.1.100:1234/v1 \
  -e MODEL_NAME=qwen3.6-27B \
  zhiwei:latest
```

访问 `http://<服务器IP>:8000`。

### 环境变量参考

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | `lm-studio` | LLM API Key |
| `OPENAI_BASE_URL` | `http://localhost:1234/v1` | LLM API 地址 |
| `MODEL_NAME` | `qwen3.6-35B-A3B-apex` | 模型名称 |
| `DB_HOST` | `localhost` | MySQL 地址 |
| `DB_PORT` | `3306` | MySQL 端口 |
| `DB_USER` | `root` | 数据库用户名 |
| `DB_PASSWORD` | `123456` | 数据库密码 |
| `DB_NAME` | `zhiwei` | 数据库名 |
| `RAG_API_BASE` | `http://localhost:8023` | RAG 服务地址 |
| `RAG_API_KEY` | (内置) | RAG API Key |
| `MCP_SERVER_BASE` | `http://localhost:8024` | MCP DB 服务地址 |
| `EMBEDDING_API_KEY` | (回退到 OPENAI_API_KEY) | Embedding API Key |
| `EMBEDDING_BASE_URL` | (回退到 OPENAI_BASE_URL) | Embedding API 地址 |
| `EMBEDDING_MODEL` | `text-embedding-nomic-embed-text-v1.5` | Embedding 模型 |
| `EMBEDDING_DIM` | `768` | Embedding 维度 |
| `PORT` | `8000` | 应用监听端口 |

### 离线服务器完整部署步骤

假设离线服务器已安装 Docker，且有本地模型服务和 MySQL：

```bash
# 1. 导入镜像
docker load < zhiwei.tar.gz

# 2. 启动（根据实际模型和数据库地址调整）
docker run -d --name zhiwei --restart unless-stopped --network host \
  -e OPENAI_BASE_URL=http://localhost:1234/v1 \
  -e MODEL_NAME=your-model-name \
  -e DB_HOST=localhost \
  -e DB_NAME=zhiwei \
  zhiwei:latest

# 3. 验证
curl http://localhost:8000/api/health
```

## 页面结构

```
/               → 登录页（未认证时重定向至此）
/chat           → AI 智能问答（所有用户）
/knowledge-base → 知识库管理（所有用户）
/admin/users    → 用户管理（管理员）
/admin/database → 数据库管理（管理员）
/admin/prompt   → 提示词管理（管理员）
```

## Agent 工具

| 工具 | 功能 |
|---|---|
| `query_rag(query, category)` | RAG 文档语义检索 |
| `query_db(sql)` | MySQL SQL 查询（只读 SELECT） |
| `list_db_tables(category)` | 列出可用数据表 |

## 项目结构

```
Zhiwei/
├── frontend/                  # React 应用 (Vite)
│   ├── src/
│   │   ├── api/chat.ts        # API 客户端
│   │   ├── store/chatStore.tsx # 状态管理 + localStorage 持久化
│   │   ├── types/chat.ts      # 类型定义
│   │   └── components/        # 页面组件
│   ├── package.json
│   └── vite.config.ts
├── backend/                   # Python 后端
│   ├── app/
│   │   ├── main.py            # FastAPI 入口
│   │   ├── config.py          # 配置 (环境变量)
│   │   ├── api/               # API 路由
│   │   ├── agent/             # ReAct Agent
│   │   ├── mcp_servers/       # MCP 独立服务
│   │   └── models/            # 数据模型
│   └── requirements.txt
├── Dockerfile
├── .dockerignore
└── README.md
```
