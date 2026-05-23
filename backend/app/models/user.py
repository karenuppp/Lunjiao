from sqlalchemy import Column, Integer, String, BigInteger, Text, Boolean
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, autoincrement=True, comment="序号")
    account = Column(String(64), unique=True, nullable=False, index=True, comment="账号")
    password = Column(String(128), nullable=False, comment="密码")
    role = Column(String(16), nullable=False, default="user", comment="角色: admin | user")
    # 查询权限
    kb_scope = Column(String(16), nullable=False, default="personal", comment="知识库查询范围: public | personal | none")
    db_scope = Column(Text, nullable=True, comment="数据库查询范围 (JSON array of connection IDs)")
    # 经验提取权限
    exp_extract_enabled = Column(Boolean, nullable=False, default=False, comment="是否允许该用户的点赞回答触发经验提取")

    def __repr__(self):
        return f"<User id={self.id} account={self.account}>"
