# Zhiwei — 部门智能问答系统

面向部门级的自然语言数据查询与分析工具。用户用中文提问，系统自动检索知识库文档和数据库，生成回答。

## 核心特性

- **ReAct Agent**: 原生 OpenAI Function Calling，无 LangChain/LangGraph 依赖
- **RAG 检索**: RAG-Anything + LightRAG，支持用户隔离的知识库
- **数据库查询**: Text-to-SQL，连接外部 MySQL 数据库进行只读查询
- **经验系统**: 自动从用户点赞的回答中提取经验，支持语义去重、记忆衰减、复合评分
- **多轮对话**: 对话记录持久化到 JSON 文件，按用户隔离，支持流式 SSE 响应
- **提示词模板**: 管理员可创建多个提示词模板，前端选择后模板内容自动拼入后端请求
- **离线部署**: 单 Docker 镜像，支持一键导出/导入到不联网的生产服务器

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
  │  ├─ 经验系统 (语义检索 + 衰减评分)             │
  │  └─ 对话持久化 (JSON 文件 + 用户隔离)          │
  └──────┬──────────┬──────────┬────────────────┘
         │          │          │
  ┌──────▼──┐ ┌─────▼───┐ ┌──▼─────────────┐
  │  LLM    │ │  MySQL  │ │ MCP Servers     │
  │  :1234  │ │  :3306  │ │ :8023 (upload)  │
  │         │ │         │ │ :8024 (db)      │
  └─────────┘ └─────────┘ └────────────────┘
```

- **前端**: React 18 + TypeScript + Ant Design 5 + Vite
- **后端**: Python 3.12 + FastAPI + SSE 流式
- **Agent**: 原生 OpenAI SDK — ReAct 循环 + Function Calling（无 LangChain/LangGraph）
- **LLM**: OpenAI-compatible API（本地 LM Studio / vLLM / 任意兼容服务）
- **Embedding**: text-embedding-nomic-embed-text-v1.5 (768 维)
- **RAG**: RAG-Anything + LightRAG（向量检索 + 关键词混合）

## 本地开发

### 前置条件

- Python 3.12+, Node.js 22+
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

### 初始化管理员账号

```bash
cd backend && python init_users.py
# 默认账号: 193699  密码: 193699
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
| Embedding API | (回退到 LLM 配置) | `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL` |

完整部署步骤参见 [DEPLOY.md](DEPLOY.md)。

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
| `EMBEDDING_API_KEY` | (回退到 OPENAI_API_KEY) | Embedding API Key |
| `EMBEDDING_BASE_URL` | (回退到 OPENAI_BASE_URL) | Embedding API 地址 |
| `EMBEDDING_MODEL` | `text-embedding-nomic-embed-text-v1.5` | Embedding 模型 |
| `EMBEDDING_DIM` | `768` | Embedding 维度 |
| `EMBEDDING_WORKERS` | `2` | Embedding 并发数 |
| `DB_HOST` | `localhost` | MySQL 地址 |
| `DB_PORT` | `3306` | MySQL 端口 |
| `DB_USER` | `root` | 数据库用户名 |
| `DB_PASSWORD` | `123456` | 数据库密码 |
| `DB_NAME` | `zhiwei` | 数据库名 |
| `PORT` | `8000` | 应用监听端口 |
| `TALK_DIR` | `/app/talk` | 对话记录存储目录 |
| `UPLOAD_DIR` | `/app/uploads` | 上传文件存储目录 |
| `MAX_UPLOAD_SIZE_MB` | `50` | 上传文件大小限制 |
| `RAG_CHUNK_TOP_K` | `5` | RAG 返回片段数 |
| `RAG_COSINE_THRESHOLD` | `0.3` | 向量相似度阈值 |
| `RAG_MAX_CONTEXT_TOKENS` | `1200` | 上下文最大 token 数 |
| `EXPERIENCE_TOP_K` | `3` | 经验检索条数 |
| `EXPERIENCE_COSINE_THRESHOLD` | `0.5` | 经验相似度阈值 |
| `EXPERIENCE_DEDUP_THRESHOLD` | `0.85` | 经验去重阈值 |

