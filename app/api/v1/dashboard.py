from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from app.core.database import get_db
from app.core.security import security
from app.services import UserService, ClientService
from app.models import User, ClientApplication, LoginLog, UserApplicationAccess, ApplicationPermissionGroup
from pydantic import BaseModel, EmailStr
import json

router = APIRouter(prefix="/api/v1/dashboard", tags=["仪表盘"])
security_scheme = HTTPBearer()


# Schemas
class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    nickname: Optional[str] = None
    profile: Optional[str] = None
    picture: Optional[str] = None
    website: Optional[str] = None
    phone_number: Optional[str] = None
    gender: Optional[str] = None
    birthdate: Optional[str] = None
    zoneinfo: Optional[str] = None
    locale: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    full_name: Optional[str] = None
    is_admin: bool = False


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None


class ClientUpdate(BaseModel):
    client_name: Optional[str] = None
    client_description: Optional[str] = None
    redirect_uris: Optional[List[str]] = None
    client_uri: Optional[str] = None
    logo_uri: Optional[str] = None
    tos_uri: Optional[str] = None
    policy_uri: Optional[str] = None
    is_active: Optional[bool] = None


class DashboardStats(BaseModel):
    total_users: int
    total_clients: int
    total_logins_today: int
    active_users_today: int


class LoginLogResponse(BaseModel):
    id: str
    user_id: str
    username: str
    login_time: datetime
    ip_address: str
    user_agent: str
    login_method: str
    success: bool
    failure_reason: Optional[str] = None
    client_name: Optional[str] = None

    class Config:
        from_attributes = True


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


def require_admin(current_user = Depends(get_current_user)):
    """要求管理员权限"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user


async def log_login(db: Session, user: User, request: Request, success: bool = True, 
                   failure_reason: str = None, client_id: str = None):
    """记录登录日志"""
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    
    log_entry = LoginLog(
        user_id=user.id,
        ip_address=client_ip,
        user_agent=user_agent,
        success=success,
        failure_reason=failure_reason,
        client_id=client_id
    )
    
    db.add(log_entry)
    db.commit()


# 用户个人资料管理
@router.get("/profile")
async def get_profile(current_user = Depends(get_current_user)):
    """获取用户个人资料"""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "given_name": current_user.given_name,
        "family_name": current_user.family_name,
        "nickname": current_user.nickname,
        "profile": current_user.profile,
        "picture": current_user.picture,
        "website": current_user.website,
        "phone_number": current_user.phone_number,
        "gender": current_user.gender,
        "birthdate": current_user.birthdate,
        "zoneinfo": current_user.zoneinfo,
        "locale": current_user.locale,
        "is_admin": current_user.is_admin,
        "created_at": current_user.created_at,
        "updated_at": current_user.updated_at
    }


@router.put("/profile")
async def update_profile(
    profile: ProfileUpdate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新用户个人资料"""
    # 更新用户信息
    if profile.full_name is not None:
        current_user.full_name = profile.full_name
    if profile.given_name is not None:
        current_user.given_name = profile.given_name
    if profile.family_name is not None:
        current_user.family_name = profile.family_name
    if profile.nickname is not None:
        current_user.nickname = profile.nickname
    if profile.profile is not None:
        current_user.profile = profile.profile
    if profile.picture is not None:
        current_user.picture = profile.picture
    if profile.website is not None:
        current_user.website = profile.website
    if profile.phone_number is not None:
        current_user.phone_number = profile.phone_number
    if profile.gender is not None:
        current_user.gender = profile.gender
    if profile.birthdate is not None:
        current_user.birthdate = profile.birthdate
    if profile.zoneinfo is not None:
        current_user.zoneinfo = profile.zoneinfo
    if profile.locale is not None:
        current_user.locale = profile.locale
    
    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    
    return {"message": "资料更新成功"}


@router.put("/profile/password")
async def change_password(
    password_data: PasswordChange,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """修改密码"""
    # 验证当前密码
    if not UserService.verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前密码不正确"
        )
    
    # 更新密码
    current_user.hashed_password = UserService.get_password_hash(password_data.new_password)
    current_user.updated_at = datetime.utcnow()
    db.commit()
    
    return {"message": "密码修改成功"}


