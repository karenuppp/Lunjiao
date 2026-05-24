import os
import sys
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Load .env
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "zhiwei")

DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"


def get_engine():
    return create_engine(DATABASE_URL, echo=True)


def main():
    parser = argparse.ArgumentParser(description="初始化 Zhiwei 用户表")
    parser.add_argument("--account", default="193699", help="测试账号 (默认: 193699)")
    parser.add_argument("--password", default="193699", help="测试密码 (默认: 193699)")
    parser.add_argument("--role", default="admin", help="角色 (默认: admin)")
    args = parser.parse_args()

    from app.database import Base
    from app.models.user import User
    from app.models.db_connection import DbConnection

    engine = get_engine()

    # 1. 建表
    print(f"\n📦 创建用户表与数据库连接表 (如果不存在)...")
    Base.metadata.create_all(engine, tables=[User.__table__, DbConnection.__table__])

    # 2. 插入测试账号
    with Session(engine) as session:
        existing = session.query(User).filter_by(account=args.account).first()
        if existing:
            print(f"⚠️  账号 '{args.account}' 已存在 (id={existing.id})，跳过插入")
        else:
            user = User(account=args.account, password=args.password, role=args.role)
            session.add(user)
            session.commit()
            print(f"✅ 已插入账号: {args.account}, 角色: {args.role} (id={user.id})")

    # 3. 验证
    with Session(engine) as session:
        count = session.query(User).count()
        print(f"📊 用户表当前共 {count} 条记录")

    print("\n🎉 用户表初始化完成！")


if __name__ == "__main__":
    main()
