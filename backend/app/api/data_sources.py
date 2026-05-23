from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter()


class DataSource(BaseModel):
    id: str
    name: str
    type: str  # "database" | "upload"
    status: str  # "connected" | "disconnected"
    description: Optional[str] = None
    created_at: Optional[str] = None


_source_registry = [
    DataSource(
        id="db-hr",
        name="人事数据库",
        type="database",
        status="connected",
        description="员工信息、组织结构、考勤数据",
    ),
    DataSource(
        id="db-equipment",
        name="设备数据库",
        type="database",
        status="connected",
        description="设备台账、维修记录、运行状态",
    ),
    DataSource(
        id="db-finance",
        name="财务数据库",
        type="database",
        status="disconnected",
        description="预算、报销、合同台账",
    ),
]


@router.get("/")
async def list_data_sources():
    return _source_registry


@router.post("/upload")
async def upload_file():
    raise HTTPException(status_code=501, detail="文件上传功能开发中")


@router.delete("/{source_id}")
async def remove_data_source(source_id: str):
    return {"status": "ok", "removed": source_id}