# 管理员仪表盘统计
@router.get("/admin/stats", response_model=DashboardStats)
async def get_admin_stats(
    current_user = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """获取管理员仪表盘统计数据"""
    today = datetime.utcnow().date()
    
    total_users = db.query(User).count()
    total_clients = db.query(ClientApplication).count()
    
    # 今日登录次数
    total_logins_today = db.query(LoginLog).filter(
        LoginLog.login_time >= today,
        LoginLog.success == True
    ).count()
    
    # 今日活跃用户数
    active_users_today = db.query(LoginLog.user_id).filter(
        LoginLog.login_time >= today,
        LoginLog.success == True
    ).distinct().count()
    
    return DashboardStats(
        total_users=total_users,
        total_clients=total_clients,
        total_logins_today=total_logins_today,
        active_users_today=active_users_today
    )


# 管理员用户管理
@router.get("/admin/users")
async def get_all_users(
    current_user = Depends(require_admin),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    """获取所有用户列表"""
    users = db.query(User).offset(skip).limit(limit).all()
    return users


@router.post("/admin/users")
async def create_user(
    user_data: UserCreate,
    current_user = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """创建新用户"""
    # 检查用户名和邮箱是否已存在
    existing_user = db.query(User).filter(
        (User.username == user_data.username) | (User.email == user_data.email)
    ).first()
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名或邮箱已存在"
        )
    
    # 创建用户
    hashed_password = UserService.get_password_hash(user_data.password)
    new_user = User(
        email=user_data.email,
        username=user_data.username,
        hashed_password=hashed_password,
        full_name=user_data.full_name,
        is_admin=user_data.is_admin
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {"message": "用户创建成功", "user_id": new_user.id}


@router.put("/admin/users/{user_id}")
async def update_user(
    user_id: str,
    user_data: UserUpdate,
    current_user = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """更新用户信息"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    if user_data.email is not None:
        # 检查邮箱是否已被其他用户使用
        existing = db.query(User).filter(User.email == user_data.email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="邮箱已被其他用户使用")
        user.email = user_data.email
    
    if user_data.username is not None:
        # 检查用户名是否已被其他用户使用
        existing = db.query(User).filter(User.username == user_data.username, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="用户名已被其他用户使用")
        user.username = user_data.username
    
    if user_data.full_name is not None:
        user.full_name = user_data.full_name
    if user_data.is_active is not None:
        user.is_active = user_data.is_active
    if user_data.is_admin is not None:
        user.is_admin = user_data.is_admin
    
    user.updated_at = datetime.utcnow()
    db.commit()
    
    return {"message": "用户更新成功"}


@router.delete("/admin/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """删除用户"""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    db.delete(user)
    db.commit()
    
    return {"message": "用户删除成功"}


# 管理员应用管理
@router.get("/admin/clients")
async def get_all_clients(
    current_user = Depends(require_admin),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    """获取所有应用列表"""
    clients = db.query(ClientApplication).options(
        joinedload(ClientApplication.owner)
    ).offset(skip).limit(limit).all()
    return clients


@router.put("/admin/clients/{client_id}")
async def update_client(
    client_id: str,
    client_data: ClientUpdate,
    current_user = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """更新应用信息"""
    client = db.query(ClientApplication).filter(ClientApplication.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    if client_data.client_name is not None:
        client.client_name = client_data.client_name
    if client_data.client_description is not None:
        client.client_description = client_data.client_description
    if client_data.redirect_uris is not None:
        client.redirect_uris = json.dumps(client_data.redirect_uris)
    if client_data.client_uri is not None:
        client.client_uri = client_data.client_uri
    if client_data.logo_uri is not None:
        client.logo_uri = client_data.logo_uri
    if client_data.tos_uri is not None:
        client.tos_uri = client_data.tos_uri
    if client_data.policy_uri is not None:
        client.policy_uri = client_data.policy_uri
    if client_data.is_active is not None:
        client.is_active = client_data.is_active
    
    client.updated_at = datetime.utcnow()
    db.commit()
    
    return {"message": "应用更新成功"}


@router.delete("/admin/clients/{client_id}")
async def delete_client(
    client_id: str,
    current_user = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """删除应用"""
    client = db.query(ClientApplication).filter(ClientApplication.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    db.delete(client)
    db.commit()
    
    return {"message": "应用删除成功"}


# 登录日志管理
@router.get("/admin/logs/login", response_model=List[LoginLogResponse])
async def get_login_logs(
    current_user = Depends(require_admin),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    user_id: Optional[str] = None,
    days: Optional[int] = 30
):
    """获取登录日志"""
    query = db.query(LoginLog).options(
        joinedload(LoginLog.user),
        joinedload(LoginLog.client)
    )
    
    # 过滤条件
    if user_id:
        query = query.filter(LoginLog.user_id == user_id)
    
    if days:
        since_date = datetime.utcnow() - timedelta(days=days)
        query = query.filter(LoginLog.login_time >= since_date)
    
    logs = query.order_by(LoginLog.login_time.desc()).offset(skip).limit(limit).all()
    
    result = []
    for log in logs:
        result.append(LoginLogResponse(
            id=log.id,
            user_id=log.user_id,
            username=log.user.username if log.user else "未知用户",
            login_time=log.login_time,
            ip_address=log.ip_address or "unknown",
            user_agent=log.user_agent or "unknown",
            login_method=log.login_method,
            success=log.success,
            failure_reason=log.failure_reason,
            client_name=log.client.client_name if log.client else None
        ))
    
    return result


@router.get("/logs/my", response_model=List[LoginLogResponse])
async def get_my_login_logs(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 50
):
    """获取当前用户的登录日志"""
    logs = db.query(LoginLog).options(
        joinedload(LoginLog.client)
    ).filter(
        LoginLog.user_id == current_user.id
    ).order_by(LoginLog.login_time.desc()).offset(skip).limit(limit).all()
    
    result = []
    for log in logs:
        result.append(LoginLogResponse(
            id=log.id,
            user_id=log.user_id,
            username=current_user.username,
            login_time=log.login_time,
            ip_address=log.ip_address or "unknown",
            user_agent=log.user_agent or "unknown",
            login_method=log.login_method,
            success=log.success,
            failure_reason=log.failure_reason,
            client_name=log.client.client_name if log.client else None
        ))
    
    return result