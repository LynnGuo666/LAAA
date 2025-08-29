from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status
from app.core.config import settings
import secrets
import hashlib
import base64
import json

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class SecurityManager:
    def __init__(self):
        self.secret_key = settings.secret_key
        self.algorithm = settings.algorithm
        self.access_token_expire_minutes = settings.access_token_expire_minutes
        self.refresh_token_expire_days = settings.refresh_token_expire_days

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """验证密码"""
        return pwd_context.verify(plain_password, hashed_password)

    def get_password_hash(self, password: str) -> str:
        """生成密码哈希"""
        return pwd_context.hash(password)

    def create_access_token(self, data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
        """创建访问令牌"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=self.access_token_expire_minutes)
        
        to_encode.update({
            "exp": expire,
            "iat": datetime.utcnow(),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience
        })
        
        encoded_jwt = jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
        return encoded_jwt

    def create_refresh_token(self, data: Dict[str, Any]) -> str:
        """创建刷新令牌"""
        to_encode = data.copy()
        expire = datetime.utcnow() + timedelta(days=self.refresh_token_expire_days)
        to_encode.update({
            "exp": expire,
            "iat": datetime.utcnow(),
            "type": "refresh"
        })
        encoded_jwt = jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
        return encoded_jwt

    def create_id_token(self, user_data: Dict[str, Any], client_id: str, nonce: Optional[str] = None) -> str:
        """创建OIDC ID令牌"""
        now = datetime.utcnow()
        payload = {
            "iss": settings.jwt_issuer,
            "sub": user_data["id"],
            "aud": client_id,
            "exp": now + timedelta(hours=1),
            "iat": now,
            "auth_time": int(now.timestamp()),
        }
        
        # 添加标准OIDC claims
        oidc_claims = [
            "email", "email_verified", "given_name", "family_name", "middle_name",
            "nickname", "preferred_username", "profile", "picture", "website",
            "phone_number", "phone_number_verified", "gender", "birthdate",
            "zoneinfo", "locale", "full_name", "username"
        ]
        
        for claim in oidc_claims:
            if claim in user_data and user_data[claim] is not None:
                payload[claim] = user_data[claim]
        
        if nonce:
            payload["nonce"] = nonce
            
        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def verify_token(self, token: str) -> Dict[str, Any]:
        """验证令牌"""
        try:
            payload = jwt.decode(
                token, 
                self.secret_key, 
                algorithms=[self.algorithm],
                audience=settings.jwt_audience,
                issuer=settings.jwt_issuer
            )
            return payload
        except JWTError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            ) from e

    def generate_authorization_code(self) -> str:
        """生成授权码"""
        return secrets.token_urlsafe(32)

    def generate_client_secret(self) -> str:
        """生成客户端密钥"""
        return secrets.token_urlsafe(32)

    def generate_client_id(self, client_name: str) -> str:
        """生成客户端ID"""
        timestamp = str(int(datetime.utcnow().timestamp()))
        base_string = f"{client_name}_{timestamp}"
        return hashlib.md5(base_string.encode()).hexdigest()

    def verify_pkce(self, code_verifier: str, code_challenge: str, method: str = "S256") -> bool:
        """验证PKCE"""
        if method == "S256":
            digest = hashlib.sha256(code_verifier.encode('utf-8')).digest()
            expected_challenge = base64.urlsafe_b64encode(digest).decode('utf-8').rstrip('=')
            return expected_challenge == code_challenge
        elif method == "plain":
            return code_verifier == code_challenge
        return False

    def validate_redirect_uri(self, redirect_uri: str, registered_uris: List[str]) -> bool:
        """验证重定向URI"""
        return redirect_uri in registered_uris

    def parse_scope(self, scope_string: str) -> List[str]:
        """解析作用域"""
        return scope_string.split() if scope_string else []

    def get_jwks(self) -> Dict[str, Any]:
        """获取JSON Web Key Set (用于ID Token验证)"""
        # 这里简化处理，在生产环境中应该使用RSA密钥对
        return {
            "keys": [
                {
                    "kty": "oct",
                    "use": "sig",
                    "kid": "1",
                    "alg": self.algorithm,
                    "k": base64.urlsafe_b64encode(self.secret_key.encode()).decode().rstrip('=')
                }
            ]
        }


security = SecurityManager()