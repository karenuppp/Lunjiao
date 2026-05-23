from __future__ import annotations

from app.database import Base
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func


class SystemPrompt(Base):

    __tablename__ = "system_prompt"

    id = Column(Integer, primary_key=True, autoincrement=True)
    prompt_key = Column(
        String(64), unique=True, nullable=False, default="default",
        comment="Unique key — 'default' is the active system prompt"
    )
    title = Column(
        String(128), nullable=False, default="",
        comment="Display title for the prompt template"
    )
    prompt_content = Column(
        Text, nullable=False,
        comment="The actual prompt text sent to the LLM"
    )
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(),
        comment="Last update timestamp"
    )

    def __repr__(self):
        return (
            f"<SystemPrompt(key='{self.prompt_key}', "
            f"title='{self.title}', updated={self.updated_at})>"
        )
