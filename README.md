# Lunjiao - 部门智能问答系统

面向部门级的数据查询与分析工具，核心是"自然语言问，系统自动查数据、做分析"。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Ant Design 5 + Vite + react-router-dom |
| 后端 API | Python 3.11 + FastAPI (SSE 流式输出) |
| Agent | 原生 OpenAI SDK — ReAct 循环 + Function Calling（无 LangChain/LangGraph） |
| LLM | qwen3.6-35B-A3B-apex，本地 LM Studio (`localhost:1234/v1`) |
| Embedding | text-embedding-nomic-embed-text-v1.7 (768 维) |
| RAG 引擎 | RAG-Anything + LightRAG — MinerU PDF 解析、向量检索（naive 模式，无 KG 实体抽取） |
| MCP 数据查询 | MCP Server — MySQL 只读查询 (端口 8024) / 上传文件查询 (端口 8025) |
| 数据存储 | Zustand + localStorage 持久化；MySQL (后端) |

## 页面路由与导航

```
/          → 登录页（未认证时所有页面重定向至此）
/chat      → AI 智能问答（所有已认证用户）
/knowledge-base → 知识库管理（所有已认证用户）
/admin/users    → 用户管理（仅管理员）
```

登录后进入 `/chat`，顶部统一导航栏包含：
- **AI 智能问答** — ReAct Agent 对话 + SSE 流式输出
- **知识库管理** — 文档上传、RAG 索引、文件列表管理
- **用户管理** （仅管理员可见）— 新增/删除/改密用户账号，设置角色

右上角为退出按钮（带框体样式），点击清除认证状态并返回登录页。

## Agent 架构

```
用户问题
   │
   ▼
┌─────────────┐     tool_call      ┌──────────┐
│  LLM (ReAct) ├─────────────────> │ MCP Server│
│             │◄──────────────────  │ MySQL/上传 │
│  多轮推理     │    tool result     │  文件查询   │
└─────────────┘                     └──────────┘
   │
   ▼ RAG (query_rag) ──> RAG-Anything + LightRAG
                          (文档知识库，MinerU 解析 PDF/Excel 等)
```

**三个知识源（Agent 决策优先级）：**
1. **RAG 知识库** — `query_rag()`：上传的文档（PDF、Word、Excel、报告等），默认首选
2. **数据库** — `query_db()` + `list_db_tables()`：MySQL 结构化数据，只读 SELECT
3. **LLM 内置知识** — 当前两者无结果时的 fallback

## 项目结构

```
Lunjiao/
├── frontend/                # React 应用 (Vite)
│   ├── src/
│   │   ├── api/chat.ts      # API 客户端 (对话 SSE + 文件上传 + 用户管理)
│   │   ├── store/chatStore.tsx  # Zustand 状态管理 + localStorage 持久化
│   │   ├── types/chat.ts    # TypeScript 类型定义
│   │   ├── components/
│   │   │   ├── LoginPage.tsx         # 登录页 (账号密码认证)
│   │   │   ├── Sidebar.tsx           # 侧边栏 (历史对话)
│   │   │   ├── AppHeader.tsx         # 统一顶部导航 (标签 + 退出按钮)
│   │   │   ├── ChatPanel.tsx         # AI 智能问答面板 (SSE 流式渲染)
│   │   │   ├── AnalysisPanel.tsx     # 右侧分析面板
│   │   │   └── KbManagePage.tsx      # 知识库管理页 (上传 + 文件列表表格)
│   │   │   └── UserManagePage.tsx    # 用户管理页 (管理员: 新增/删除/改密)
│   │   ├── App.tsx          # 三栏式布局 (侧边栏 + 主对话区 + 分析面板)
│   │   └── main.tsx         # 入口
│   ├── package.json
│   └── vite.config.ts
├── backend/                 # Python 后端 (FastAPI)
│   ├── app/
│   │   ├── main.py          # FastAPI 入口 + CORS + SSE 路由挂载
│   │   ├── config.py        # Settings — LLM/MySQL/RAG/MCP 配置 (.env)
│   │   ├── rag_engine.py    # RAGEngineAdapter — RAG-Anything + LightRAG 封装
│   │   │                        · MinerU PDF 解析
│   │   │                        · .txt/.md/.csv/.xlsx 直接文本提取（绕过 MinerU）
│   │   │                        · LightRAG naive 向量检索 (无 KG)
│   │   ├── api/             # API 路由
│   │   │   ├── chat.py      # /api/chat/stream — SSE 流式对话 + /api/auth — 用户认证 CRUD
│   │   │   ├── upload.py    # /api/upload — 文件上传 + RAG 索引
│   │   │   ├── data_sources.py # 数据源管理 CRUD
│   │   │   └── history.py   # 历史记录 (内存)
│   │   ├── agent/           # Agent 核心 (原生 OpenAI SDK，无框架依赖)
│   │   │   ├── graph.py     # SYSTEM_PROMPT + ReAct 循环 (sync/stream)
│   │   │   ├── tools.py     # TOOL_FUNCTIONS: query_rag, query_db, list_db_tables
│   │   │                        · OpenAI-style tool schema (JSON)
│   │   │                        · HTTP client → MCP Server (MySQL/上传文件)
│   │   │   └── prompts.py   # 系统提示词 (三知识源决策逻辑)
│   │   ├── mcp_servers/     # MCP 独立服务器进程
│   │   │   ├── db_server.py      # MySQL 只读查询 (端口 8024)
│   │   │                        · POST /query — 安全 SELECT 执行
│   │   │                        · POST /tables — 按类别列出表
│   │   │                        · GET /health — 健康检查
│   │   │   └── upload_server.py  # 上传文件查询 (端口 8025)
│   │   │                        · POST /upload — 文件上传 + RAG 索引
│   │   │                        · POST /query — 自然语言查上传文件
│   │   │                        · GET /files — 列出已上传文件
│   │   ├── skills/          # 分析/报告模块 (待开发)
│   │   ├── models/          # 数据模型
│   │   └── services/        # 业务服务
│   ├── requirements.txt     # 依赖: fastapi, openai, mcp, raganything, pandas, sqlalchemy...
│   ├── .env.example         # 环境变量模板
│   └── venv/                # Python 虚拟环境 (gitignored)
├── docs/
│   └── 部署启动指南.md      # 完整部署说明
└── README.md
```

