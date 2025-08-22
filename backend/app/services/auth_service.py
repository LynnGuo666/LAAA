from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from ..models.user import User, InvitationCode, UserDevice, SecurityVerification
from ..core.security import (
    verify_password, 
    get_password_hash, 
    generate_totp_secret,
    generate_verification_code,
    generate_backup_codes,
    hash_backup_codes,
    verify_totp,
    verify_backup_code
)
from ..core.config import settings
import uuid


class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def authenticate_user(self, username: str, password: str, device_id: str = None) -> Optional[User]:
        """用户认证"""
        user = self.db.query(User).filter(
            or_(User.username == username, User.email == username)
        ).first()
        
        if not user:
            return None
            
        # 检查账户是否被锁定
        if user.locked_until and user.locked_until > datetime.utcnow():
            return None
            
        if not verify_password(password, user.password_hash):
            # 增加失败登录次数
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.MAX_LOGIN_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(
                    minutes=settings.ACCOUNT_LOCKOUT_MINUTES
                )
            self.db.commit()
            return None
            
        # 重置失败登录次数
        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = datetime.utcnow()
        
        # 记录设备信息
        if device_id:
            self.update_device_info(user.id, device_id)
            
        self.db.commit()
        return user

    def create_user(self, username: str, email: str, password: str, invitation_code: str, 
                   device_id: str = None) -> Optional[User]:
        """创建用户"""
        # 验证邀请码
        invitation = self.validate_invitation_code(invitation_code)
        if not invitation:
            return None
            
        # 检查用户是否已存在
        if self.db.query(User).filter(
            or_(User.username == username, User.email == email)
        ).first():
            return None
            
        # 创建用户
        user = User(
            username=username,
            email=email,
            password_hash=get_password_hash(password),
            security_level=min(invitation.security_level, 1),  # 新用户默认低级
            created_by=invitation.created_by
        )
        
        self.db.add(user)
        self.db.flush()  # 获取用户ID
        
        # 使用邀请码
        invitation.used_by = user.id
        invitation.current_uses += 1
        invitation.used_at = datetime.utcnow()
        
        if invitation.current_uses >= invitation.max_uses:
            invitation.is_active = False
            
        # 记录设备信息
        if device_id:
            self.update_device_info(user.id, device_id)
            
        self.db.commit()
        return user

    def validate_invitation_code(self, code: str) -> Optional[InvitationCode]:
        """验证邀请码"""
        invitation = self.db.query(InvitationCode).filter(
            and_(
                InvitationCode.code == code,
                InvitationCode.is_active == True,
                InvitationCode.expires_at > datetime.utcnow(),
                InvitationCode.current_uses < InvitationCode.max_uses
            )
        ).first()
        
        return invitation

    def enable_totp(self, user_id: uuid.UUID) -> str:
        """启用TOTP"""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return None
            
        secret = generate_totp_secret()
        user.totp_secret = secret
        self.db.commit()
        
        return secret

    def verify_totp_and_enable(self, user_id: uuid.UUID, token: str) -> bool:
        """验证TOTP并启用"""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user or not user.totp_secret:
            return False
            
        if verify_totp(user.totp_secret, token):
            user.totp_enabled = True
            # 生成备用验证码
            backup_codes = generate_backup_codes()
            user.backup_codes = hash_backup_codes(backup_codes)
            self.db.commit()
            return True
            
        return False

    def verify_mfa(self, user_id: uuid.UUID, token: str, verification_type: str = "totp") -> bool:
        """验证多因子认证"""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return False
            
        if verification_type == "totp" and user.totp_enabled:
            return verify_totp(user.totp_secret, token)
        elif verification_type == "backup":
            if verify_backup_code(token, user.backup_codes or []):
                # 移除已使用的备用码
                new_codes = []
                for code in user.backup_codes:
                    if not verify_password(token, code):
                        new_codes.append(code)
                user.backup_codes = new_codes
                self.db.commit()
                return True
                
        return False

    def create_verification_code(self, user_id: uuid.UUID, verification_type: str) -> str:
        """创建验证码"""
        code = generate_verification_code()
        expires_at = datetime.utcnow() + timedelta(
            minutes=settings.EMAIL_VERIFICATION_EXPIRE_MINUTES
        )
        
        verification = SecurityVerification(
            user_id=user_id,
            verification_type=verification_type,
            verification_code=code,
            expires_at=expires_at
        )
        
        self.db.add(verification)
        self.db.commit()
        
        return code

    def verify_code(self, user_id: uuid.UUID, code: str, verification_type: str) -> bool:
        """验证验证码"""
        verification = self.db.query(SecurityVerification).filter(
            and_(
                SecurityVerification.user_id == user_id,
                SecurityVerification.verification_code == code,
                SecurityVerification.verification_type == verification_type,
                SecurityVerification.expires_at > datetime.utcnow(),
                SecurityVerification.is_used == False
            )
        ).first()
        
        if verification:
            verification.is_used = True
            self.db.commit()
            return True
            
        return False

    def update_device_info(self, user_id: uuid.UUID, device_id: str, 
                          device_name: str = None, device_type: str = "web",
                          device_fingerprint: str = None):
        """更新设备信息"""
        device = self.db.query(UserDevice).filter(
            and_(
                UserDevice.user_id == user_id,
                UserDevice.device_id == device_id
            )
        ).first()
        
        if device:
            device.last_seen_at = datetime.utcnow()
            if device_name:
                device.device_name = device_name
        else:
            device = UserDevice(
                user_id=user_id,
                device_id=device_id,
                device_name=device_name,
                device_type=device_type,
                device_fingerprint=device_fingerprint
            )
            self.db.add(device)
            
        self.db.commit()
        return device

    def get_user_devices(self, user_id: uuid.UUID) -> List[UserDevice]:
        """获取用户设备列表"""
        return self.db.query(UserDevice).filter(
            UserDevice.user_id == user_id
        ).order_by(UserDevice.last_seen_at.desc()).all()

    def trust_device(self, user_id: uuid.UUID, device_id: str, trusted: bool = True):
        """信任/取消信任设备"""
        device = self.db.query(UserDevice).filter(
            and_(
                UserDevice.user_id == user_id,
                UserDevice.device_id == device_id
            )
        ).first()
        
        if device:
            device.is_trusted = trusted
            self.db.commit()
            
        return device