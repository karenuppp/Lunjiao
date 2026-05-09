"""
Database engine & session — shared across all API modules.
Uses config from .env (same as db_server.py).
"""

from dotenv import load_dotenv

load_dotenv()

from app.config import settings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

DATABASE_URL = (
    f"mysql+pymysql://{settings.db_user}:{settings.db_password}"
    f"@{settings.db_host}:{settings.db_port}/{settings.db_name}"
    f"?charset=utf8mb4"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Session:
    """FastAPI dependency — yields a DB session, auto-closed on response."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
