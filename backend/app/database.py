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
    import sqlalchemy as sa
    with engine.connect() as conn:
        migrations = [
            "ALTER TABLE system_prompt ADD COLUMN title VARCHAR(128) NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN exp_extract_enabled TINYINT(1) NOT NULL DEFAULT 0",
        ]
        for sql in migrations:
            try:
                conn.execute(sa.text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists


_migrate()  # run at module-load time, before models are imported elsewhere


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import app.models.user  # noqa: ensure model is registered
    import app.models.db_connection  # noqa: ensure model is registered
    import app.models.system_prompt  # noqa: ensure model is registered
    import app.models.experience  # noqa: ensure model is registered
    Base.metadata.create_all(bind=engine)
