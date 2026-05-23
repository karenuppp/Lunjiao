from __future__ import annotations
import json
import re
from typing import List, Optional
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError


READONLY_KEYWORDS = {"SELECT", "SHOW", "DESCRIBE", "EXPLAIN", "DESC"}
DISALLOWED_KEYWORDS = {
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
    "TRUNCATE", "RENAME", "REPLACE", "LOAD", "GRANT", "REVOKE",
    "EXEC", "EXECUTE", "CALL", "INTO", "OUTFILE", "DUMPFILE",
}

MAX_QUERY_LENGTH = 4096


def _validate_sql(sql_query: str) -> None:
    stripped = sql_query.strip().rstrip(";")

    if not stripped:
        raise ValueError("SQL query is empty")

    if len(stripped) > MAX_QUERY_LENGTH:
        raise ValueError(f"SQL query exceeds max length ({MAX_QUERY_LENGTH})")

    first_word = stripped.split(maxsplit=1)[0].upper()

    if ";" in stripped[: -1] if stripped.endswith(";") else ";" in stripped:
        raise ValueError("Multi-statement queries are not allowed")

    if first_word in DISALLOWED_KEYWORDS:
        raise ValueError(f"SQL operation '{first_word}' is not allowed (read-only only)")

    if re.match(r"^[A-Z_]+$", first_word) and first_word not in READONLY_KEYWORDS:
        raise ValueError(f"SQL operation '{first_word}' is not allowed (read-only only)")

    upper = stripped.upper()
    for kw in DISALLOWED_KEYWORDS:
        if re.search(rf"\b{kw}\b", upper):
            raise ValueError(f"SQL keyword '{kw}' is not allowed (read-only only)")


# ── Connection & Query ──────────────────────────────────

def _build_url(host: str, port: int, user: str, password: str, db_name: str) -> str:
    return f"mysql+pymysql://{user}:{password}@{host}:{port}/{db_name}?charset=utf8mb4"


def test_connection(
    host: str, port: int, user: str, password: str, table_name: str,
    db_name: str | None = None,
) -> dict:
    if db_name:
        db_url = _build_url(host, port, user, password, db_name)
        engine = create_engine(db_url, connect_args={"connect_timeout": 5})
        try:
            with engine.connect() as conn:
                rows = conn.execute(
                    text("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = :db"),
                    {"db": db_name},
                ).fetchall()
                tables = [row[0] for row in rows]
                if table_name not in tables:
                    return {"success": False, "message": f"数据库 '{db_name}' 中未找到表 '{table_name}'", "fields": []}
            with engine.connect() as conn:
                rows = conn.execute(text(f"SHOW COLUMNS FROM `{table_name}`")).fetchall()
                fields = [{"name": row[0], "type": row[1]} for row in rows]
            return {"success": True, "message": "连接成功！", "fields": fields}
        except SQLAlchemyError as e:
            return {"success": False, "message": f"连接失败：{str(e)}", "fields": []}
        finally:
            engine.dispose()

    try:
        base_url = f"mysql+pymysql://{user}:{password}@{host}:{port}?charset=utf8mb4"
        base_engine = create_engine(base_url, connect_args={"connect_timeout": 5})
        with base_engine.connect() as conn:
            rows = conn.execute(text("SHOW DATABASES")).fetchall()
            databases = [row[0] for row in rows]
    except SQLAlchemyError as e:
        return {"success": False, "message": f"连接失败：{str(e)}", "fields": []}
    finally:
        base_engine.dispose()

    db_name = None
    for db in databases:
        try:
            db_url = f"mysql+pymysql://{user}:{password}@{host}:{port}/{db}?charset=utf8mb4"
            db_engine = create_engine(db_url, connect_args={"connect_timeout": 5})
            with db_engine.connect() as conn:
                rows = conn.execute(
                    text("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = :db"),
                    {"db": db},
                ).fetchall()
                tables = [row[0] for row in rows]
                if table_name in tables:
                    db_name = db
                    break
        except SQLAlchemyError:
            continue
        finally:
            db_engine.dispose()

    if not db_name:
        return {"success": False, "message": f"未找到表 '{table_name}'", "fields": []}

    try:
        db_url = _build_url(host, port, user, password, db_name)
        engine = create_engine(db_url, connect_args={"connect_timeout": 5})
        with engine.connect() as conn:
            rows = conn.execute(text(f"SHOW COLUMNS FROM `{table_name}`")).fetchall()
            fields = [{"name": row[0], "type": row[1]} for row in rows]
        return {"success": True, "message": "连接成功！", "fields": fields}
    except SQLAlchemyError as e:
        return {"success": False, "message": f"获取字段失败：{str(e)}", "fields": []}
    finally:
        engine.dispose()


def execute_query(
    host: str, port: int, user: str, password: str,
    table_name: str, sql_query: str,
) -> dict:
    _validate_sql(sql_query)

    base_url = f"mysql+pymysql://{user}:{password}@{host}:{port}?charset=utf8mb4"
    base_engine = create_engine(base_url, connect_args={"connect_timeout": 5})

    db_name = None
    try:
        with base_engine.connect() as conn:
            rows = conn.execute(text("SHOW DATABASES")).fetchall()
            databases = [row[0] for row in rows]
    finally:
        base_engine.dispose()

    for db in databases:
        db_url = _build_url(host, port, user, password, db)
        engine = create_engine(db_url, connect_args={"connect_timeout": 5})
        try:
            with engine.connect() as conn:
                result = conn.execute(
                    text("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = :db"),
                    {"db": db},
                ).fetchall()
                if table_name in [row[0] for row in result]:
                    db_name = db
                    break
        except SQLAlchemyError:
            continue
        finally:
            engine.dispose()

    if not db_name:
        return {"success": False, "data": [], "columns": [], "message": f"未找到表 '{table_name}'"}

    db_url = _build_url(host, port, user, password, db_name)
    engine = create_engine(db_url, connect_args={"connect_timeout": 5})
    try:
        with engine.connect() as conn:
            result = conn.execute(text(sql_query))
            columns = list(result.keys())
            data = [dict(zip(columns, row)) for row in result.fetchall()]
        return {"success": True, "data": data, "columns": columns, "message": ""}
    except SQLAlchemyError as e:
        return {"success": False, "data": [], "columns": [], "message": str(e)}
    finally:
        engine.dispose()


def list_tables(
    host: str, port: int, user: str, password: str,
) -> dict:
    base_url = f"mysql+pymysql://{user}:{password}@{host}:{port}?charset=utf8mb4"
    engine = create_engine(base_url, connect_args={"connect_timeout": 5})
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME")
            ).fetchall()
        tables = [{"database": row[0], "table": row[1]} for row in rows]
        return {"success": True, "tables": tables}
    except SQLAlchemyError as e:
        return {"success": False, "tables": [], "message": str(e)}
    finally:
        engine.dispose()
