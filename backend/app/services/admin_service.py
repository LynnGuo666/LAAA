from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_
from ..models.user import User, InvitationCode
from ..models.application import Application, ApplicationDevicePermission
from ..models.permission import Permission, UserPermission
from ..core.security import generate_invitation_code
from ..core.config import settings
import uuid


class AdminService:
    def __init__(self, db: Session):
        self.db = db

    def create_invitation_code(self, creator_id: uuid.UUID, security_level: int = 1,
                             max_uses: int = 1, expire_days: int = None) -> InvitationCode:
        """创建邀请码"""
        if not expire_days:
            expire_days = settings.DEFAULT_INVITATION_EXPIRE_DAYS
            
        code = generate_invitation_code()
        expires_at = datetime.utcnow() + timedelta(days=expire_days)
        
        invitation = InvitationCode(
            code=code,
            created_by=creator_id,
            security_level=security_level,
            max_uses=max_uses,
            expires_at=expires_at
        )
        
        self.db.add(invitation)
        self.db.commit()
        
        return invitation

    def list_invitation_codes(self, creator_id: uuid.UUID = None, 
                            active_only: bool = True) -> List[InvitationCode]:
        """获取邀请码列表"""
        query = self.db.query(InvitationCode)
        
        if creator_id:
            query = query.filter(InvitationCode.created_by == creator_id)
            
        if active_only:
            query = query.filter(
                and_(
                    InvitationCode.is_active == True,
                    InvitationCode.expires_at > datetime.utcnow()
                )
            )
            
        return query.order_by(InvitationCode.created_at.desc()).all()

    def deactivate_invitation_code(self, code_id: uuid.UUID) -> bool:
        """停用邀请码"""
        invitation = self.db.query(InvitationCode).filter(
            InvitationCode.id == code_id
        ).first()
        
        if invitation:
            invitation.is_active = False
            self.db.commit()
            return True
            
        return False

    def list_users(self, page: int = 1, size: int = 20, 
                  security_level: int = None, active_only: bool = True) -> List[User]:
        """获取用户列表"""
        query = self.db.query(User)
        
        if security_level:
            query = query.filter(User.security_level == security_level)
            
        if active_only:
            query = query.filter(User.is_active == True)
            
        offset = (page - 1) * size
        return query.offset(offset).limit(size).all()

    def update_user_security_level(self, user_id: uuid.UUID, security_level: int) -> bool:
        """更新用户安全等级"""
        user = self.db.query(User).filter(User.id == user_id).first()
        
        if user and 1 <= security_level <= 4:
            user.security_level = security_level
            self.db.commit()
            return True
            
        return False

    def deactivate_user(self, user_id: uuid.UUID) -> bool:
        """停用用户"""
        user = self.db.query(User).filter(User.id == user_id).first()
        
        if user:
            user.is_active = False
            self.db.commit()
            return True
            
        return False

    def create_application(self, creator_id: uuid.UUID, name: str, description: str = None,
                         logo_url: str = None, website_url: str = None, 
                         support_email: str = None, privacy_policy_url: str = None,
                         terms_of_service_url: str = None, redirect_uris: List[str] = None, 
                         required_security_level: int = 1, require_mfa: bool = False) -> Application:
        """创建应用"""
        import secrets
        
        client_id = f"app_{secrets.token_urlsafe(16)}"
        client_secret = secrets.token_urlsafe(32)
        
        app = Application(
            name=name,
            description=description,
            logo_url=logo_url,
            website_url=website_url,
            support_email=support_email,
            privacy_policy_url=privacy_policy_url,
            terms_of_service_url=terms_of_service_url,
            client_id=client_id,
            client_secret=client_secret,
            redirect_uris=redirect_uris or [],
            required_security_level=required_security_level,
            require_mfa=require_mfa,
            created_by=creator_id
        )
        
        self.db.add(app)
        self.db.commit()
        
        return app

    def list_applications(self, creator_id: uuid.UUID = None) -> List[Application]:
        """获取应用列表"""
        query = self.db.query(Application)
        
        if creator_id:
            query = query.filter(Application.created_by == creator_id)
            
        return query.filter(Application.is_active == True).all()

    def update_application(self, app_id: uuid.UUID, **kwargs) -> bool:
        """更新应用"""
        app = self.db.query(Application).filter(Application.id == app_id).first()
        
        if app:
            for key, value in kwargs.items():
                if hasattr(app, key):
                    setattr(app, key, value)
            self.db.commit()
            return True
            
        return False

    def delete_application(self, app_id: uuid.UUID) -> bool:
        """删除应用"""
        app = self.db.query(Application).filter(Application.id == app_id).first()
        
        if app:
            app.is_active = False
            self.db.commit()
            return True
            
        return False

    def create_permission(self, name: str, resource: str, action: str,
                        description: str = None, required_security_level: int = 1,
                        require_additional_verification: bool = False) -> Permission:
        """创建权限"""
        permission = Permission(
            name=name,
            description=description,
            resource=resource,
            action=action,
            required_security_level=required_security_level,
            require_additional_verification=require_additional_verification
        )
        
        self.db.add(permission)
        self.db.commit()
        
        return permission

    def grant_permission(self, user_id: uuid.UUID, permission_id: uuid.UUID, 
                        application_id: uuid.UUID) -> UserPermission:
        """授予权限"""
        # 检查是否已存在
        existing = self.db.query(UserPermission).filter(
            and_(
                UserPermission.user_id == user_id,
                UserPermission.permission_id == permission_id,
                UserPermission.application_id == application_id
            )
        ).first()
        
        if existing:
            return existing
            
        user_permission = UserPermission(
            user_id=user_id,
            permission_id=permission_id,
            application_id=application_id
        )
        
        self.db.add(user_permission)
        self.db.commit()
        
        return user_permission

    def revoke_permission(self, user_id: uuid.UUID, permission_id: uuid.UUID, 
                         application_id: uuid.UUID) -> bool:
        """撤销权限"""
        user_permission = self.db.query(UserPermission).filter(
            and_(
                UserPermission.user_id == user_id,
                UserPermission.permission_id == permission_id,
                UserPermission.application_id == application_id
            )
        ).first()
        
        if user_permission:
            self.db.delete(user_permission)
            self.db.commit()
            return True
            
        return False

    def get_user_permissions(self, user_id: uuid.UUID, application_id: uuid.UUID = None) -> List[UserPermission]:
        """获取用户权限"""
        query = self.db.query(UserPermission).filter(
            UserPermission.user_id == user_id
        )
        
        if application_id:
            query = query.filter(UserPermission.application_id == application_id)
            
        return query.all()

    def grant_application_access(self, user_id: str, application_id: str) -> UserPermission:
        """授予用户应用访问权限"""
        # 获取应用访问权限
        access_permission = self.db.query(Permission).filter(
            and_(
                Permission.resource == "applications",
                Permission.action == "access"
            )
        ).first()
        
        if not access_permission:
            raise ValueError("Application access permission not found")
            
        # 检查是否已经有权限
        existing = self.db.query(UserPermission).filter(
            and_(
                UserPermission.user_id == user_id,
                UserPermission.permission_id == access_permission.id,
                UserPermission.application_id == application_id
            )
        ).first()
        
        if existing:
            return existing
            
        # 创建新权限
        user_permission = UserPermission(
            user_id=user_id,
            permission_id=access_permission.id,
            application_id=application_id
        )
        
        self.db.add(user_permission)
        self.db.commit()
        
        return user_permission

    def revoke_application_access(self, user_id: str, application_id: str) -> bool:
        """撤销用户应用访问权限"""
        # 获取应用访问权限
        access_permission = self.db.query(Permission).filter(
            and_(
                Permission.resource == "applications",
                Permission.action == "access"
            )
        ).first()
        
        if not access_permission:
            return False
            
        user_permission = self.db.query(UserPermission).filter(
            and_(
                UserPermission.user_id == user_id,
                UserPermission.permission_id == access_permission.id,
                UserPermission.application_id == application_id
            )
        ).first()
        
        if user_permission:
            self.db.delete(user_permission)
            self.db.commit()
            return True
            
        return False

    def get_application_users(self, application_id: str) -> List[dict]:
        """获取有权限访问应用的用户列表"""
        access_permission = self.db.query(Permission).filter(
            and_(
                Permission.resource == "applications",
                Permission.action == "access"
            )
        ).first()
        
        if not access_permission:
            return []
            
        users = self.db.query(User).join(
            UserPermission,
            and_(
                UserPermission.user_id == User.id,
                UserPermission.permission_id == access_permission.id,
                UserPermission.application_id == application_id
            )
        ).all()
        
        return [{
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "security_level": user.security_level,
            "is_active": user.is_active,
            "granted_at": self.db.query(UserPermission).filter(
                and_(
                    UserPermission.user_id == user.id,
                    UserPermission.permission_id == access_permission.id,
                    UserPermission.application_id == application_id
                )
            ).first().granted_at
        } for user in users]

    def get_available_users_for_application(self, application_id: str) -> List[dict]:
        """获取可以授权给应用的用户列表（排除已有权限的用户）"""
        access_permission = self.db.query(Permission).filter(
            and_(
                Permission.resource == "applications",
                Permission.action == "access"
            )
        ).first()
        
        if not access_permission:
            return []
            
        # 获取已经有权限的用户ID
        authorized_user_ids = self.db.query(UserPermission.user_id).filter(
            and_(
                UserPermission.permission_id == access_permission.id,
                UserPermission.application_id == application_id
            )
        ).subquery()
        
        # 获取没有权限的活跃用户
        users = self.db.query(User).filter(
            and_(
                User.is_active == True,
                ~User.id.in_(authorized_user_ids)
            )
        ).all()
        
        return [{
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "security_level": user.security_level
        } for user in users]

    def get_system_stats(self) -> dict:
        """获取系统统计信息"""
        total_users = self.db.query(User).count()
        active_users = self.db.query(User).filter(User.is_active == True).count()
        total_apps = self.db.query(Application).filter(Application.is_active == True).count()
        total_invitations = self.db.query(InvitationCode).filter(
            and_(
                InvitationCode.is_active == True,
                InvitationCode.expires_at > datetime.utcnow()
            )
        ).count()
        
        return {
            "total_users": total_users,
            "active_users": active_users,
            "total_applications": total_apps,
            "active_invitations": total_invitations
        }