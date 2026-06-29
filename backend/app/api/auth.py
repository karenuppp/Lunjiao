from fastapi import APIRouter, Depends, HTTPException
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
    kb_scope: str = "none"
    db_scope: list[int] | None = None
    exp_extract_enabled: bool = False

    model_config = {"from_attributes": True}


class ChangePasswordRequest(BaseModel):
    new_password: str


class SetQueryPermissionRequest(BaseModel):
    kb_scope: str  # "public" | "none"
    db_scope: list[int] | None = None  # list of connection IDs
    exp_extract_enabled: bool | None = None  # allow this user's 👍 to trigger extraction


class QueryPermissionResponse(BaseModel):
    kb_scope: str
    db_scope: list[int] | None = None
    exp_extract_enabled: bool = False


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.account == req.account).first()

    if user is None:
        return LoginResponse(ok=False, error="账号不存在")

    if user.password != req.password:
        return LoginResponse(ok=False, error="输入密码错误")

    return LoginResponse(ok=True, user_id=user.account, role=user.role)


def _require_admin(db: Session, user_id: str):
    if not user_id:
        raise HTTPException(status_code=403, detail="未提供用户标识")

    user = db.query(User).filter(User.account == user_id).first()
    if not user:
        raise HTTPException(status_code=403, detail="用户不存在")

    if user.role != "admin":
        raise HTTPException(status_code=403, detail="无管理员权限")

    return user


def _parse_db_scope(raw: str | None) -> list[int] | None:
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
    _require_admin(db, user_id)
    users = db.query(User).order_by(User.id).all()
    return [
        UserItem(
            id=u.id,
            account=u.account,
            role=u.role,
            kb_scope=u.kb_scope or "none",
            db_scope=_parse_db_scope(u.db_scope),
            exp_extract_enabled=bool(u.exp_extract_enabled),
        )
        for u in users
    ]


@router.post("/users", response_model=UserItem)
def create_user(req: CreateUserRequest, user_id: str, db: Session = Depends(get_db)):
    _require_admin(db, user_id)

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
    _require_admin(db, caller_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    db.delete(user)
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/change-password")
def change_password(user_id: int, caller_id: str, req: ChangePasswordRequest, db: Session = Depends(get_db)):
    _require_admin(db, caller_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.password = req.new_password
    db.commit()
    return {"ok": True}


@router.get("/users/{user_id}/query-permission", response_model=QueryPermissionResponse)
def get_query_permission(user_id: int, caller_id: str, db: Session = Depends(get_db)):
    _require_admin(db, caller_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    return QueryPermissionResponse(
        kb_scope=user.kb_scope or "none",
        db_scope=_parse_db_scope(user.db_scope),
        exp_extract_enabled=bool(user.exp_extract_enabled),
    )


@router.put("/users/{user_id}/query-permission")
def set_query_permission(user_id: int, caller_id: str, req: SetQueryPermissionRequest, db: Session = Depends(get_db)):
    _require_admin(db, caller_id)

    if req.kb_scope not in ("public", "none"):
        raise HTTPException(status_code=400, detail="kb_scope 只能是 public 或 none")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    import json
    user.kb_scope = req.kb_scope
    user.db_scope = json.dumps(req.db_scope) if req.db_scope else None
    if req.exp_extract_enabled is not None:
        user.exp_extract_enabled = req.exp_extract_enabled
    db.commit()

    return {"ok": True}
