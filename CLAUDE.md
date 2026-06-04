# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## Project overview

Zhiwei (知微) — department-level intelligent Q&A system. Users ask questions in natural Chinese, system answers by searching uploaded documents (RAG) and querying configured MySQL databases (text-to-SQL). Core backend: custom ReAct agent using native OpenAI SDK (no LangChain/LangGraph).

## Commands

```bash
# Backend (Python 3.12+)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# MCP servers (optional auxiliary services)
python -m app.mcp_servers.db_server      # :8024
python -m app.mcp_servers.upload_server  # :8025

# Frontend (Node 22+)
cd frontend
npm install
npm run dev              # dev server :5173, proxies /api to :8000
npm run build            # production build → frontend/dist/
npm run lint             # eslint

# First-time setup: create default admin user (193699 / 193699)
cd backend && source venv/bin/activate && python init_users.py

# Docker
docker build -t zhiwei:latest .
docker run -d --name zhiwei --network host zhiwei:latest
```

## Architecture

```
Browser (React SPA) ──SSE streaming──> FastAPI (:8000)
                                        ├─ ReAct Agent (OpenAI function calling)
                                        ├─ RAG Engine (RAGAnything + LightRAG, in-process)
                                        └─ Tools: query_rag, list_db_connections, list_db_tables, query_db
                                              │
                                              ├── LLM (OpenAI-compatible API, default :1234)
                                              ├── MySQL (app DB + user-managed external DBs)
                                              └── MCP servers (auxiliary, :8024/:8025)
```

### ReAct agent (`backend/app/agent/graph.py`)

Manual ReAct loop with OpenAI tool-calling (max 5 rounds). Two modes:
- **Streaming** (`run_agent_stream_simple`): yields SSE events (`token`, `tool_call_start`, `tool_call_end`, `data_source`, `final_answer`, `error`) consumed by React frontend
- **Sync** (`run_agent_sync`): returns `{answer, data_sources_used}` dict

System prompt loaded from `system_prompt` DB table (default key), falls back to `agent/prompts.py`.

### Tools (`backend/app/agent/tools.py`)

| Tool | Purpose |
|---|---|
| `query_rag` | Semantic search over uploaded documents (user-isolated, optional public kb) |
| `list_db_connections` | List all connected databases (scoped by user's db_scope) |
| `list_db_tables` | Show tables/fields for specific connection |
| `query_db` | Execute read-only SQL (SELECT/SHOW/DESCRIBE/EXPLAIN) |

All tools enforce `kb_scope` / `db_scope` permissions set per-user by admin.

### Data isolation model

Each user has `kb_scope` (personal/public/none) and `db_scope` (list of allowed connection IDs). Passed through agent → tools, enforced at every access point. Personal knowledge base always accessible; `kb_scope: "public"` additionally includes `default` user's documents.

### Frontend state (`frontend/src/store/chatStore.tsx`)

React Context + `useReducer`. Conversations and uploaded file metadata persisted to `localStorage` (`zhiwei_conversations`). `sendChat` function manages full streaming lifecycle: adds user/assistant messages, processes SSE events, tracks active tool calls.

### Database (`backend/app/database.py`)

SQLAlchemy 2.0 with MySQL (`zhiwei` database). Three ORM models in `app/models/`:
- `User` — account, password, role, kb_scope, db_scope
- `DbConnection` — host/port/credentials, table metadata, connection status
- `SystemPrompt` — key-value prompt storage

### API routes (`backend/app/api/`)

- `chat.py` — POST `/api/chat/stream` (SSE), POST `/api/chat/` (sync)
- `auth.py` — login, user CRUD, permission management
- `upload.py` — file upload (single/batch), list, delete; supports archive extraction (.zip/.rar/.7z/.tar.gz)
- `db_connections.py` — CRUD + test/connect for external MySQL connections
- `prompt.py` — GET/PUT system prompt
- `history.py` — in-memory conversation history

### Key configuration (`backend/app/config.py`)

All settings from environment variables via `python-dotenv`. Defaults assume local LM Studio (:1234), local MySQL (:3306), local RAG/MCP services. See `.env.example` for full list.

## Key conventions

- Frontend proxies `/api` to `:8000` in dev (Vite config). In production, FastAPI serves `frontend/dist/` as static files.
- `chatStore.tsx` `useChat()` hook — single entry point for all chat state and actions. Every component touching chat data should use it.
- Admin pages (`/admin/users`, `/admin/database`, `/admin/prompt`) only accessible to users with `role: "admin"`.
- File uploads go to `backend/uploads/` by default (configurable via `UPLOAD_DIR`).
- RAG engine (`backend/app/rag_engine.py`) wraps RAGAnything + LightRAG. Provides `search()`, `search_text()`, `insert()`, `delete()` methods, all taking `user_id` for isolation.

## Documentation maintenance

When modifying functionality or adjusting architecture, **must** update `docs/TECHNICAL.md`. This is the core technical reference for non-technical maintainers. Check §14 checklist before committing.