## Agent 工具清单

| 工具 | 功能 | 目标 |
|---|---|---|
| `query_rag(query, category)` | RAG 文档语义检索 | RAG-Anything (向量库) |
| `query_db(sql, data_category)` | SQL 查询执行 | MCP DB Server (`:8024`) |
| `list_db_tables(data_category)` | 列出可用表及行数 | MCP DB Server (`:8024`) |

**数据类别映射：**
- "设备" → `equipment` (设备信息、入库时间)
- "事件" → `event` (事件名称、时间、人员)
- "人事" → personnel 相关表
- "财务" → finance 相关表
- "全部" → 所有表

## RAG 索引机制

| 文件类型 | 处理方式 |
|---|---|
| `.txt`, `.md`, `.csv` | 直接文本提取 → LightRAG chunk upsert（跳过 MinerU，快速） |
| `.xlsx`, `.xls` | openpyxl 逐行提取为文本 → LightRAG chunk upsert |
| `.pdf`, `.docx`, `.pptx` | RAG-Anything MinerU 解析管线（完整文档处理） |

## 快速启动

### 前置条件

1. **LM Studio** — 运行本地 LLM + Embedding Server
   - LLM: `qwen3.6-35B-A3B-apex` (或兼容的 OpenAI API)
   - Embedding: `text-embedding-nomic-embed-text-v1.7`
   - 地址: `http://localhost:1234/v1`

2. **MySQL** — 部门数据库 (`lunjiao`)，已配置表结构

### 后端

```bash
cd backend
source venv/bin/activate          # 激活虚拟环境
uvicorn app.main:app --reload --port 8000   # API Server
```

MCP 数据库服务器（连接 MySQL）：
```bash
python -m app.mcp_servers.db_server    # 端口 8024
```

### 前端

```bash
cd frontend
npm run dev     # http://localhost:5173
```

## 功能模块

- **自然语言对话** — SSE 流式输出，Agent ReAct 推理 + 工具调用可视化
- **RAG 文档知识库** — CSV/XLSX/txt/md/PDF/Word 上传 → 自动索引 → 语义检索
- **MySQL 数据查询** — MCP Server 提供安全的只读 SELECT 查询，按部门类别筛选
- **多源融合回答** — Agent 自动判断使用 RAG、数据库或两者结合
- **三栏式布局** — 侧边栏（历史对话）+ 主对话区 + 分析面板

## 开发状态

### Phase 1 ✅ — 基础框架搭建
- [x] 前端项目 (Vite + React + TypeScript + Ant Design)
- [x] 后端 FastAPI (API 路由、CORS、SSE 支持)
- [x] 三栏布局：侧边栏 + 主对话区 + 分析面板

### Phase 2 ✅ — 对话核心 + 前端交互完善
- [x] SSE 流式对话接口 (`/api/chat/stream`)
- [x] Agent ReAct 工作流 (OpenAI tool-calling)
- [x] 数据类别选择 (人事/设备/财务/全部)
- [x] 对话气泡样式：用户居右（蓝色渐变）、助手居左（白色卡片）
- [x] 底部输入区：多行文本框 + 类别切换 + 发送按钮
- [x] 文件上传：拖拽/点击 + 文件列表 + 索引状态指示
- [x] localStorage 持久化 (对话、会话、上传文件)

### Phase 3 ✅ — MCP 数据查询服务器
- [x] MCP Database Server (`db_server.py`) — MySQL 只读查询
  - POST /query — 执行安全 SELECT 查询
  - POST /tables — 按类别列出表及行数
  - GET /health — 健康检查
- [x] MCP Upload Server (`upload_server.py`) — 上传文件查询
  - POST /upload — 上传 + RAG 索引
  - POST /query — 自然语言查文件内容
  - GET /files — 列出已上传文件

### 即将开发
- [ ] Phase 4: Skill 分析/报告/可视化模块
- [ ] Phase 5: 连接真实部门数据源 (MySQL 表对接)
- [ ] Phase 6: 分析面板 + 报告导出
- [ ] Phase 7: 优化与生产部署
