"""
Database engine & session — shared across all API modules.
Uses config from .env (same as db_server.py).
"""
from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from app.config import settings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session, declarative_base

DATABASE_URL = (
    f"mysql+pymysql://{settings.db_user}:{settings.db_password}@{settings.db_host}:{settings.db_port}/{settings.db_name}"
    f"?charset=utf8mb4"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def _migrate():
    """Run schema migrations before any ORM queries touch the database."""
    with engine.connect() as conn:
        try:
            conn.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE system_prompt ADD COLUMN title VARCHAR(128) NOT NULL DEFAULT ''"
                )
            )
            conn.commit()
        except Exception:
            pass  # column already exists


_migrate()  # run at module-load time, before models are imported elsewhere


def get_db() -> Session:
    """FastAPI dependency — yields a DB session, auto-closed on response."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables that don't exist yet. Safe to call on every startup."""
    import app.models.user  # noqa: ensure model is registered
    import app.models.db_connection  # noqa: ensure model is registered
    import app.models.system_prompt  # noqa: ensure model is registered
    Base.metadata.create_all(bind=engine)
