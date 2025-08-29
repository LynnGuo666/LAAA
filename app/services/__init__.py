from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models import User, ClientApplication, AuthorizationCode, OAuth2Token, UserAuthorization
from app.schemas import UserCreate, UserUpdate, ClientApplicationCreate, ClientApplicationUpdate
from app.core.security import security
import json


class UserService:
    @staticmethod
    def create_user(db: Session, user: UserCreate) -> User:
        """创建用户"""
        # 检查用户是否已存在
        existing_user = db.query(User).filter(
            (User.email == user.email) | (User.username == user.username)
        ).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email or username already exists"
            )
        
        hashed_password = security.get_password_hash(user.password)
        db_user = User(
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            hashed_password=hashed_password,
            is_active=user.is_active
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        return db_user

    @staticmethod
    def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
        """验证用户"""
        user = db.query(User).filter(
            (User.username == username) | (User.email == username)
        ).first()
        if not user or not security.verify_password(password, user.hashed_password):
            return None
        return user

    @staticmethod
    def get_user_by_id(db: Session, user_id: str) -> Optional[User]:
        """根据ID获取用户"""
        return db.query(User).filter(User.id == user_id).first()

    @staticmethod
    def get_user_by_username(db: Session, username: str) -> Optional[User]:
        """根据用户名获取用户"""
        return db.query(User).filter(User.username == username).first()

    @staticmethod
    def update_user(db: Session, user_id: str, user_update: UserUpdate) -> User:
        """更新用户"""
        user = UserService.get_user_by_id(db, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        update_data = user_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)
        
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def delete_user(db: Session, user_id: str) -> bool:
        """删除用户"""
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return False
        
        db.delete(user)
        db.commit()
        return True

    @staticmethod
    def get_user_info_claims(user: User, scopes: List[str]) -> Dict[str, Any]:
        """根据作用域获取用户信息"""
        claims = {"sub": user.id}
        
        if "profile" in scopes:
            profile_claims = {
                "name": user.full_name,
                "given_name": user.given_name,
                "family_name": user.family_name,
                "middle_name": user.middle_name,
                "nickname": user.nickname,
                "preferred_username": user.preferred_username or user.username,
                "profile": user.profile,
                "picture": user.picture,
                "website": user.website,
                "gender": user.gender,
                "birthdate": user.birthdate,
                "zoneinfo": user.zoneinfo,
                "locale": user.locale,
                "updated_at": int(user.updated_at.timestamp()) if user.updated_at else None
            }
            claims.update({k: v for k, v in profile_claims.items() if v is not None})
        
        if "email" in scopes:
            claims.update({
                "email": user.email,
                "email_verified": user.email_verified
            })
        
        if "phone" in scopes:
            claims.update({
                "phone_number": user.phone_number,
                "phone_number_verified": user.phone_number_verified
            })
        
        return claims


class ClientService:
    @staticmethod
    def create_client(db: Session, client: ClientApplicationCreate, owner_id: str) -> ClientApplication:
        """创建OAuth客户端"""
        client_id = security.generate_client_id(client.client_name)
        client_secret = security.generate_client_secret()
        
        db_client = ClientApplication(
            client_id=client_id,
            client_secret=client_secret,
            client_name=client.client_name,
            client_description=client.client_description,
            redirect_uris=json.dumps(client.redirect_uris),
            response_types=client.response_types,
            grant_types=client.grant_types,
            scope=client.scope,
            client_uri=client.client_uri,
            logo_uri=client.logo_uri,
            tos_uri=client.tos_uri,
            policy_uri=client.policy_uri,
            contacts=json.dumps(client.contacts) if client.contacts else None,
            token_endpoint_auth_method=client.token_endpoint_auth_method,
            jwks_uri=client.jwks_uri,
            owner_id=owner_id
        )
        
        db.add(db_client)
        db.commit()
        db.refresh(db_client)
        return db_client

    @staticmethod
    def get_client_by_id(db: Session, client_id: str) -> Optional[ClientApplication]:
        """根据client_id获取客户端"""
        return db.query(ClientApplication).filter(
            ClientApplication.client_id == client_id,
            ClientApplication.is_active == True
        ).first()

    @staticmethod
    def authenticate_client(db: Session, client_id: str, client_secret: str) -> Optional[ClientApplication]:
        """验证客户端"""
        client = ClientService.get_client_by_id(db, client_id)
        if not client or client.client_secret != client_secret:
            return None
        return client

    @staticmethod
    def validate_redirect_uri(client: ClientApplication, redirect_uri: str) -> bool:
        """验证重定向URI"""
        registered_uris = json.loads(client.redirect_uris)
        return redirect_uri in registered_uris

    @staticmethod
    def update_client(db: Session, client_id: str, client_update: ClientApplicationUpdate) -> Optional[ClientApplication]:
        """更新客户端应用"""
        client = db.query(ClientApplication).filter(
            ClientApplication.client_id == client_id
        ).first()
        if not client:
            return None
        
        update_data = client_update.model_dump(exclude_unset=True)
        
        # 处理需要JSON序列化的字段
        if 'redirect_uris' in update_data and update_data['redirect_uris']:
            update_data['redirect_uris'] = json.dumps(update_data['redirect_uris'])
        if 'contacts' in update_data and update_data['contacts']:
            update_data['contacts'] = json.dumps(update_data['contacts'])
        
        for field, value in update_data.items():
            setattr(client, field, value)
        
        db.commit()
        db.refresh(client)
        return client

    @staticmethod
    def delete_client(db: Session, client_id: str) -> bool:
        """删除客户端应用"""
        client = db.query(ClientApplication).filter(
            ClientApplication.client_id == client_id
        ).first()
        if not client:
            return False
        
        db.delete(client)
        db.commit()
        return True


class OAuth2Service:
    @staticmethod
    def create_authorization_code(
        db: Session,
        user_id: str,
        client_id: str,
        redirect_uri: str,
        scope: str,
        code_challenge: Optional[str] = None,
        code_challenge_method: str = "S256",
        nonce: Optional[str] = None
    ) -> AuthorizationCode:
        """创建授权码"""
        code = security.generate_authorization_code()
        expires_at = datetime.utcnow() + timedelta(minutes=10)  # 授权码10分钟过期
        
        auth_code = AuthorizationCode(
            code=code,
            user_id=user_id,
            client_id=client_id,
            redirect_uri=redirect_uri,
            scope=scope,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            nonce=nonce,
            expires_at=expires_at
        )
        
        db.add(auth_code)
        db.commit()
        db.refresh(auth_code)
        return auth_code

    @staticmethod
    def exchange_code_for_tokens(
        db: Session,
        code: str,
        client_id: str,
        redirect_uri: str,
        code_verifier: Optional[str] = None
    ) -> Dict[str, Any]:
        """授权码换取令牌"""
        # 查找授权码
        auth_code = db.query(AuthorizationCode).filter(
            AuthorizationCode.code == code,
            AuthorizationCode.used == False
        ).first()
        
        if not auth_code:
            raise HTTPException(status_code=400, detail="Invalid authorization code")
        
        if auth_code.expires_at < datetime.utcnow():
            raise HTTPException(status_code=400, detail="Authorization code expired")
        
        # 获取客户端信息以比较
        client = db.query(ClientApplication).filter(ClientApplication.client_id == client_id).first()
        if not client:
            raise HTTPException(status_code=400, detail="Invalid client")
        
        if auth_code.client_id != client.id:
            raise HTTPException(status_code=400, detail="Client mismatch")
        
        if auth_code.redirect_uri != redirect_uri:
            raise HTTPException(status_code=400, detail="Redirect URI mismatch")
        
        # 验证PKCE
        if auth_code.code_challenge and not code_verifier:
            raise HTTPException(status_code=400, detail="Code verifier required")
        
        if auth_code.code_challenge:
            if not security.verify_pkce(code_verifier, auth_code.code_challenge, auth_code.code_challenge_method):
                raise HTTPException(status_code=400, detail="Invalid code verifier")
        
        # 标记授权码为已使用
        auth_code.used = True
        db.commit()
        
        # 获取用户信息
        user = db.query(User).filter(User.id == auth_code.user_id).first()
        
        if not user:
            raise HTTPException(status_code=400, detail="Invalid user")
        
        # 生成令牌
        scopes = security.parse_scope(auth_code.scope)
        user_data = {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "given_name": user.given_name,
            "family_name": user.family_name,
            "middle_name": user.middle_name,
            "nickname": user.nickname,
            "preferred_username": user.preferred_username,
            "profile": user.profile,
            "picture": user.picture,
            "website": user.website,
            "phone_number": user.phone_number,
            "phone_number_verified": user.phone_number_verified,
            "email_verified": user.email_verified,
            "gender": user.gender,
            "birthdate": user.birthdate,
            "zoneinfo": user.zoneinfo,
            "locale": user.locale
        }
        
        access_token_data = {
            "sub": user.id,
            "client_id": client_id,
            "scope": auth_code.scope
        }
        
        access_token = security.create_access_token(access_token_data)
        refresh_token = security.create_refresh_token({"sub": user.id, "client_id": client_id})
        
        # 保存令牌到数据库
        expires_at = datetime.utcnow() + timedelta(minutes=security.access_token_expire_minutes)
        oauth_token = OAuth2Token(
            access_token=access_token,
            refresh_token=refresh_token,
            scope=auth_code.scope,
            user_id=user.id,
            client_id=client.id,
            expires_at=expires_at
        )
        db.add(oauth_token)
        
        # 创建或更新用户授权
        existing_auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()
        
        if not existing_auth:
            user_auth = UserAuthorization(
                user_id=user.id,
                client_id=client.id,
                scope=auth_code.scope
            )
            db.add(user_auth)
        
        db.commit()
        
        result = {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": security.access_token_expire_minutes * 60,
            "refresh_token": refresh_token,
            "scope": auth_code.scope
        }
        
        # 如果scope包含openid，生成ID令牌
        if "openid" in scopes:
            id_token = security.create_id_token(user_data, client_id, auth_code.nonce)
            result["id_token"] = id_token
        
        return result

    @staticmethod
    def refresh_token(db: Session, refresh_token: str, client_id: str) -> Dict[str, Any]:
        """刷新令牌"""
        try:
            payload = security.verify_token(refresh_token)
        except HTTPException:
            raise HTTPException(status_code=400, detail="Invalid refresh token")
        
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=400, detail="Invalid token type")
        
        if payload.get("client_id") != client_id:
            raise HTTPException(status_code=400, detail="Client mismatch")
        
        user_id = payload.get("sub")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=400, detail="User not found")
        
        # 查找原始令牌以获取scope
        original_token = db.query(OAuth2Token).filter(
            OAuth2Token.refresh_token == refresh_token,
            OAuth2Token.revoked == False
        ).first()
        
        if not original_token:
            raise HTTPException(status_code=400, detail="Token not found")
        
        # 撤销原有令牌
        original_token.revoked = True
        
        # 生成新令牌
        access_token_data = {
            "sub": user_id,
            "client_id": client_id,
            "scope": original_token.scope
        }
        
        new_access_token = security.create_access_token(access_token_data)
        new_refresh_token = security.create_refresh_token({"sub": user_id, "client_id": client_id})
        
        # 保存新令牌
        client = db.query(ClientApplication).filter(ClientApplication.client_id == client_id).first()
        expires_at = datetime.utcnow() + timedelta(minutes=security.access_token_expire_minutes)
        new_token = OAuth2Token(
            access_token=new_access_token,
            refresh_token=new_refresh_token,
            scope=original_token.scope,
            user_id=user_id,
            client_id=client.id,
            expires_at=expires_at
        )
        db.add(new_token)
        db.commit()
        
        return {
            "access_token": new_access_token,
            "token_type": "Bearer",
            "expires_in": security.access_token_expire_minutes * 60,
            "refresh_token": new_refresh_token,
            "scope": original_token.scope
        }

    @staticmethod
    def get_user_info(db: Session, access_token: str) -> Dict[str, Any]:
        """获取用户信息"""
        try:
            payload = security.verify_token(access_token)
        except HTTPException:
            raise HTTPException(status_code=401, detail="Invalid access token")
        
        user_id = payload.get("sub")
        scope = payload.get("scope", "")
        scopes = security.parse_scope(scope)
        
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        return UserService.get_user_info_claims(user, scopes)