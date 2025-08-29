from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.security import security
from app.services import UserService, ClientService
from app.schemas import (
    UserCreate, UserResponse, UserUpdate,
    ClientApplicationCreate, ClientApplicationResponse,
    ClientApplicationUpdate, ClientApplicationPublic,
    TokenResponse
)
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1", tags=["API"])
security_scheme = HTTPBearer()


class LoginRequest(BaseModel):
    username: str
    password: str


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: Session = Depends(get_db)
):
    """获取当前用户"""
    access_token = credentials.credentials
    try:
        payload = security.verify_token(access_token)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )
        
        user = UserService.get_user_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        return user
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/auth/login", response_model=TokenResponse)
async def login(
    request: Request,
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """用户登录"""
    user = UserService.authenticate_user(db, login_data.username, login_data.password)
    if not user:
        # 记录失败的登录尝试
        from app.api.v1.dashboard import log_login
        from app.models import User
        failed_user = db.query(User).filter(
            (User.username == login_data.username) | (User.email == login_data.username)
        ).first()
        if failed_user:
            await log_login(db, failed_user, request, success=False, failure_reason="密码错误")
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码不正确"
        )
    
    # 记录成功的登录
    from app.api.v1.dashboard import log_login
    await log_login(db, user, request, success=True)
    
    # 生成token
    from app.services import OAuth2Service
    access_token = security.create_access_token(data={"sub": user.id})
    refresh_token = security.create_refresh_token(data={"sub": user.id})
    
    return TokenResponse(
        access_token=access_token,
        token_type="Bearer",
        expires_in=1800,  # 30 minutes
        refresh_token=refresh_token
    )


@router.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """创建用户"""
    return UserService.create_user(db, user)


@router.get("/users/me", response_model=UserResponse)
async def get_current_user_info(current_user = Depends(get_current_user)):
    """获取当前用户信息"""
    return current_user


@router.put("/users/me", response_model=UserResponse)
async def update_current_user(
    user_update: UserUpdate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新当前用户信息"""
    return UserService.update_user(db, current_user.id, user_update)


@router.post("/clients", response_model=ClientApplicationResponse)
async def create_client_application(
    client: ClientApplicationCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建OAuth客户端应用"""
    return ClientService.create_client(db, client, current_user.id)


@router.get("/clients/my", response_model=List[ClientApplicationResponse])
async def list_my_client_applications(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取当前用户的客户端应用列表"""
    from app.models import ClientApplication
    clients = db.query(ClientApplication).filter(
        ClientApplication.owner_id == current_user.id
    ).all()
    return clients


@router.get("/clients/{client_id}", response_model=ClientApplicationPublic)
async def get_client_public_info(client_id: str, db: Session = Depends(get_db)):
    """获取客户端公开信息"""
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client