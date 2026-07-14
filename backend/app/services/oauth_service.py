import base64
import hashlib
import hmac
import json
import logging
from datetime import timedelta
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Client, Token, User, UserAuthorization
from app.utils.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_random_string,
    hash_token,
    verify_client_secret,
)
from app.utils.time import utcnow

settings = get_settings()
logger = logging.getLogger("uvicorn.error")


class OAuthService:
    """OAuth 2.0 service"""

    @staticmethod
    def _short_hash(value: str) -> str:
        if not value:
            return "empty"
        return hashlib.sha256(value.encode("utf-8")).hexdigest()[:10]

    @staticmethod
    def check_user_access(user: User, client: Client) -> bool:
        """检查用户是否有权限访问该应用"""
        return user.can_access_client(client)

    @staticmethod
    def get_client_by_id(db: Session, client_id: str) -> Optional[Client]:
        """Get client by client_id"""
        return db.query(Client).filter(Client.client_id == client_id).first()

    @staticmethod
    def verify_redirect_uri(client: Client, redirect_uri: str) -> bool:
        """Verify if redirect_uri is allowed for the client"""
        try:
            allowed_uris = json.loads(client.redirect_uris)
            return redirect_uri in allowed_uris
        except Exception as e:
            logger.warning(
                "oauth verify_redirect_uri failed client_id=%s err=%s",
                getattr(client, "client_id", None), e,
            )
            return False

    @staticmethod
    def verify_scope(client: Client, requested_scope: str) -> bool:
        """Verify if requested scope is allowed for the client"""
        try:
            allowed_scopes = json.loads(client.allowed_scopes)
            requested = set(requested_scope.split())
            allowed = set(allowed_scopes)
            return requested.issubset(allowed)
        except Exception as e:
            logger.warning(
                "oauth verify_scope failed client_id=%s err=%s",
                getattr(client, "client_id", None), e,
            )
            return False

    @staticmethod
    def create_authorization_code(
        db: Session,
        client: Client,
        user: User,
        redirect_uri: str,
        scope: str,
        code_challenge: Optional[str] = None,
        code_challenge_method: Optional[str] = None,
        nonce: Optional[str] = None,
    ) -> str:
        """Create an authorization code.

        code_challenge/code_challenge_method: PKCE(RFC 7636),公开客户端防授权码拦截。
        nonce: OIDC 请求透传,签发 id_token 时回填(防重放)。
        """
        # Generate code
        code = generate_random_string(32)

        # Store code in database
        expires_at = utcnow() + timedelta(minutes=10)  # 10 minutes
        token = Token(
            token_hash=hash_token(code),
            type='authorization_code',
            user_id=user.id,
            client_id=client.id,
            scope=scope,
            redirect_uri=redirect_uri,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method or ("S256" if code_challenge else None),
            nonce=nonce,
            expires_at=expires_at
        )
        db.add(token)

        # Update or create user authorization
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()

        if auth:
            # P2-4:scope 存并集(而非覆盖),新增 scope 才需再次同意
            existing_scopes = set(auth.scope.split()) if auth.scope else set()
            new_scopes = set(scope.split())
            auth.scope = " ".join(sorted(existing_scopes | new_scopes))
            auth.last_used_at = utcnow()
        else:
            auth = UserAuthorization(
                user_id=user.id,
                client_id=client.id,
                scope=scope
            )
            db.add(auth)

        db.commit()

        return code

    @staticmethod
    def _verify_pkce(code_verifier: Optional[str], stored_challenge: Optional[str], method: Optional[str]) -> bool:
        """校验 PKCE code_verifier。无 stored_challenge 时视为未启用 PKCE,直接通过。"""
        if not stored_challenge:
            # 客户端未在 authorize 时提供 code_challenge:对公开客户端应拒绝,
            # 对机密客户端允许(向后兼容)。调用方按 client_type 决定。
            return True
        if not code_verifier:
            return False
        if method == "S256":
            digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
            computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
            return hmac.compare_digest(computed, stored_challenge)
        elif method == "plain":
            return hmac.compare_digest(code_verifier, stored_challenge)
        return False

    @staticmethod
    def exchange_code_for_token(
        db: Session,
        code: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        code_verifier: Optional[str] = None,
    ) -> Optional[Tuple[str, str, int, Optional[str]]]:
        """Exchange authorization code for access token.

        返回 (access_token, refresh_token, expires_in, nonce) —— nonce 用于签发 id_token。
        """
        # Get client
        client = OAuthService.get_client_by_id(db, client_id)
        if not client:
            logger.info("oauth exchange_code: client not found client_id=%s", client_id)
            return None

        # 公开客户端(public)免 client_secret,但必须用 PKCE
        is_public = (getattr(client, 'client_type', 'confidential') == 'public')
        if is_public:
            if not code_verifier:
                logger.info("oauth exchange_code: public client missing code_verifier client_id=%s", client_id)
                return None
        else:
            # 机密客户端仍校验 secret
            if not verify_client_secret(client_secret, client.client_secret_hash):
                logger.info("oauth exchange_code: invalid client_secret client_id=%s", client_id)
                return None

        # Get authorization code
        code_hash = hash_token(code)
        token = db.query(Token).filter(
            Token.token_hash == code_hash,
            Token.type == 'authorization_code',
            Token.expires_at > utcnow()
        ).first()

        if not token:
            logger.info(
                "oauth exchange_code: code not found/expired client_id=%s code_hash=%s",
                client_id,
                OAuthService._short_hash(code),
            )
            return None

        # Verify redirect_uri matches
        if token.redirect_uri != redirect_uri:
            logger.info(
                "oauth exchange_code: redirect_uri mismatch client_id=%s token_redirect_uri=%s request_redirect_uri=%s",
                client_id,
                token.redirect_uri,
                redirect_uri,
            )
            return None

        # PKCE 校验(RFC 7636)
        if not OAuthService._verify_pkce(code_verifier, token.code_challenge, token.code_challenge_method):
            logger.info("oauth exchange_code: pkce verification failed client_id=%s", client_id)
            return None

        # 公开客户端必须走了 PKCE(授权码创建时有 challenge)
        if is_public and not token.code_challenge:
            logger.info("oauth exchange_code: public client code has no pkce challenge client_id=%s", client_id)
            return None

        # Get user
        user = token.user
        if not user or user.status != 'active':
            logger.info(
                "oauth exchange_code: user inactive/missing client_id=%s user_id=%s",
                client_id,
                getattr(user, "id", None),
            )
            return None

        # Create tokens
        token_data = {"sub": str(user.id), "scope": token.scope, "client_id": client_id}
        access_token = create_access_token(token_data, token_version=user.token_version)
        refresh_token = create_refresh_token(token_data)

        # Store refresh token
        access_expires = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
        refresh_expires = utcnow() + timedelta(days=settings.refresh_token_expire_days)

        refresh_token_record = Token(
            token_hash=hash_token(refresh_token),
            type='refresh',
            user_id=user.id,
            client_id=client.id,
            scope=token.scope,
            expires_at=refresh_expires
        )
        db.add(refresh_token_record)

        # Delete authorization code (one-time use)
        db.delete(token)

        # Update last_used_at for authorization
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()
        if auth:
            auth.last_used_at = utcnow()

        db.commit()

        return access_token, refresh_token, settings.access_token_expire_minutes * 60, token.nonce

    @staticmethod
    def password_grant(
        db: Session,
        username: str,
        password: str,
        client_id: str,
        client_secret: str,
        scope: str = "profile"
    ) -> Optional[Tuple[str, str, int]]:
        """Password grant type (for trusted clients only)"""
        # Get client
        client = OAuthService.get_client_by_id(db, client_id)
        if not client:
            logger.info("oauth password_grant: client not found client_id=%s", client_id)
            return None

        # Verify client secret
        if not verify_client_secret(client_secret, client.client_secret_hash):
            logger.info("oauth password_grant: invalid client_secret client_id=%s", client_id)
            return None

        # Check if client is trusted
        if not client.trusted:
            logger.info("oauth password_grant: client not trusted client_id=%s", client_id)
            return None

        # Authenticate user
        from app.services.auth_service import AuthService
        user, failure_reason = AuthService.authenticate_user(db, username, password)
        if not user:
            logger.info("oauth password_grant: invalid user credentials client_id=%s username=%s reason=%s", client_id, username, failure_reason)
            return None

        # Verify scope
        if not OAuthService.verify_scope(client, scope):
            logger.info("oauth password_grant: invalid scope client_id=%s scope=%s", client_id, scope)
            return None

        # Create tokens
        token_data = {"sub": str(user.id), "scope": scope, "client_id": client_id}
        access_token = create_access_token(token_data, token_version=user.token_version)
        refresh_token = create_refresh_token(token_data)

        # Store refresh token
        refresh_expires = utcnow() + timedelta(days=settings.refresh_token_expire_days)

        refresh_token_record = Token(
            token_hash=hash_token(refresh_token),
            type='refresh',
            user_id=user.id,
            client_id=client.id,
            scope=scope,
            expires_at=refresh_expires
        )
        db.add(refresh_token_record)

        # Create or update user authorization
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()

        if auth:
            auth.scope = scope
            auth.last_used_at = utcnow()
        else:
            auth = UserAuthorization(
                user_id=user.id,
                client_id=client.id,
                scope=scope
            )
            db.add(auth)

        db.commit()

        return access_token, refresh_token, settings.access_token_expire_minutes * 60

    @staticmethod
    def refresh_token_grant(
        db: Session,
        refresh_token: str,
        client_id: str,
        client_secret: str
    ) -> Optional[Tuple[str, str, int]]:
        """Refresh token grant type"""
        # Get client
        client = OAuthService.get_client_by_id(db, client_id)
        if not client:
            logger.info("oauth refresh_token: client not found client_id=%s", client_id)
            return None

        # Verify client secret
        if not verify_client_secret(client_secret, client.client_secret_hash):
            logger.info("oauth refresh_token: invalid client_secret client_id=%s", client_id)
            return None

        # Verify refresh token
        token_hash_value = hash_token(refresh_token)
        token = db.query(Token).filter(
            Token.token_hash == token_hash_value,
            Token.type == 'refresh',
            Token.client_id == client.id,
            Token.expires_at > utcnow()
        ).first()

        if not token:
            logger.info(
                "oauth refresh_token: token not found/expired client_id=%s token_hash=%s",
                client_id,
                OAuthService._short_hash(refresh_token),
            )
            return None

        # Get user
        user = token.user
        if not user or user.status != 'active':
            logger.info(
                "oauth refresh_token: user inactive/missing client_id=%s user_id=%s",
                client_id,
                getattr(user, "id", None),
            )
            return None

        # Create new tokens
        token_data = {"sub": str(user.id), "scope": token.scope, "client_id": client_id}
        new_access_token = create_access_token(token_data, token_version=user.token_version)
        new_refresh_token = create_refresh_token(token_data)

        # Update refresh token
        refresh_expires = utcnow() + timedelta(days=settings.refresh_token_expire_days)
        token.token_hash = hash_token(new_refresh_token)
        token.expires_at = refresh_expires

        db.commit()

        return new_access_token, new_refresh_token, settings.access_token_expire_minutes * 60

    @staticmethod
    def get_user_from_token(db: Session, access_token: str) -> Optional[User]:
        """Get user from access token"""
        payload = decode_token(access_token)
        if not payload or payload.get("type") != "access":
            return None

        user_id = payload.get("sub")
        if not user_id:
            return None

        user = db.query(User).filter(User.id == user_id, User.status == 'active').first()
        return user

    @staticmethod
    def has_user_authorized_client(db: Session, user_id: int, client_id: int) -> bool:
        """Check if user has already authorized a client"""
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user_id,
            UserAuthorization.client_id == client_id
        ).first()
        return auth is not None

    @staticmethod
    def needs_consent(db: Session, user: User, client: Client, requested_scope: str) -> bool:
        """P2-4:判断是否需要再次征得用户同意。

        仅当请求 scope 是已授权 scope 的子集时,才视为已充分授权、跳过同意。
        新增 scope(超出已授权范围)→ 需要同意(避免静默 scope 升级)。
        从未授权过 → 需要同意。
        """
        if client.trusted:
            return False
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()
        if not auth:
            return True
        existing = set(auth.scope.split()) if auth.scope else set()
        requested = set(requested_scope.split())
        return not requested.issubset(existing)
