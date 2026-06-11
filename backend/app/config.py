import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()


class Settings:
    # ── LLM 配置 ──
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "lm-studio")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "http://localhost:1234/v1")
    model_name: str = os.getenv("MODEL_NAME", "qwen3.6-35B-A3B-apex")

    # ── Embedding 配置（可独立于 LLM）──
    embedding_api_key: str = os.getenv("EMBEDDING_API_KEY", os.getenv("OPENAI_API_KEY", "lm-studio"))
    embedding_base_url: str = os.getenv("EMBEDDING_BASE_URL", os.getenv("OPENAI_BASE_URL", "http://localhost:1234/v1"))

    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: str = os.getenv("DB_PORT", "3306")
    db_user: str = os.getenv("DB_USER", "root")
    db_password: str = os.getenv("DB_PASSWORD", "123456")
    db_name: str = os.getenv("DB_NAME", "zhiwei")

    @property
    def database_url(self) -> str:
        return f"mysql+pymysql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}?charset=utf8mb4"

    rag_api_base: str = os.getenv("RAG_API_BASE", "http://localhost:8023")
    rag_api_key: str = os.getenv("RAG_API_KEY", "ragflow-fe1010104b7e11efa01e0242ac1c0006")

    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-nomic-embed-text-v1.5")
    embedding_dim: int = int(os.getenv("EMBEDDING_DIM", "768"))
    embedding_workers: int = int(os.getenv("EMBEDDING_WORKERS", "2"))

    rag_chunk_top_k: int = int(os.getenv("RAG_CHUNK_TOP_K", "5"))
    rag_cosine_threshold: float = float(os.getenv("RAG_COSINE_THRESHOLD", "0.3"))
    rag_max_context_tokens: int = int(os.getenv("RAG_MAX_CONTEXT_TOKENS", "1200"))
    rag_query_timeout: float = float(os.getenv("RAG_QUERY_TIMEOUT", "30"))

    mcp_server_base: str = os.getenv("MCP_SERVER_BASE", "http://localhost:8024")

    experience_top_k: int = int(os.getenv("EXPERIENCE_TOP_K", "3"))
    experience_cosine_threshold: float = float(os.getenv("EXPERIENCE_COSINE_THRESHOLD", "0.5"))
    experience_dedup_threshold: float = float(os.getenv("EXPERIENCE_DEDUP_THRESHOLD", "0.85"))

    port: int = int(os.getenv("PORT", "8000"))

    log_dir: str = os.getenv("LOG_DIR", str(Path(__file__).parent.parent / "logs"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")

    upload_dir: str = os.getenv("UPLOAD_DIR", str(Path(__file__).parent.parent / "uploads"))
    talk_dir: str = os.getenv("TALK_DIR", str(Path(__file__).parent.parent.parent / "talk"))
    max_upload_size_mb: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50"))
    rag_indexing_timeout: int = int(os.getenv("RAG_INDEXING_TIMEOUT", "300"))
    allowed_extensions: list[str] = os.getenv(
        "ALLOWED_EXTENSIONS",
        ".pdf,.docx,.doc,.xlsx,.xls,.pptx,.csv,.txt,.md,.png,.jpg,.jpeg,.zip,.rar,.7z,.tar.gz,.tgz",
    ).split(",")

    @property
    def is_configured(self) -> bool:
        return bool(self.openai_base_url)


settings = Settings()
