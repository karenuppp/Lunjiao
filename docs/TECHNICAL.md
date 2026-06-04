# Zhiwei 核心技术文档

> 面向非技术背景维护者。每次修改功能或调整架构后，**必须同步更新本文档**。

## 目录

- [1. 概述](#1-概述)
- [2. 核心概念速览](#2-核心概念速览)
- [3. 系统架构](#3-系统架构)
- [4. 一次完整的问答之旅](#4-一次完整的问答之旅)
- [5. Agent 引擎详解](#5-agent-引擎详解)
- [6. SSE 事件系统](#6-sse-事件系统)
- [7. 工具系统](#7-工具系统)
- [8. RAG 检索引擎](#8-rag-检索引擎)
- [9. 经验系统](#9-经验系统)
- [10. 前后端连接](#10-前后端连接)
- [11. 数据隔离模型](#11-数据隔离模型)
- [12. 配置参考](#12-配置参考)
- [13. 关键文件索引](#13-关键文件索引)
- [14. 文档维护约定](#14-文档维护约定)

---

## 1. 概述

Zhiwei（知微）是一个部门级智能问答系统。用户用中文提问，系统自动检索已上传的文档和连接的数据库，生成回答。

**技术栈一句话：** Python 后端（FastAPI）+ React 前端 + OpenAI 兼容大模型，无第三方 Agent 框架依赖。

**核心能力：**
- 语义搜索已上传的文档（RAG）
- 将中文问题转成 SQL 查询数据库（Text-to-SQL）
- 从历史对话中自动提取经验，辅助未来回答
- 用户隔离：每个人的知识库和数据库权限独立

---

## 2. 核心概念速览

如果你对 Web 开发或 AI 系统不太熟悉，先花 5 分钟看这几个概念，后面的内容会好理解很多。

### 2.1 前端 vs 后端

```
浏览器（前端）  ←→  服务器（后端）  ←→  大模型 / 数据库
```

- **前端**：你在浏览器里看到的页面（React 写的）。负责界面渲染、用户交互。
- **后端**：服务器上跑的程序（Python FastAPI 写的）。负责处理请求、调用大模型、查数据库。
- **大模型（LLM）**：类似 ChatGPT 的 AI 服务，运行在本地或远程。

### 2.2 什么是 LLM / 大模型

LLM（Large Language Model）= 大语言模型。一句话理解：**一个能听懂人话、会回答问题、能调用工具的 AI 程序。**

在 Zhiwei 中，LLM 负责：
1. 理解用户的问题
2. 决定需要调用哪些工具（查文档？查数据库？）
3. 根据工具返回的结果，组织最终回答

我们用的是 OpenAI 兼容接口，本地跑什么模型都可以（Qwen、Llama 等），只要支持 Function Calling（工具调用）。

### 2.3 什么是 RAG

RAG（Retrieval-Augmented Generation）= 检索增强生成。

简单说：**先搜后答。** 用户上传的文档（PDF、Word、Excel 等）被切成小块，转换成向量（一串数字，代表这段文字的"语义指纹"）。用户提问时，系统找到语义最相似的文档片段，把它们塞进 LLM 的提示词里，让 LLM 基于这些真实资料来回答。

这样做的好处：LLM 不会凭空编造答案，而是基于你上传的文档来回答。

### 2.4 什么是 ReAct

ReAct = Reasoning + Acting，即"思考 + 行动"。

传统 LLM 用法：你问一句，它答一句。
ReAct 用法：LLM 先思考要不要用工具，然后用工具，看工具返回的结果，再决定要不要再用工具，最后给出答案。循环往复，直到找到足够的信息。

```
第 1 轮：LLM 想 → "我需要查一下文档" → 调用 RAG 工具 → 拿到文档片段
第 2 轮：LLM 想 → "文档还不够，我再查下数据库" → 调用 SQL 工具 → 拿到数据
第 3 轮：LLM 想 → "信息够了，开始回答" → 输出最终答案
```

### 2.5 什么是 Function Calling / 工具调用

Function Calling 是 LLM 的一种能力：**LLM 不直接执行函数，而是"说"它想调用哪个函数、传什么参数。**

流程：
1. 我们告诉 LLM："你有这些工具可以用"（比如查文档、查数据库）
2. LLM 分析用户问题，如果觉得需要工具，就返回一个 JSON：`{"function": "query_rag", "arguments": {"query_text": "离职流程"}}`
3. 我们的程序（不是 LLM）去真正执行这个函数，把结果返回给 LLM
4. LLM 看着结果，决定是回答还是继续用工具

### 2.6 什么是 SSE

SSE（Server-Sent Events）= 服务器推送事件。一种让服务器"慢慢"把数据推给浏览器的技术。

对比：
- **普通 HTTP 请求**：浏览器提问 → 服务器算完 → 一次性返回全部答案（用户等很久）
- **SSE 流式请求**：浏览器提问 → 服务器边算边推 → 每算出几个字就推给浏览器 → 浏览器实时显示（像 ChatGPT 那样逐字输出）

在 Zhiwei 中，SSE 不仅传输文字，还传输"工具调用开始了""工具调用结束了""数据来源是哪里"等结构化事件。

---

## 3. 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      浏览器 (React SPA)                           │
│                                                                   │
│  URL 路由:                                                        │
│    /                → 登录页                                       │
│    /chat            → 智能问答（主页面）                             │
│    /knowledge-base  → 知识库管理（上传/查看/删除文档）                │
│    /admin/users     → 用户管理（管理员）                             │
│    /admin/database  → 数据库连接管理（管理员）                       │
│    /admin/prompt    → 提示词模板管理（管理员）                       │
│    /admin/experience → 经验管理（管理员）                            │
│                                                                   │
│  前端状态管理: useReducer + Context (chatStore.tsx)                │
│  流式接收: EventSource 方式解析 SSE 事件                             │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP / SSE 流式
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                     FastAPI (:8000)                                │
│                                                                   │
│  API 路由层 (app/api/)                                             │
│  ├─ chat.py        POST /api/chat/stream  (SSE 流式问答)           │
│  │                 POST /api/chat/        (同步问答)               │
│  │                 POST /api/chat/feedback (点赞/踩)              │
│  ├─ auth.py        POST /api/auth/login   (登录)                  │
│  │                 /api/auth/users         (用户 CRUD)            │
│  ├─ upload.py      POST /api/upload/       (文件上传)              │
│  │                 /api/upload/files       (文件管理)              │
│  ├─ history.py     /api/history/           (对话持久化)            │
│  ├─ prompt.py      /api/prompt/            (提示词管理)            │
│  └─ db_connections.py  /api/db-connections/ (数据库连接管理)        │
│                                                                   │
│  Agent 引擎层 (app/agent/)                                         │
│  ├─ agent.py       ReActAgent — ReAct 循环核心                     │
│  ├─ events.py      AgentEvent 事件系统 — 9 种类型化事件              │
│  ├─ tools.py       Tool 定义 + 执行 — 7 个工具                      │
│  ├─ config.py      AgentConfig / ReActConfig — 可注入参数          │
│  ├─ graph.py       薄封装层 — 向后兼容的公共 API                     │
│  └─ prompts.py     默认系统提示词（备用）                            │
│                                                                   │
│  服务层 (app/services/)                                            │
│  ├─ experience_service.py  经验提取/检索/去重                       │
│  └─ db_service.py          MySQL 连接池管理                         │
│                                                                   │
│  数据层                                                           │
│  ├─ database.py    SQLAlchemy ORM 配置                             │
│  ├─ models/        ORM 模型: User, DbConnection, SystemPrompt     │
│  └─ rag_engine.py  RAG-Anything + LightRAG 封装                    │
└──────┬──────────────────────┬──────────────────┬──────────────────┘
       │                      │                  │
┌──────▼──────┐  ┌────────────▼──────┐  ┌───────▼──────────┐
│   LLM 服务   │  │     MySQL         │  │   文件系统        │
│  :1234/v1   │  │     :3306         │  │                  │
│             │  │                   │  │  uploads/ 上传文件 │
│ OpenAI 兼容  │  │  库: zhiwei       │  │  talk/    对话记录 │
│ (LM Studio  │  │  表: users,       │  │                  │
│  / vLLM)    │  │      db_          │  │                  │
│             │  │      connections, │  │                  │
│             │  │      system_      │  │                  │
│             │  │      prompts,     │  │                  │
│             │  │      experiences, │  │                  │
│             │  │      skills       │  │                  │
└─────────────┘  └───────────────────┘  └──────────────────┘
```

### 关键设计决策

| 决策 | 原因 |
|------|------|
| 不用 LangChain/LangGraph | 减少依赖、黑盒少、调试直观 |
| 原生 OpenAI SDK | Function Calling 直接对接，代码量少 |
| SSE 而非 WebSocket | 单向推送足够，实现更简单 |
| 类型化事件系统 | 编译期安全，前后端契约清晰 |
| 对话持久化到 JSON 文件 | 无需额外数据库表，直接可读 |
| 用户隔离在应用层 | 而非数据库层，灵活度高 |
| RAG 引擎进程内运行 | 减少网络延迟，简化部署 |

---

## 4. 一次完整的问答之旅

这是 Zhiwei 最核心的流程：用户输入一个问题，系统如何一步步产生回答。

### 4.1 整体时序

```
用户                 前端                  后端                    LLM
 │                   │                    │                       │
 │  输入"离职流程"     │                    │                       │
 │──────────────────>│                    │                       │
 │                   │                    │                       │
 │                   │  POST /api/chat/stream                      │
 │                   │───────────────────>│                       │
 │                   │                    │  构建消息列表           │
 │                   │                    │  (系统提示词+历史+问题)  │
 │                   │                    │                       │
 │                   │  SSE: reply_start  │                       │
 │                   │<───────────────────│                       │
 │                   │                    │                       │
 │                   │                    │  第1轮: 发送消息+工具列表 │
 │                   │                    │──────────────────────>│
 │                   │                    │                       │
 │                   │                    │  LLM 返回:             │
 │                   │                    │  "调用 query_rag"      │
 │                   │                    │<──────────────────────│
 │                   │                    │                       │
 │                   │  SSE: tool_call_start                      │
 │                   │<───────────────────│                       │
 │                   │  (前端显示"检索知识库…") │                    │
 │                   │                    │                       │
 │                   │                    │  执行 RAG 检索          │
 │                   │                    │  拿到 3 个文档片段      │
 │                   │                    │                       │
 │                   │  SSE: tool_call_end│                       │
 │                   │<───────────────────│                       │
 │                   │                    │                       │
 │                   │                    │  第2轮: 把工具结果发给LLM │
 │                   │                    │──────────────────────>│
 │                   │                    │                       │
 │                   │                    │  LLM 逐字输出回答       │
 │                   │  SSE: text_delta × N                       │
 │                   │<───────────────────│ (每几个字一个事件)       │
 │                   │  (前端逐字显示)     │                       │
 │                   │                    │                       │
 │                   │  SSE: data_source  │                       │
 │                   │<───────────────────│                       │
 │                   │                    │                       │
 │                   │  SSE: final_answer │                       │
 │                   │<───────────────────│                       │
 │                   │                    │                       │
 │                   │                    │  保存对话到文件          │
 │                   │                    │  (用户消息+AI回答)      │
 │                   │                    │                       │
```

### 4.2 各阶段详解

#### 阶段 1：前端发起请求

文件：`frontend/src/store/chatStore.tsx` → `sendChat()`

```typescript
// 1. 如果没有活跃对话，自动创建
let convId = state.activeConversationId
if (!convId) {
    convId = `conv-${Date.now()}-随机字符`
    dispatch({ type: 'NEW_CONVERSATION', payload: { id: convId } })
}

// 2. 添加用户消息到界面
dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: '离职流程' } })

// 3. 添加空的 AI 消息占位（后面流式填充）
dispatch({ type: 'ADD_MESSAGE', payload: { role: 'assistant', content: '' } })

// 4. 设置加载状态
dispatch({ type: 'SET_LOADING', payload: true })

// 5. 发起 SSE 流式请求
sendChatStream({ message: '离职流程', conversation_id: convId, ... }, onEvent)
```

#### 阶段 2：后端接收并启动 Agent

文件：`backend/app/api/chat.py` → `chat_stream()`

```python
# 1. 获取或创建对话文件（持久化到 talk/ 目录）
conv_id, history = _get_or_create_conversation(request.conversation_id, user_id)

# 2. 从数据库查询用户权限（kb_scope, db_scope）
kb_scope, db_scope, exp_extract_enabled = _resolve_permissions(user_id)

# 3. 创建事件生成器，开启流式响应
async for event in run_agent_stream_simple(question="离职流程", ...):
    yield event.to_sse()  # 转为 SSE 格式推给前端

# 4. 流结束后，保存双方消息到对话文件
_add_to_history(conv_id, "user", "离职流程")
_add_to_history(conv_id, "assistant", final_answer)
```

#### 阶段 3：Agent ReAct 循环

文件：`backend/app/agent/agent.py` → `ReActAgent.run_stream()`

这是系统的大脑。核心逻辑：

```python
# 第 1 步：发送系统提示词 + 用户问题 + 可用工具列表给 LLM
# 第 2 步：LLM 返回 —— 是一段文字？还是要调用工具？
#   如果返回文字 → 这就是最终答案，结束循环
#   如果返回工具调用 → 执行工具，把结果追加到对话中，回到第 1 步
# 第 3 步：最多 5 轮（max_rounds），超过则强制 LLM 生成最终答案

for round_idx in range(max_rounds + 1):
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,       # 包含系统提示词 + 历史 + 所有工具交互
        tools=tool_schemas,      # 告诉 LLM 有哪些工具可用
        tool_choice="auto",      # LLM 自己决定要不要用工具
        stream=True,             # 流式返回
    )

    # 收集 LLM 的流式输出
    for chunk in stream:
        if chunk 是文字:
            yield TextDeltaEvent(delta=chunk)  # 逐字推给前端
        if chunk 是工具调用:
            收集工具调用信息

    if 没有工具调用:
        # LLM 直接回答了，结束
        final_answer = 收集到的文字
        break

    if 有工具调用:
        for 每个工具:
            yield ToolCallStartEvent(...)      # 通知前端"开始执行工具"
            result = await execute_tool(...)   # 真正执行工具
            yield ToolCallEndEvent(...)        # 通知前端"工具执行完毕"

# 循环结束后，发送最终事件
yield FinalAnswerEvent(text=final_answer, message_id=msg_id)
```

#### 阶段 4：前端渲染流式内容

文件：`frontend/src/store/chatStore.tsx` → SSE 回调

前端收到不同的 SSE 事件，分别处理：

```
text_delta      → 往 AI 消息末尾追加文字 → 界面实时显示
tool_call_start → 显示工具调用指示器（"检索知识库…"）
tool_call_end   → 隐藏工具调用指示器
data_source     → 记录数据来源
final_answer    → 标记回答完成，设置消息 ID
error           → 显示错误信息
```

---

## 5. Agent 引擎详解

### 5.1 模块职责

```
app/agent/
├── agent.py      ReActAgent 类 — 同步/流式两种模式
├── events.py     AgentEvent 基类 + 9 种具体事件类型
├── config.py     AgentConfig / ReActConfig — 参数通过配置注入
├── tools.py      Tool 的 Schema 定义 + 执行逻辑
├── graph.py      薄封装 — 构建消息、暴露 run_agent_sync/run_agent_stream_simple
└── prompts.py    默认系统提示词（数据库不可用时备用）
```

### 5.2 ReActAgent 两种模式

| 特性 | 同步模式 `run_sync()` | 流式模式 `run_stream()` |
|------|---------------------|------------------------|
| 返回值 | `(answer, data_sources)` 元组 | `AsyncIterator[AgentEvent]` |
| 调用方 | `/api/chat/` (非流式接口) | `/api/chat/stream` (SSE 流式) |
| 用户体验 | 等全部完成才显示 | 逐字实时显示 |
| 工具调用 | 内部累积 | 每个工具开始/结束都发事件 |

### 5.3 AgentConfig 可配置参数

文件：`backend/app/agent/config.py`

```python
@dataclass
class ReActConfig:
    max_rounds: int = 5       # 最大工具调用轮数（超过后强制输出答案）
    temperature: float = 0.2  # LLM 温度（越低越确定，越高越随机）
    stream_tokens: bool = True # 是否逐 token 推送（关闭则一次性返回）
    tool_choice: str = "auto"  # auto/none/required

@dataclass
class AgentConfig:
    model: str = ""            # 模型名，空则用环境变量 MODEL_NAME
    react: ReActConfig = ...   # ReAct 循环参数
```

### 5.4 系统提示词

Agent 每次对话开始时，第一条消息是"系统提示词"——告诉 LLM 它是谁、有什么能力、怎么回答问题、有哪些工具可用。

**加载优先级：**
1. 数据库 `system_prompts` 表中 `prompt_key='default'` 的记录
2. 如果数据库不可用，用 `agent/prompts.py` 中的 `DEFAULT_SYSTEM_PROMPT`

系统提示词在模块加载时读取一次（`SYSTEM_PROMPT = _load_system_prompt()`），不会每次请求都查数据库。

---

## 6. SSE 事件系统

### 6.1 设计理念

文件：`backend/app/agent/events.py`

类型化事件系统——每种事件是一个独立的 dataclass，继承自 `AgentEvent` 基类。前端通过事件类型字符串（`event_type`）匹配处理。

```
AgentEvent (基类)
├── ReplyStartEvent       → event: reply_start       对话开始
├── TextDeltaEvent        → event: text_delta        逐字输出
├── ThinkingDeltaEvent    → event: thinking_delta    思考过程（预留，暂未启用）
├── ToolCallStartEvent    → event: tool_call_start   工具开始执行
├── ToolCallEndEvent      → event: tool_call_end     工具执行完毕
├── DataSourceEvent       → event: data_source       数据来源汇总
├── FinalAnswerEvent      → event: final_answer      回答完成
├── ErrorEvent            → event: error             执行出错
└── ExperienceSuggestEvent → event: experience_suggest 建议提取经验
```

### 6.2 事件字段说明

每个事件都有 3 个基础字段（来自基类）：`event_id`（唯一 ID）、`timestamp`（时间戳）、`round_idx`（当前是第几轮）。

| 事件 | 特有字段 | 说明 |
|------|---------|------|
| `ReplyStartEvent` | `conversation_id` | 对话 ID，前端用于关联状态 |
| `TextDeltaEvent` | `delta` | 增量文本（几个字或一个词） |
| `ToolCallStartEvent` | `tool_name`, `tool_label`, `input_args` | 工具名、人类可读标签、参数 |
| `ToolCallEndEvent` | `tool_name`, `result_preview` | 工具名、结果预览（前200字） |
| `DataSourceEvent` | `sources` | 数据来源列表，如 `["检索知识库", "查询数据库"]` |
| `FinalAnswerEvent` | `text`, `message_id` | 完整回答文本、服务器端消息 ID |
| `ErrorEvent` | `message` | 错误描述 |
| `ExperienceSuggestEvent` | `topic`, `summary`, `message_id` | 建议提取的经验主题、摘要 |

### 6.3 SSE 传输格式

事件对象通过 `to_sse()` 方法转为标准 SSE 格式：

```
event: text_delta
data: {"event_id":"a1b2c3d4","timestamp":"2026-06-04T...","round_idx":0,"delta":"离职"}

event: final_answer
data: {"event_id":"e5f6g7h8","timestamp":"2026-06-04T...","round_idx":-1,"text":"离职流程是...","message_id":"msg-1234567890-ai"}
```

### 6.4 前端事件处理

文件：`frontend/src/store/chatStore.tsx` → `sendChat()` 的 SSE 回调

```
reply_start       → 忽略（仅用于后端通知对话已创建）
text_delta/token  → APPEND_STREAMING（往当前 AI 消息追加文字）
tool_call_start   → SET_CURRENT_TOOL（显示工具调用指示器）
tool_call_end     → SET_CURRENT_TOOL(null)（隐藏指示器）
data_source       → 收集数据来源列表
final_answer      → FINALIZE_STREAMING（标记完成）+ SET_MESSAGE_ID
experience_suggest → SET_EXPERIENCE_SUGGEST（弹出经验保存提示）
error             → FINALIZE_STREAMING（显示错误信息）
```

向后兼容：前端同时支持新事件名（`text_delta`）和旧事件名（`token`），优先取新字段名（`delta`），回退到旧字段名（`text`）。

---

## 7. 工具系统

### 7.1 可用工具一览

| 工具名 | 功能 | 谁可以用 |
|--------|------|---------|
| `query_rag` | 语义搜索已上传文档 | 所有用户（受 kb_scope 限制） |
| `query_db` | 执行只读 SQL | 有 db_scope 的用户 |
| `list_db_tables` | 列出数据库表结构 | 有 db_scope 的用户 |
| `list_db_connections` | 列出可用数据库 | 有 db_scope 的用户 |
| `query_experience` | 搜索历史经验 | 所有用户（用户隔离） |
| `find_file_by_name` | 按文件名查找并读取内容 | 所有用户（用户隔离） |
| `use_skill` | 加载技能规范 | 所有用户 |

### 7.2 工具的定义方式

每个工具有两部分：

1. **Schema（告诉 LLM 有什么工具）**：OpenAI 格式的 JSON Schema，描述工具名、功能、参数。
2. **实际函数（真正执行）**：Python async 函数，从 `TOOL_FUNCTIONS` 字典中按名字查找并执行。

```python
# Schema — 告诉 LLM
{
    "type": "function",
    "function": {
        "name": "query_rag",
        "description": "Search uploaded documents via the local RAG engine...",
        "parameters": {
            "type": "object",
            "properties": {
                "query_text": {"type": "string", "description": "..."},
                "category": {"type": "string", "default": ""},
                "top_k": {"type": "integer", "default": 5}
            },
            "required": ["query_text"]
        }
    }
}

# 实际函数
async def query_rag(query_text: str, category: str = "", top_k: int = 5,
                    user_id: str = "default", kb_scope: str = "personal") -> str:
    # 实际执行 RAG 检索，返回文档片段
    ...
```

### 7.3 权限执行

文件：`backend/app/agent/tools.py` → `execute_tool()`

工具执行器根据工具名注入权限参数：

```python
if name == "query_rag":
    kwargs["user_id"] = user_id    # 用户隔离
    kwargs["kb_scope"] = kb_scope  # 知识库权限范围
elif name in ("list_db_connections", "list_db_tables", "query_db"):
    kwargs["db_scope"] = db_scope  # 数据库权限范围
```

权限来自用户表（`User.kb_scope`, `User.db_scope`），管理员在"用户管理"页面配置。

---

## 8. RAG 检索引擎

### 8.1 架构

文件：`backend/app/rag_engine.py`

```
RAGAnything (文档解析+向量化) + LightRAG (向量检索+图谱检索)
```

### 8.2 文档处理流程

```
上传文件
  ↓
检测文件类型
  ├── 文本类 (.txt/.md/.csv) → 直接读取
  ├── Office (.docx/.xlsx/.pptx) → python-docx/openpyxl 提取文字
  ├── PDF → pymupdf 提取文字
  ├── 图片 (.png/.jpg) → OCR（如果配置了）
  └── 压缩包 (.zip/.rar/.7z/.tar.gz) → 解压后逐个处理
  ↓
文本分块 (chunking)
  ↓
Embedding 向量化 (text-embedding-nomic-embed-text-v1.5, 768维)
  ↓
存入向量数据库
  ↓
同时存入 LightRAG 图谱
```

### 8.3 检索流程

```
用户提问
  ↓
文本向量化 (同一 Embedding 模型)
  ↓
向量相似度搜索 (余弦相似度，阈值 0.3)
  ↓
同时关键词搜索 (LightRAG)
  ↓
合并去重
  ↓
按相似度排序，取 Top-K (默认 5 个片段)
  ↓
格式化返回给 LLM
```

### 8.4 用户隔离

- 每个文件关联 `user_id`
- 检索时只搜当前用户的文档
- `kb_scope = "public"` 的用户还可以搜索 `default` 用户的公共文档
- `kb_scope = "none"` 的用户不能使用 RAG

---

## 9. 经验系统

### 9.1 概述

经验系统从优质问答中自动提取"经验"（短小精悍的知识片段），在后续对话中注入到系统提示词里，辅助 LLM 回答。

### 9.2 经验来源（双路径）

1. **用户点赞触发**：用户点赞 → 后台异步提取 QA 对 → LLM 判断是否值得保存 → 写入经验库
2. **AI 主动检测**：ReAct 循环结束后，Agent 分析对话特征（纠正次数、探索深度、知识信号）→ 如果判定为"学习时刻"→ 产出 `ExperienceSuggestEvent` → 前端弹出提示让用户确认

### 9.3 经验生命周期

```
QA 对产生
  ↓
触发检测（点赞 or AI 主动检测）
  ↓
LLM 提取经验（topic + summary）
  ↓
语义去重（与已有经验比较，相似度 > 0.85 则跳过）
  ↓
写入经验库，状态 = "pending"
  ↓
管理员审核（通过/拒绝）
  ↓
通过的经验参与后续检索
```

### 9.4 经验评分（复合公式）

```
score = confidence × (1 + 0.1 × access_count) × decay_factor

decay_factor = e^(-λ × days_since_last_access)
```

- `confidence`：初始置信度（LLM 评估或管理员设置）
- `access_count`：被检索到的次数（热度加成）
- `decay_factor`：时间衰减（长期不用则降分）

---

## 10. 前后端连接

### 10.1 通信方式

| 场景 | 方式 | 端点 |
|------|------|------|
| 流式问答 | SSE | `POST /api/chat/stream` |
| 同步问答 | JSON | `POST /api/chat/` |
| 登录 | JSON | `POST /api/auth/login` |
| 文件上传 | FormData | `POST /api/upload/batch` |
| 对话列表/消息 | JSON | `GET /api/history/` |
| 其他 CRUD | JSON | 各自端点 |

### 10.2 开发环境代理

Vite 开发服务器（:5173）将 `/api/*` 请求代理到后端（:8000）：

```typescript
// frontend/vite.config.ts
server: {
    proxy: {
        '/api': 'http://localhost:8000'
    }
}
```

生产环境下，FastAPI 直接 serve 前端静态文件（`frontend/dist/`），不需要代理。

### 10.3 前端状态管理

文件：`frontend/src/store/chatStore.tsx`

```
ChatProvider (Context + useReducer)
├── state: ChatState
│   ├── conversations[]         对话列表
│   │   └── messages[]          每条对话的消息
│   ├── activeConversationId    当前活跃对话
│   ├── isLoading               是否正在等待 AI 回复
│   ├── currentTool             当前正在执行的工具名
│   ├── uploadedFiles[]         已上传的文件列表
│   └── loggedIn / userId / role 用户信息
│
└── actions (通过 dispatch 触发)
    ├── NEW_CONVERSATION         创建新对话
    ├── ADD_MESSAGE              添加消息
    ├── APPEND_STREAMING         流式追加文字
    ├── FINALIZE_STREAMING       完成流式输出
    └── SET_CURRENT_TOOL         设置当前工具
```

### 10.4 持久化策略

```
┌─────────────────────────────────────────────┐
│              对话数据存在哪里？                 │
├─────────────────────────────────────────────┤
│                                              │
│  前端 localStorage                           │
│  ├─ 键: zhiwei_conversations                 │
│  ├─ 存: 对话列表 + 消息 + 活跃对话 ID           │
│  ├─ 目的: 刷新页面不丢数据                     │
│  └─ 限制: 同浏览器同设备                       │
│                                              │
│  后端 talk/ 目录                              │
│  ├─ 文件: {conv_id}.json                     │
│  ├─ 存: 完整对话（消息 + 用户 ID + 时间戳）     │
│  ├─ 目的: 切换设备/重新登录后恢复               │
│  └─ 按 user_id 过滤，用户隔离                 │
│                                              │
│  同步机制:                                    │
│  1. 对话创建 → 同时在前端 state + 后端文件       │
│  2. 每次问答 → 后端保存双方消息到文件            │
│  3. 刷新页面 → 从 localStorage 恢复             │
│  4. 重新登录 → 从服务端加载对话列表              │
│  5. 点击历史对话 → 从服务端加载该对话的完整消息    │
│                                              │
└─────────────────────────────────────────────┘
```

### 10.5 性能优化

前端在流式输出时有以下优化防止卡死：

| 优化 | 实现 | 效果 |
|------|------|------|
| Markdown 防抖渲染 | `StreamingMarkdown` 组件，每 150ms 更新一次 | 不会每个 token 都触发 Markdown 解析 |
| 消息组件记忆化 | `React.memo(MessageItem)` | 未变化消息不重新渲染 |
| localStorage 节流 | 每 3 秒最多写一次 | 避免同步 I/O 阻塞主线程 |
| 滚动节流 | `requestAnimationFrame` + `behavior: 'auto'` | 避免平滑滚动造成的性能问题 |

---

## 11. 数据隔离模型

每个用户有三个权限维度，所有权限检查在 Agent 工具执行层完成。

### 11.1 权限字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `kb_scope` | `"personal"` / `"public"` / `"none"` | `personal`: 只能搜自己的文档 / `public`: 还可搜 default 的公共文档 / `none`: 不能用 RAG |
| `db_scope` | `list[int]` / `null` | `null`: 所有数据库 / `[]` 空列表: 禁止 / `[1,2]`: 指定连接 |
| `exp_extract_enabled` | `bool` | 点赞后是否自动提取经验 |

### 11.2 权限执行点

在 `tools.py` 的 `execute_tool()` 中，每个需要隔离的工具都会被注入：

- `query_rag` → 注入 `user_id` + `kb_scope`
- `list_db_connections` / `list_db_tables` / `query_db` → 注入 `db_scope`
- `query_experience` / `find_file_by_name` → 注入 `user_id`

管理员在"用户管理"页面为每个用户单独配置权限。

---

## 12. 配置参考

完整环境变量见 `README.md`。这里列出与核心行为直接相关的：

| 变量 | 默认值 | 对系统行为的影响 |
|------|--------|----------------|
| `MODEL_NAME` | `qwen3.6-35B-A3B-apex` | LLM 模型，影响回答质量 |
| `OPENAI_BASE_URL` | `http://localhost:1234/v1` | LLM 服务地址 |
| `RAG_CHUNK_TOP_K` | `5` | RAG 每次返回几个文档片段 |
| `RAG_COSINE_THRESHOLD` | `0.3` | 向量相似度最低阈值（越低越宽松） |
| `RAG_MAX_CONTEXT_TOKENS` | `1200` | 文档上下文最大 token 数 |
| `EXPERIENCE_TOP_K` | `3` | 每次检索几条经验 |
| `EXPERIENCE_DEDUP_THRESHOLD` | `0.85` | 经验去重阈值（越高越严格） |
| `TALK_DIR` | `/app/talk` | 对话文件存储目录 |

Agent 内部参数（不在环境变量中，在 `config.py`）：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_rounds` | `5` | ReAct 最大循环轮数 |
| `temperature` | `0.2` | LLM 温度 |
| `stream_tokens` | `True` | 是否逐 token 推送文字 |

---

## 13. 关键文件索引

### 如果只改一个文件，最可能需要看的其他文件

```
改这个文件              要看这些文件（可能受影响）
──────────────────────────────────────────────────────────────
agent/agent.py      →  api/chat.py, agent/events.py, agent/config.py
agent/events.py     →  api/chat.py, agent/agent.py, frontend chatStore.tsx
agent/tools.py      →  services/, agent/agent.py (工具被调用处)
agent/config.py     →  agent/agent.py (参数被读取处)
api/chat.py         →  agent/graph.py, agent/events.py, api/history.py
api/history.py      →  api/chat.py (共享 persistent_store)
rag_engine.py       →  agent/tools.py (query_rag 工具)
chatStore.tsx       →  api/chat.ts, agent/events.py (SSE 事件名)
```

### 完整文件清单

```
项目根目录
├── README.md                      项目概览 + 部署指南
├── docs/TECHNICAL.md              核心本文档——技术深度参考
├── DEPLOY.md                      离线部署详细指南
├── Dockerfile                     Docker 镜像构建
├── CLAUDE.md                      Claude Code 使用指南

backend/
├── app/
│   ├── main.py                    FastAPI 入口 + 静态文件服务
│   ├── config.py                  所有环境变量配置 (Settings)
│   ├── database.py                SQLAlchemy + 自动建表
│   ├── rag_engine.py              RAG 引擎封装
│   ├── agent/
│   │   ├── agent.py               ★ ReActAgent — 同步/流式循环
│   │   ├── events.py              ★ AgentEvent — 9种类型化事件
│   │   ├── tools.py               ★ Tool Schema + 7个工具实现
│   │   ├── config.py              AgentConfig / ReActConfig
│   │   ├── graph.py               公共 API 封装层
│   │   └── prompts.py             默认系统提示词
│   ├── api/
│   │   ├── chat.py                ★ 对话接口 (SSE流式 + 同步)
│   │   ├── auth.py                登录 + 用户 CRUD
│   │   ├── upload.py              文件上传/删除/分类
│   │   ├── history.py             ★ 对话持久化 (JSON文件)
│   │   ├── prompt.py              提示词 CRUD
│   │   └── db_connections.py      数据库连接管理
│   ├── services/
│   │   ├── experience_service.py  经验提取/检索/去重
│   │   └── db_service.py          MySQL 连接池
│   └── models/
│       ├── user.py                User ORM
│       ├── db_connection.py       DbConnection ORM
│       └── system_prompt.py       SystemPrompt ORM
└── requirements.txt

frontend/
├── src/
│   ├── App.tsx                    路由 + 布局
│   ├── api/chat.ts                ★ 后端 API 调用 (SSE解析)
│   ├── store/chatStore.tsx        ★ 全局状态管理
│   ├── types/chat.ts              TypeScript 类型
│   └── components/
│       ├── ChatPanel.tsx          ★ 问答面板 (Markdown渲染)
│       ├── Sidebar.tsx            对话列表侧栏
│       ├── SearchModal.tsx        对话搜索弹窗
│       ├── LoginPage.tsx          登录页
│       ├── KbManagePage.tsx       知识库管理
│       ├── UserManagePage.tsx     用户管理
│       ├── PromptManagePage.tsx   提示词管理
│       ├── ExpManagePage.tsx      经验管理
│       └── SkillManagePage.tsx    技能工厂
└── vite.config.ts
```

★ = 核心文件，修改前务必理解。

---

## 14. 文档维护约定

### 必须更新本文档的情况

以下任何一种情况，**必须**同步更新本文档：

1. **新增/删除 Agent 工具** → 更新 §7 工具系统
2. **修改 SSE 事件** → 更新 §6 SSE 事件系统
3. **调整 Agent 循环逻辑** → 更新 §4 完整问答之旅 + §5 Agent 引擎详解
4. **改变前后端通信方式** → 更新 §10 前后端连接
5. **新增/修改配置项** → 更新 §12 配置参考
6. **调整架构（新增/拆分/合并模块）** → 更新 §3 系统架构 + §13 文件索引
7. **修改权限模型** → 更新 §11 数据隔离模型
8. **新增页面或路由** → 更新 §3 系统架构

### 更新检查清单

修改代码后，提交前逐条确认：

- [ ] 架构图是否需要更新？
- [ ] 核心流程描述是否仍然准确？
- [ ] 事件/工具的表格是否需要增删？
- [ ] 文件索引是否需要调整？
- [ ] 配置项是否需要增删？
- [ ] CLAUDE.md 中的技术描述是否需要同步？
