"""
System prompt model — stores the active AI system prompt in the database.

Admin users can update the prompt via the admin panel;
the agent reads it at startup / on each request.
"""

from __future__ import annotations

from app.database import Base
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func


class SystemPrompt(Base):
    """Key-value style config store for system prompt."""

    __tablename__ = "system_prompt"

    id = Column(Integer, primary_key=True, autoincrement=True)
    prompt_key = Column(
        String(64), unique=True, nullable=False, default="default",
        comment="Config key — currently only 'default' is used"
    )
    prompt_content = Column(
        Text, nullable=False,
        comment="The actual system prompt text sent to the LLM"
    )
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(),
        comment="Last update timestamp"
    )

    def __repr__(self):
        return (
            f"<SystemPrompt(key='{self.prompt_key}', "
            f"updated={self.updated_at})>"
        )
