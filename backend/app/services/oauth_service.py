from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_
from ..models.oauth import OAuthToken, OAuthAuthorizationCode
from ..models.application import Application
from ..models.user import User
from ..core.security import create_access_token, generate_verification_code
from ..core.config import settings
import uuid
import secrets


class OAuthService:
    def __init__(self, db: Session):
        self.db = db

    def create_authorization_code(self, user_id: uuid.UUID, application_id: uuid.UUID, 
                                redirect_uri: str, scopes: List[str] = None) -> str:
        """创建授权码"""
        code = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(
            minutes=settings.OAUTH_AUTH_CODE_EXPIRE_MINUTES
        )
        
        auth_code = OAuthAuthorizationCode(
            code=code,
            user_id=user_id,
            application_id=application_id,
            redirect_uri=redirect_uri,
            scopes=scopes or ["read"],
            expires_at=expires_at
        )
        
        self.db.add(auth_code)
        self.db.commit()
        
        return code

    def exchange_code_for_token(self, code: str, application_id: uuid.UUID, 
                              redirect_uri: str) -> Optional[Dict[str, Any]]:
        """授权码换取访问令牌"""
        auth_code = self.db.query(OAuthAuthorizationCode).filter(
            and_(
                OAuthAuthorizationCode.code == code,
                OAuthAuthorizationCode.application_id == application_id,
                OAuthAuthorizationCode.redirect_uri == redirect_uri,
                OAuthAuthorizationCode.expires_at > datetime.utcnow(),
                OAuthAuthorizationCode.is_used == False
            )
        ).first()
        
        if not auth_code:
            return None
            
        # 标记授权码已使用
        auth_code.is_used = True
        
        # 创建访问令牌
        access_token = create_access_token(
            subject=str(auth_code.user_id),
            expires_delta=timedelta(minutes=settings.OAUTH_ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        
        refresh_token = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(
            minutes=settings.OAUTH_ACCESS_TOKEN_EXPIRE_MINUTES
        )
        
        # 保存令牌
        oauth_token = OAuthToken(
            user_id=auth_code.user_id,
            application_id=application_id,
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
            scopes=auth_code.scopes
        )
        
        self.db.add(oauth_token)
        self.db.commit()
        
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "Bearer",
            "expires_in": settings.OAUTH_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "scope": " ".join(auth_code.scopes)
        }

    def refresh_access_token(self, refresh_token: str) -> Optional[Dict[str, Any]]:
        """刷新访问令牌"""
        token = self.db.query(OAuthToken).filter(
            OAuthToken.refresh_token == refresh_token
        ).first()
        
        if not token:
            return None
            
        # 创建新的访问令牌
        new_access_token = create_access_token(
            subject=str(token.user_id),
            expires_delta=timedelta(minutes=settings.OAUTH_ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        
        # 更新令牌
        token.access_token = new_access_token
        token.expires_at = datetime.utcnow() + timedelta(
            minutes=settings.OAUTH_ACCESS_TOKEN_EXPIRE_MINUTES
        )
        
        self.db.commit()
        
        return {
            "access_token": new_access_token,
            "token_type": "Bearer",
            "expires_in": settings.OAUTH_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "scope": " ".join(token.scopes)
        }

    def validate_application(self, client_id: str, client_secret: str = None) -> Optional[Application]:
        """验证应用"""
        query = self.db.query(Application).filter(
            and_(
                Application.client_id == client_id,
                Application.is_active == True
            )
        )
        
        if client_secret:
            # 客户端凭证模式需要验证密钥
            query = query.filter(Application.client_secret == client_secret)
            
        return query.first()

    def validate_redirect_uri(self, application: Application, redirect_uri: str) -> bool:
        """验证重定向URI"""
        return redirect_uri in application.redirect_uris

    def validate_scopes(self, application: Application, requested_scopes: List[str]) -> List[str]:
        """验证并返回有效的作用域"""
        valid_scopes = []
        for scope in requested_scopes:
            if scope in application.allowed_scopes:
                valid_scopes.append(scope)
        return valid_scopes

    def get_user_info(self, access_token: str) -> Optional[Dict[str, Any]]:
        """获取用户信息"""
        token = self.db.query(OAuthToken).filter(
            and_(
                OAuthToken.access_token == access_token,
                OAuthToken.expires_at > datetime.utcnow()
            )
        ).first()
        
        if not token:
            return None
            
        user = self.db.query(User).filter(User.id == token.user_id).first()
        if not user:
            return None
            
        user_info = {
            "sub": str(user.id),
            "username": user.username,
            "email": user.email,
            "email_verified": user.email_verified,
            "security_level": user.security_level
        }
        
        # 根据作用域返回不同信息
        if "profile" in token.scopes:
            user_info.update({
                "phone": user.phone,
                "phone_verified": user.phone_verified
            })
            
        return user_info

    def revoke_token(self, token: str, token_type: str = "access_token"):
        """撤销令牌"""
        if token_type == "access_token":
            oauth_token = self.db.query(OAuthToken).filter(
                OAuthToken.access_token == token
            ).first()
        else:
            oauth_token = self.db.query(OAuthToken).filter(
                OAuthToken.refresh_token == token
            ).first()
            
        if oauth_token:
            self.db.delete(oauth_token)
            self.db.commit()
            return True
            
        return False