## 页面结构

```
/                   → 登录页（未认证时重定向至此）
/chat               → AI 智能问答（所有用户）
/knowledge-base     → 知识库管理（所有用户）
/admin/users        → 用户管理（管理员）
/admin/database     → 数据库管理（管理员）
/admin/prompt       → 提示词管理（管理员）
/admin/experience   → 经验管理（管理员）
```

## Agent 工具

| 工具 | 功能 |
|---|---|
| `query_rag(query, category)` | RAG 文档语义检索（用户隔离 + 分类过滤） |
| `query_db(sql)` | MySQL SQL 查询（只读 SELECT/SHOW/DESCRIBE） |
| `list_db_tables(category)` | 列出可用数据表及字段 |
| `list_db_connections()` | 列出已连接的数据库 |
| `find_file_by_name(keyword)` | 按文件名查找知识库文件 |

## 项目结构

```
Zhiwei/
├── frontend/                  # React 应用 (Vite)
│   ├── src/
│   │   ├── api/chat.ts        # API 客户端（所有后端接口）
│   │   ├── store/chatStore.tsx # 全局状态 (useReducer + Context)
│   │   ├── types/chat.ts      # TypeScript 类型定义
│   │   └── components/        # 页面组件
│   │       ├── ChatPanel.tsx         # 智能问答面板
│   │       ├── Sidebar.tsx          # 对话列表侧栏
│   │       ├── KbManagePage.tsx     # 知识库管理
│   │       ├── DbManagePage.tsx     # 数据库管理
│   │       ├── UserManagePage.tsx   # 用户管理
│   │       ├── PromptManagePage.tsx # 提示词管理
│   │       ├── ExpManagePage.tsx    # 经验管理
│   │       └── LoginPage.tsx        # 登录页
│   ├── package.json
│   └── vite.config.ts
├── backend/                   # Python 后端
│   ├── app/
│   │   ├── main.py            # FastAPI 入口 + SPA 静态文件服务
│   │   ├── config.py          # 环境变量配置
│   │   ├── database.py        # SQLAlchemy + 自动迁移
│   │   ├── api/               # API 路由
│   │   │   ├── chat.py        # 对话 + SSE 流式 + 反馈
│   │   │   ├── auth.py        # 登录 + 用户管理
│   │   │   ├── upload.py      # 文件上传/删除/分类
│   │   │   ├── prompt.py      # 提示词 CRUD
│   │   │   ├── history.py     # 对话持久化存储
│   │   │   └── db_connections.py  # 外部数据库连接管理
│   │   ├── agent/             # ReAct Agent
│   │   │   ├── graph.py       # Agent 循环 (同步 + 流式)
│   │   │   ├── tools.py       # Tool schemas + 执行
│   │   │   └── prompts.py     # 默认系统提示词
│   │   ├── services/          # 业务服务
│   │   │   └── experience_service.py  # 经验提取/检索/去重
│   │   ├── models/            # ORM 模型
│   │   │   ├── user.py
│   │   │   ├── db_connection.py
│   │   │   └── system_prompt.py
│   │   └── rag_engine.py      # RAG 引擎封装
│   └── requirements.txt
├── Dockerfile
├── .dockerignore
├── DEPLOY.md                  # 离线部署详细指南
└── README.md
```

## 数据持久化

对话记录存储在 `TALK_DIR` 目录（默认 `/app/talk`），每个对话一个 JSON 文件（`{conv_id}.json`），包含该对话的全部多轮消息。该目录通过 Docker volume 挂载持久化。

每个对话文件绑定 `user_id`，API 按当前用户过滤，不同用户之间的对话记录互相隔离。

## 性能优化

前端在 SSE 流式输出时采用以下优化防止界面卡死：

- **Markdown 防抖渲染**: 流式输出期间每 150ms 更新一次 Markdown 渲染，而非每个 token 触发
- **消息组件记忆化**: `React.memo` 避免未变化消息的重复渲染
- **localStorage 节流**: 每 3 秒最多写入一次，避免同步 I/O 阻塞主线程
- **滚动节流**: `requestAnimationFrame` + `behavior: 'auto'` 替代平滑滚动
