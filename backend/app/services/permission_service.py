from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_
from ..models.user import User
from ..models.permission import Permission, UserPermission
from ..models.application import Application, ApplicationDevicePermission
from jose import jwt, JWTError
from ..core.config import settings
import uuid


class PermissionService:
    def __init__(self, db: Session):
        self.db = db

    def check_permission(self, user_id: uuid.UUID, resource: str, action: str, 
                        application_id: uuid.UUID = None, device_id: uuid.UUID = None) -> bool:
        """检查用户权限"""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            return False
            
        # 获取权限定义
        permission = self.db.query(Permission).filter(
            and_(
                Permission.resource == resource,
                Permission.action == action
            )
        ).first()
        
        if not permission:
            return False
            
        # 检查用户安全等级
        if user.security_level < permission.required_security_level:
            return False
            
        # 检查用户是否有该权限
        user_permission = self.db.query(UserPermission).filter(
            and_(
                UserPermission.user_id == user_id,
                UserPermission.permission_id == permission.id
            )
        )
        
        if application_id:
            user_permission = user_permission.filter(
                UserPermission.application_id == application_id
            )
            
        if not user_permission.first():
            return False
            
        # 如果指定了设备，检查设备权限
        if device_id and application_id:
            device_permission = self.db.query(ApplicationDevicePermission).filter(
                and_(
                    ApplicationDevicePermission.user_id == user_id,
                    ApplicationDevicePermission.application_id == application_id,
                    ApplicationDevicePermission.device_id == device_id
                )
            ).first()
            
            if not device_permission:
                return False
                
            # 检查设备权限是否包含该操作
            permission_key = f"{resource}:{action}"
            if permission_key not in device_permission.granted_permissions:
                return False
                
            # 检查权限是否过期
            if device_permission.expires_at and device_permission.expires_at < datetime.utcnow():
                return False
                
        return True

    def check_application_access(self, user_id: uuid.UUID, application_id: uuid.UUID,
                               device_id: uuid.UUID = None) -> bool:
        """检查应用访问权限"""
        user = self.db.query(User).filter(User.id == user_id).first()
        application = self.db.query(Application).filter(Application.id == application_id).first()
        
        if not user or not application or not user.is_active or not application.is_active:
            return False
            
        # 检查用户安全等级
        if user.security_level < application.required_security_level:
            return False
            
        # 如果应用要求MFA但用户未启用
        if application.require_mfa and not user.totp_enabled:
            return False
            
        return True

    def grant_device_permission(self, user_id: uuid.UUID, application_id: uuid.UUID,
                              device_id: uuid.UUID, permissions: List[str],
                              expires_in_days: int = None) -> ApplicationDevicePermission:
        """授予设备应用权限"""
        # 检查是否已存在
        existing = self.db.query(ApplicationDevicePermission).filter(
            and_(
                ApplicationDevicePermission.user_id == user_id,
                ApplicationDevicePermission.application_id == application_id,
                ApplicationDevicePermission.device_id == device_id
            )
        ).first()
        
        expires_at = None
        if expires_in_days:
            expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
        
        if existing:
            existing.granted_permissions = permissions
            existing.expires_at = expires_at
            self.db.commit()
            return existing
        else:
            device_permission = ApplicationDevicePermission(
                user_id=user_id,
                application_id=application_id,
                device_id=device_id,
                granted_permissions=permissions,
                expires_at=expires_at
            )
            
            self.db.add(device_permission)
            self.db.commit()
            return device_permission

    def revoke_device_permission(self, user_id: uuid.UUID, application_id: uuid.UUID,
                               device_id: uuid.UUID) -> bool:
        """撤销设备应用权限"""
        device_permission = self.db.query(ApplicationDevicePermission).filter(
            and_(
                ApplicationDevicePermission.user_id == user_id,
                ApplicationDevicePermission.application_id == application_id,
                ApplicationDevicePermission.device_id == device_id
            )
        ).first()
        
        if device_permission:
            self.db.delete(device_permission)
            self.db.commit()
            return True
            
        return False

    def get_user_permissions_for_app(self, user_id: uuid.UUID, application_id: uuid.UUID) -> List[str]:
        """获取用户在应用中的权限"""
        permissions = self.db.query(Permission).join(
            UserPermission,
            and_(
                UserPermission.permission_id == Permission.id,
                UserPermission.user_id == user_id,
                UserPermission.application_id == application_id
            )
        ).all()
        
        return [f"{p.resource}:{p.action}" for p in permissions]

    def get_device_permissions(self, user_id: uuid.UUID, device_id: uuid.UUID) -> List[ApplicationDevicePermission]:
        """获取设备权限列表"""
        return self.db.query(ApplicationDevicePermission).filter(
            and_(
                ApplicationDevicePermission.user_id == user_id,
                ApplicationDevicePermission.device_id == device_id
            )
        ).all()

    def require_additional_verification(self, permission_name: str) -> bool:
        """检查权限是否需要额外验证"""
        permission = self.db.query(Permission).filter(
            Permission.name == permission_name
        ).first()
        
        return permission and permission.require_additional_verification

    def decode_and_verify_token(self, token: str) -> Optional[dict]:
        """解码并验证JWT令牌"""
        try:
            payload = jwt.decode(
                token, 
                settings.SECRET_KEY, 
                algorithms=[settings.ALGORITHM]
            )
            user_id = payload.get("sub")
            if user_id is None:
                return None
            return {"user_id": uuid.UUID(user_id)}
        except JWTError:
            return None