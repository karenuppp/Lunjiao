from __future__ import annotations

from app.database import Base
from sqlalchemy import Column, Integer, String, Text, Float, JSON, DateTime, Enum as SAEnum
from sqlalchemy.sql import func
import enum


class ExperienceStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    archived = "archived"
    deprecated = "deprecated"


class Experience(Base):

    __tablename__ = "experience"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="自增主键")
    user_id = Column(
        String(64), nullable=False, index=True,
        comment="经验来源用户 account"
    )
    title = Column(
        String(256), nullable=False,
        comment="经验标题摘要"
    )
    content = Column(
        Text, nullable=False,
        comment="完整的经验内容"
    )
    source_conv_id = Column(
        String(64), nullable=True,
        comment="来源对话 ID"
    )
    source_msg_id = Column(
        String(64), nullable=True,
        comment="来源消息 ID（被点赞的 AI 回答）"
    )
    tags = Column(
        JSON, nullable=True,
        comment="分类标签，值为 system_prompt 表中已有的 title 数组"
    )
    confidence = Column(
        Float, nullable=False, default=1.0,
        comment="置信度 (0-1)，<0.3 自动废弃"
    )
    status = Column(
        SAEnum(ExperienceStatus), nullable=False,
        default=ExperienceStatus.active,
        comment="active / archived / deprecated"
    )
    access_count = Column(
        Integer, nullable=False, default=0,
        comment="被检索匹配的次数"
    )
    last_accessed = Column(
        DateTime, nullable=True,
        comment="最后被检索时间"
    )
    created_at = Column(
        DateTime, server_default=func.now(),
        comment="经验提取入库时间"
    )
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(),
        comment="最后修改时间"
    )

    def __repr__(self):
        return (
            f"<Experience(id={self.id}, user='{self.user_id}', "
            f"title='{self.title}', status='{self.status}')>"
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "title": self.title,
            "content": self.content,
            "source_conv_id": self.source_conv_id,
            "source_msg_id": self.source_msg_id,
            "tags": self.tags or [],
            "confidence": self.confidence,
            "status": self.status.value if self.status else "active",
            "access_count": self.access_count,
            "last_accessed": self.last_accessed.isoformat() if self.last_accessed else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
