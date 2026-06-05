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
    """Run schema migrations (call AFTER init_db creates tables)."""
    import sqlalchemy as sa
    with engine.connect() as conn:
        migrations = [
            "ALTER TABLE system_prompt ADD COLUMN title VARCHAR(128) NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN exp_extract_enabled TINYINT(1) NOT NULL DEFAULT 0",
            "CREATE TABLE IF NOT EXISTS skills ("
            " id INT AUTO_INCREMENT PRIMARY KEY,"
            " title VARCHAR(128) NOT NULL,"
            " description VARCHAR(512) NOT NULL DEFAULT '',"
            " content TEXT NOT NULL,"
            " created_by VARCHAR(64) NOT NULL DEFAULT 'admin',"
            " created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
            " updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        ]
        for sql in migrations:
            try:
                conn.execute(sa.text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists


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
    import app.models.skill  # noqa: ensure model is registered
    Base.metadata.create_all(bind=engine)
    _migrate()

    from app.agent.prompts import DEFAULT_SYSTEM_PROMPT
    from app.models.system_prompt import SystemPrompt
    db = SessionLocal()
    try:
        existing = db.query(SystemPrompt).filter(SystemPrompt.prompt_key == "default").first()
        if existing is None:
            db.add(SystemPrompt(
                prompt_key="default",
                title="默认提示词",
                prompt_content=DEFAULT_SYSTEM_PROMPT,
            ))
            db.commit()
            print("[Init] Seeded '默认提示词' (default)")
        elif not existing.title:
            existing.title = "默认提示词"
            db.commit()

        sys_default = db.query(SystemPrompt).filter(SystemPrompt.prompt_key == "system_default").first()
        if sys_default is None:
            db.add(SystemPrompt(
                prompt_key="system_default",
                title="系统默认",
                prompt_content="",
            ))
            db.commit()
            print("[Init] Seeded '系统默认' (system_default)")

        total = db.query(SystemPrompt).count()
        print(f"[Init] system_prompt table has {total} row(s)")
    except Exception as e:
        print(f"[Init] Seed failed: {e}")
    finally:
        db.close()
