# Lunjiao - 部门智能问答系统

面向部门级的数据查询与分析工具，核心是"自然语言问，系统自动查数据、做分析"。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Ant Design 5 + ECharts |
| 后端 API | Python 3.11 + FastAPI |
| Agent 框架 | LangChain + LangGraph |
| 数据查询 | MCP (Model Context Protocol) — 独立服务器 |
| 数据存储 | MySQL |
| RAG 检索 | RAG-Anything (文档知识库) |
| 部署 | Docker Compose (规划中) |

## 项目结构

```
Lunjiao/
├── frontend/                # React 应用 (Vite)
│   ├── src/
│   │   ├── api/             # API 客户端
│   │   │   └── chat.ts      # 对话接口 + 文件上传接口
│   │   ├── store/
│   │   │   └── chatStore.tsx # Zustand 状态管理
│   │   ├── types/
│   │   │   └── chat.ts      # 类型定义
│   │   ├── components/      # UI 组件
│   │   │   ├── Sidebar.tsx           # 侧边栏 (历史对话、数据源入口)
│   │   │   ├── AppHeader.tsx         # 顶部工具栏
│   │   │   ├── ChatPanel.tsx         # 主对话区
│   │   │   ├── AnalysisPanel.tsx     # 右侧分析面板
│   │   │   ├── DataSourceModal.tsx   # 数据源管理弹窗
│   │   │   └── KbListModal.tsx       # 知识库列表弹窗
│   │   ├── App.tsx          # 主布局 (三栏式)
│   │   └── main.tsx         # 入口
│   ├── package.json
│   └── vite.config.ts
├── backend/                 # Python 后端 (FastAPI)
│   ├── app/
│   │   ├── main.py          # FastAPI 入口 + SSE 流式对话
│   │   ├── config.py        # 配置 (加载 .env)
│   │   ├── rag_engine.py    # RAG 检索引擎封装
│   │   ├── api/             # API 路由
│   │   │   ├── chat.py      # 对话接口
│   │   │   ├── upload.py    # 文件上传 (RAG 索引)
│   │   │   ├── data_sources.py # 数据源管理
│   │   │   └── history.py   # 历史记录
│   │   ├── agent/           # LangGraph Agent
│   │   │   ├── graph.py     # 状态图定义 + 流式执行
│   │   │   ├── tools.py     # Agent 工具注册
│   │   │   └── prompts.py   # 系统提示词
│   │   ├── mcp_servers/     # MCP 独立服务器进程
│   │   │   ├── db_server.py      # MySQL 只读查询 (端口 8024)
│   │   │   └── upload_server.py  # 上传文件查询 (端口 8025)
│   │   ├── skills/          # 分析/报告模块
│   │   ├── models/          # 数据模型
│   │   └── services/        # 业务服务
│   ├── requirements.txt
│   ├── .env.example         # 环境变量模板
│   └── venv/                # Python 虚拟环境
├── docs/
│   └── 部署启动指南.md      # 完整部署说明
└── README.md
```

## 快速启动

### 后端

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

MCP 数据库服务器（连接 MySQL）：

```bash
source venv/bin/activate
python -m app.mcp_servers.db_server
```

MCP 上传文件服务器：

```bash
source venv/bin/activate
python -m app.mcp_servers.upload_server
```

### 前端

```bash
cd frontend
npm run dev
```

访问 http://localhost:5173

## 功能模块

- **自然语言对话** — SSE 流式输出，支持多轮历史上下文
- **文件上传与知识库检索** — CSV/XLSX 上传后自动索引，通过 RAG 检索
- **数据库查询** — MCP Server 提供安全的只读 SELECT 查询
- **数据源管理** — 可视化配置与管理数据源连接
- **三栏式布局** — 侧边栏（历史/设置）+ 主对话区 + 分析面板

## 开发状态

### Phase 1 ✅ — 基础框架搭建
- [x] 初始化前端项目 (Vite + React + TypeScript + Ant Design)
- [x] 初始化后端 FastAPI 项目 (API 路由、CORS、SSE)
- [x] 经典三栏布局：侧边栏 + 主对话区 + 分析面板

### Phase 2 ✅ — 对话核心 + 前端交互完善
- [x] SSE 流式对话接口 (`/api/chat/stream`)
- [x] LangGraph Agent 基础工作流
- [x] 数据类别选择 (人事/设备/财务/全部)
- [x] 对话气泡样式：用户居右（蓝色渐变）、助手居左（白色卡片）
- [x] 底部输入区：多行文本框 + 类别切换 + 发送按钮
- [x] 上传文件：拖拽/点击上传 + 文件列表 + 索引状态指示
- [x] 数据源指示器动态显示覆盖数

### Phase 3 ✅ — MCP 数据查询服务器
- [x] MCP Database Server (`db_server.py`) — MySQL 只读查询
  - POST /query — 执行安全的 SELECT 查询
  - POST /tables — 按类别列出表
  - GET /health — 健康检查
- [x] MCP Upload Server (`upload_server.py`) — 上传文件查询
  - POST /upload — 上传 CSV/XLSX
  - POST /query — 自然语言查询上传的文件
  - GET /files — 列出已上传文件

### 即将开发
- [ ] Phase 4: Skill 分析/报告/可视化模块
- [ ] Phase 5: 连接真实数据源
- [ ] Phase 6: 分析面板 + 报告导出
- [ ] Phase 7: 优化与生产部署
