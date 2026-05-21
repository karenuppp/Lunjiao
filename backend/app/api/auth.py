"""
Auth API — 用户登录校验 + 用户管理 (仅管理员)

POST /api/auth/login
  body: { "account": "193699", "password": "***" }
  returns: { "ok": true, "user_id": "193699", "role": "admin" }

GET    /api/auth/users                          — 列出所有用户 (管理员)
POST   /api/auth/users                          — 创建用户  (管理员)
DELETE /api/auth/users/{user_id}                — 删除用户  (管理员)
POST   /api/auth/users/{user_id}/change-password — 修改用户密码 (管理员)
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User

router = APIRouter()


# ============================================================
# Pydantic 模型
# ============================================================

class LoginRequest(BaseModel):
    account: str
    password: str


class LoginResponse(BaseModel):
    ok: bool
    user_id: str | None = None
    role: str | None = None
    error: str | None = None


class CreateUserRequest(BaseModel):
    account: str
    password: str
    role: str = "user"  # "admin" | "user"


class UserItem(BaseModel):
    id: int
    account: str
    role: str
    kb_scope: str = "personal"
    db_scope: list[int] | None = None

    model_config = {"from_attributes": True}


class ChangePasswordRequest(BaseModel):
    new_password: str


class SetQueryPermissionRequest(BaseModel):
    kb_scope: str  # "public" | "personal" | "none"
    db_scope: list[int] | None = None  # list of connection IDs


class QueryPermissionResponse(BaseModel):
    kb_scope: str
    db_scope: list[int] | None = None


# ============================================================
# 登录
# ============================================================

@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    """
    校验用户登录。
    - 账号不存在 → error="账号不存在"
    - 密码错误   → error="输入密码错误"
    - 校验通过   → ok=true, user_id=<account>, role=<role>
    """
    user = db.query(User).filter(User.account == req.account).first()

    if user is None:
        return LoginResponse(ok=False, error="账号不存在")

    if user.password != req.password:
        return LoginResponse(ok=False, error="输入密码错误")

    return LoginResponse(ok=True, user_id=user.account, role=user.role)


# ============================================================
# 用户管理 (管理员)
# ============================================================

def _require_admin(db: Session, user_id: str):
    """校验调用者是否为管理员。
    参数 user_id 来自请求参数，查找该用户并检查 role == 'admin'。
    前端虽然隐藏了管理员入口，后端作为第二道防线也要校验。"""
    if not user_id:
        raise HTTPException(status_code=403, detail="未提供用户标识")

    user = db.query(User).filter(User.account == user_id).first()
    if not user:
        raise HTTPException(status_code=403, detail="用户不存在")

    if user.role != "admin":
        raise HTTPException(status_code=403, detail="无管理员权限")

    return user


def _parse_db_scope(raw: str | None) -> list[int] | None:
    """Parse db_scope JSON string to list of ints."""
    if not raw:
        return None
    try:
        import json
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [int(x) for x in parsed]
        return None
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


@router.get("/users", response_model=list[UserItem])
def list_users(user_id: str, db: Session = Depends(get_db)):
    """列出所有用户 (管理员)"""
    _require_admin(db, user_id)
    users = db.query(User).order_by(User.id).all()
    return [
        UserItem(
            id=u.id,
            account=u.account,
            role=u.role,
            kb_scope=u.kb_scope or "personal",
            db_scope=_parse_db_scope(u.db_scope),
        )
        for u in users
    ]


@router.post("/users", response_model=UserItem)
def create_user(req: CreateUserRequest, user_id: str, db: Session = Depends(get_db)):
    """创建新用户 (管理员)"""
    _require_admin(db, user_id)

    # 检查账号是否已存在
    existing = db.query(User).filter(User.account == req.account).first()
    if existing:
        raise HTTPException(status_code=400, detail="账号已存在")

    if req.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="角色只能是 admin 或 user")

    user = User(account=req.account, password=req.password, role=req.role)
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserItem(id=user.id, account=user.account, role=user.role)


@router.delete("/users/{user_id}")
def delete_user(user_id: int, caller_id: str, db: Session = Depends(get_db)):
    """删除用户 (管理员)"""
    _require_admin(db, caller_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    db.delete(user)
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/change-password")
def change_password(user_id: int, caller_id: str, req: ChangePasswordRequest, db: Session = Depends(get_db)):
    """修改用户密码 (管理员)"""
    _require_admin(db, caller_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.password = req.new_password
    db.commit()
    return {"ok": True}


# ============================================================
# 查询权限管理
# ============================================================

@router.get("/users/{user_id}/query-permission", response_model=QueryPermissionResponse)
def get_query_permission(user_id: int, caller_id: str, db: Session = Depends(get_db)):
    """获取用户的查询权限 (管理员)"""
    _require_admin(db, caller_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    return QueryPermissionResponse(
        kb_scope=user.kb_scope or "personal",
        db_scope=_parse_db_scope(user.db_scope),
    )


@router.put("/users/{user_id}/query-permission")
def set_query_permission(user_id: int, caller_id: str, req: SetQueryPermissionRequest, db: Session = Depends(get_db)):
    """设置用户的查询权限 (管理员)"""
    _require_admin(db, caller_id)

    if req.kb_scope not in ("public", "personal", "none"):
        raise HTTPException(status_code=400, detail="kb_scope 只能是 public、personal 或 none")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    import json
    user.kb_scope = req.kb_scope
    user.db_scope = json.dumps(req.db_scope) if req.db_scope else None
    db.commit()

    return {"ok": True}
