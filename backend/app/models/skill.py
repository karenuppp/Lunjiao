from __future__ import annotations

from app.database import Base
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func


class Skill(Base):

    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(128), nullable=False, comment="Skill title")
    description = Column(String(512), nullable=False, default="", comment="Auto-generated skill description")
    content = Column(Text, nullable=False, comment="Skill markdown content / specification")
    created_by = Column(String(64), nullable=False, default="admin", comment="User who created this skill")
    created_at = Column(DateTime, server_default=func.now(), comment="Creation timestamp")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="Last update timestamp")

    def __repr__(self):
        return (
            f"<Skill(id={self.id}, title='{self.title}', "
            f"created_by='{self.created_by}')>"
        )
