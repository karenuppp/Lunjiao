"""
Database connection model — stores user-managed database connections.
Each connection points to a MySQL database that the AI agent can query.
"""
from sqlalchemy import Column, BigInteger, String, Integer, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class DbConnection(Base):
    __tablename__ = "db_connections"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(128), nullable=False, comment="连接名称")
    host = Column(String(255), nullable=False, comment="数据库地址")
    port = Column(Integer, default=3306, nullable=False, comment="端口")
    db_name = Column(String(128), nullable=True, comment="数据库名")
    table_name = Column(String(128), nullable=False, comment="表名")
    db_user = Column(String(128), nullable=False, comment="数据库用户名")
    db_password = Column(String(255), nullable=False, comment="数据库密码 (明文)")
    environment = Column(String(16), default="test", comment="环境: test / production")
    status = Column(String(16), default="disconnected", comment="连接状态: connected / disconnected")
    table_fields = Column(Text, nullable=True, comment="缓存表字段 (JSON)")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
