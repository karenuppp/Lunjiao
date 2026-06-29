from __future__ import annotations

from app.database import Base
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON
from sqlalchemy.sql import func


class Skill(Base):

    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(128), nullable=False, comment="Skill name (kebab-case)")
    description = Column(String(512), nullable=False, default="", comment="Brief description with Use-when triggers")
    content = Column(Text, nullable=False, comment="Unified markdown (for frontend editing)")
    body = Column(Text, nullable=False, default="", comment="Main SKILL.md body (≤100 lines, for agent context)")
    references = Column(Text, nullable=True, comment="Detailed reference docs (loaded on demand)")
    scripts = Column(JSON, nullable=True, comment="Executable scripts: [{name, code, entry, timeout}]")
    created_by = Column(String(64), nullable=False, default="admin", comment="User who created this skill")
    created_at = Column(DateTime, server_default=func.now(), comment="Creation timestamp")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="Last update timestamp")

    def __repr__(self):
        return (
            f"<Skill(id={self.id}, title='{self.title}', "
            f"created_by='{self.created_by}')>"
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "content": self.content,
            "body": self.body,
            "references": self.references,
            "scripts": self.scripts or [],
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
