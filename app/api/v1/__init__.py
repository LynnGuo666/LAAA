from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.security import security
from app.services import UserService, ClientService
from app.schemas import (
    UserCreate, UserResponse, UserUpdate,
    ClientApplicationCreate, ClientApplicationResponse,
    ClientApplicationUpdate, ClientApplicationPublic
)

router = APIRouter(prefix="/api/v1", tags=["API"])
security_scheme = HTTPBearer()


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


@router.get("/clients", response_model=List[ClientApplicationResponse])
async def list_client_applications(
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