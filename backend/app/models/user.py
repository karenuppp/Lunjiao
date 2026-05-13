"""
User ORM model — 用户表

Fields:
  id       — 自增主键（序号）
  account  — 账号 (UK)
  password — 密码（明文存储，后续改为 bcrypt）
"""

from sqlalchemy import Column, Integer, String, BigInteger
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, autoincrement=True, comment="序号")
    account = Column(String(64), unique=True, nullable=False, index=True, comment="账号")
    password = Column(String(128), nullable=False, comment="密码")
    role = Column(String(16), nullable=False, default="user", comment="角色: admin | user")

    def __repr__(self):
        return f"<User id={self.id} account={self.account}>"
