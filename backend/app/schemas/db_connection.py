from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class DbConnectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128, description="连接名称")
    host: str = Field(..., min_length=1, max_length=255, description="数据库地址")
    port: int = Field(default=3306, ge=1, le=65535, description="端口")
    db_name: str = Field(default="", max_length=128, description="数据库名")
    table_name: str = Field(..., min_length=1, max_length=128, description="表名")
    db_user: str = Field(..., min_length=1, max_length=128, description="数据库用户名")
    db_password: str = Field(..., min_length=1, max_length=255, description="数据库密码")
    environment: str = Field(default="test", pattern="^(test|production)$", description="环境")


class DbConnectionTest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=3306, ge=1, le=65535)
    db_name: str = Field(default="", max_length=128)
    table_name: str = Field(..., min_length=1, max_length=128)
    db_user: str = Field(..., min_length=1, max_length=128)
    db_password: str = Field(..., min_length=1, max_length=255)
    environment: str = Field(default="test", pattern="^(test|production)$")


class FieldInfo(BaseModel):
    name: str
    type: str


class TestResult(BaseModel):
    success: bool
    message: str
    fields: List[FieldInfo] = []


class DbConnectionOut(BaseModel):
    id: int
    name: str
    host: str
    port: int
    db_name: Optional[str] = None
    table_name: str
    db_user: str
    environment: str
    status: str
    table_fields: Optional[List[FieldInfo]] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
