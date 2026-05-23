from __future__ import annotations
import json
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.db_connection import DbConnection
from app.schemas.db_connection import (
    DbConnectionCreate,
    DbConnectionTest,
    DbConnectionOut,
    TestResult,
    FieldInfo,
)
from app.services import db_service

router = APIRouter()


def _to_out(conn: DbConnection) -> DbConnectionOut:
    """Convert ORM model to response schema."""
    fields = None
    if conn.table_fields:
        try:
            fields = [FieldInfo(**f) for f in json.loads(conn.table_fields)]
        except (json.JSONDecodeError, TypeError):
            pass
    return DbConnectionOut(
        id=conn.id,
        name=conn.name,
        host=conn.host,
        port=conn.port,
        db_name=conn.db_name,
        table_name=conn.table_name,
        db_user=conn.db_user,
        environment=conn.environment,
        status=conn.status,
        table_fields=fields,
        created_at=conn.created_at,
    )


@router.get("/", response_model=List[DbConnectionOut])
def list_connections(db: Session = Depends(get_db)):
    conns = db.query(DbConnection).order_by(DbConnection.created_at.desc()).all()
    return [_to_out(c) for c in conns]


@router.post("/", response_model=DbConnectionOut)
def create_connection(payload: DbConnectionCreate, db: Session = Depends(get_db)):
    conn = DbConnection(
        name=payload.name,
        host=payload.host,
        port=payload.port,
        db_name=payload.db_name or None,
        table_name=payload.table_name,
        db_user=payload.db_user,
        db_password=payload.db_password,
        environment=payload.environment,
        status="disconnected",
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return _to_out(conn)


@router.post("/test", response_model=TestResult)
def test_connection(payload: DbConnectionTest):
    result = db_service.test_connection(
        host=payload.host,
        port=payload.port,
        user=payload.db_user,
        password=payload.db_password,
        table_name=payload.table_name,
        db_name=payload.db_name or None,
    )
    return TestResult(**result)


@router.post("/{conn_id}/test", response_model=TestResult)
def test_saved_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(DbConnection).filter(DbConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="连接不存在")

    result = db_service.test_connection(
        host=conn.host,
        port=conn.port,
        user=conn.db_user,
        password=conn.db_password,
        table_name=conn.table_name,
        db_name=conn.db_name,
    )

    if result["success"]:
        conn.status = "connected"
        conn.table_fields = json.dumps(result["fields"], ensure_ascii=False)
    else:
        conn.status = "disconnected"
    db.commit()

    return TestResult(**result)


@router.post("/{conn_id}/disconnect")
def disconnect_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(DbConnection).filter(DbConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="连接不存在")
    conn.status = "disconnected"
    db.commit()
    return {"message": "已断开"}


@router.post("/{conn_id}/connect")
def connect_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(DbConnection).filter(DbConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="连接不存在")

    result = db_service.test_connection(
        host=conn.host,
        port=conn.port,
        user=conn.db_user,
        password=conn.db_password,
        table_name=conn.table_name,
        db_name=conn.db_name,
    )

    if result["success"]:
        conn.status = "connected"
        conn.table_fields = json.dumps(result["fields"], ensure_ascii=False)
        db.commit()
        return {"message": "连接成功", "status": "connected"}
    else:
        return {"message": result["message"], "status": "disconnected"}


@router.delete("/{conn_id}")
def delete_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(DbConnection).filter(DbConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="连接不存在")
    db.delete(conn)
    db.commit()
    return {"message": "已删除"}
