from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import List
from ...core.database import get_db
from ...services.auth_service import AuthService
from ...services.permission_service import PermissionService
from ...models.user import User
from ...schemas.user import UserLogin, UserRegister, UserResponse, TOTPEnable, TOTPVerify
from ...core.security import create_access_token, create_refresh_token, generate_totp_qr_code
import uuid

router = APIRouter()
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """获取当前用户"""
    permission_service = PermissionService(db)
    token_data = permission_service.decode_and_verify_token(credentials.credentials)
    
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    
    user = db.query(User).filter(User.id == token_data["user_id"]).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )
    
    return user


@router.post("/login")
async def login(user_login: UserLogin, request: Request, db: Session = Depends(get_db)):
    """用户登录"""
    auth_service = AuthService(db)
    
    # 获取设备ID (简化实现)
    device_id = request.headers.get("X-Device-ID", "unknown")
    
    user = auth_service.authenticate_user(
        user_login.username, 
        user_login.password,
        device_id
    )
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    # 检查是否需要MFA验证
    if user.totp_enabled and not user_login.totp_token:
        return {
            "requires_mfa": True,
            "message": "TOTP verification required"
        }
    
    # 验证TOTP
    if user.totp_enabled and user_login.totp_token:
        if not auth_service.verify_mfa(user.id, user_login.totp_token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid TOTP token"
            )
    
    # 生成令牌
    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": UserResponse.from_orm(user)
    }


@router.post("/register")
async def register(user_register: UserRegister, request: Request, db: Session = Depends(get_db)):
    """用户注册"""
    auth_service = AuthService(db)
    
    device_id = request.headers.get("X-Device-ID", "unknown")
    
    user = auth_service.create_user(
        user_register.username,
        user_register.email,
        user_register.password,
        user_register.invitation_code,
        device_id
    )
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration failed. Invalid invitation code or user already exists."
        )
    
    return {"message": "User registered successfully", "user_id": str(user.id)}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    return current_user


@router.post("/enable-totp")
async def enable_totp(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """启用TOTP"""
    if current_user.totp_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TOTP already enabled"
        )
    
    auth_service = AuthService(db)
    secret = auth_service.enable_totp(current_user.id)
    
    qr_code = generate_totp_qr_code(secret, current_user.email)
    
    return {
        "secret": secret,
        "qr_code": qr_code,
        "message": "Scan the QR code with your authenticator app and verify with a token"
    }


@router.post("/verify-totp")
async def verify_totp(
    totp_verify: TOTPVerify,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """验证并完成TOTP设置"""
    auth_service = AuthService(db)
    
    if auth_service.verify_totp_and_enable(current_user.id, totp_verify.token):
        return {"message": "TOTP enabled successfully"}
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid TOTP token"
        )


@router.get("/devices")
async def get_devices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户设备列表"""
    auth_service = AuthService(db)
    devices = auth_service.get_user_devices(current_user.id)
    
    return [
        {
            "id": str(device.id),
            "device_id": device.device_id,
            "device_name": device.device_name,
            "device_type": device.device_type,
            "is_trusted": device.is_trusted,
            "last_seen_at": device.last_seen_at
        }
        for device in devices
    ]


@router.post("/devices/{device_id}/trust")
async def trust_device(
    device_id: str,
    trusted: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """信任/取消信任设备"""
    auth_service = AuthService(db)
    device = auth_service.trust_device(current_user.id, device_id, trusted)
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )
    
    return {"message": f"Device {'trusted' if trusted else 'untrusted'} successfully"}