"""
Auth API — 用户登录校验

POST /api/auth/login
  body: { "account": "193699", "password": "193699" }
  returns: { "ok": true, "user_id": "193699" } or { "ok": false, "error": "..." }
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User

router = APIRouter()


class LoginRequest(BaseModel):
    account: str
    password: str


class LoginResponse(BaseModel):
    ok: bool
    user_id: str | None = None
    error: str | None = None


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    """
    校验用户登录。
    - 账号不存在 → error="账号不存在"
    - 密码错误   → error="输入密码错误"
    - 校验通过   → ok=true, user_id=<account>
    """
    user = db.query(User).filter(User.account == req.account).first()

    if user is None:
        return LoginResponse(ok=False, error="账号不存在")

    if user.password != req.password:
        return LoginResponse(ok=False, error="输入密码错误")

    return LoginResponse(ok=True, user_id=user.account)
