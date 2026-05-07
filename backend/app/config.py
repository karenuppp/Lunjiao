import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()


class Settings:
    # ── LLM / Model — 本地 1234 端口的 qwen3.6-35B-A3B-apex ──
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "lm-studio")     # lm-studio 不校验 key
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "http://localhost:1234/v1")
    model_name: str = os.getenv("MODEL_NAME", "qwen3.6-35B-A3B-apex")

    # ── MySQL 连接 ──
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: str = os.getenv("DB_PORT", "3306")
    db_user: str = os.getenv("DB_USER", "root")
    db_password: str = os.getenv("DB_PASSWORD", "123456")
    db_name: str = os.getenv("DB_NAME", "lunjiao")

    @property
    def database_url(self) -> str:
        return f"mysql+pymysql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}?charset=utf8mb4"

    # ── RAG-Anything API ──
    rag_api_base: str = os.getenv("RAG_API_BASE", "http://localhost:8023")
    rag_api_key: str = os.getenv("RAG_API_KEY", "ragflow-fe1010104b7e11efa01e0242ac1c0006")   # RAG-Anything 默认 key

    # ── MCP Server (database) ──
    mcp_server_base: str = os.getenv("MCP_SERVER_BASE", "http://localhost:8024")

    # ── File upload ──
    upload_dir: str = os.getenv("UPLOAD_DIR", str(Path(__file__).parent.parent / "uploads"))
    max_upload_size_mb: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50"))
    allowed_extensions: list[str] = os.getenv(
        "ALLOWED_EXTENSIONS",
        ".pdf,.docx,.doc,.xlsx,.xls,.pptx,.csv,.txt,.md,.png,.jpg,.jpeg",
    ).split(",")

    @property
    def is_configured(self) -> bool:
        return bool(self.openai_base_url)


settings = Settings()
