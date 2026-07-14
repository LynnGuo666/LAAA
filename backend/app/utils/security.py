import base64
import hashlib
import hmac
import logging
import secrets
from datetime import timedelta
from typing import Any, Dict, Optional

import bcrypt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import JWTError, jwt

from app.config import get_settings
from app.utils.time import utcnow

settings = get_settings()
logger = logging.getLogger("uvicorn.error")


# ---------------------------------------------------------------------------
# JWT 签名密钥管理
#
# access token / id token 使用 RS256 非对称签名:私钥签发(不离开服务端),
# 公钥经 /.well-known/jwks.json 暴露给 RP 验证。refresh token 仍用对称
# secret_key(它走 hash 查库验证,从不对外暴露,无需迁移)。
#
# 支持多代密钥(kid 索引):当前 kid 用于签发,池中所有公钥用于验证,
# 便于密钥轮换期间旧 token 仍能验过。
# ---------------------------------------------------------------------------
class KeyStore:
    def __init__(self) -> None:
        self.keys: Dict[str, tuple] = {}  # kid -> (priv_or_None, pub)
        self.current_kid: Optional[str] = None

    @staticmethod
    def _kid(pub) -> str:
        der = pub.public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return hashlib.sha256(der).hexdigest()[:16]

    @staticmethod
    def _b64uint(n: int) -> str:
        b = n.to_bytes((n.bit_length() + 7) // 8 or 1, "big")
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")

    def load(
        self,
        private_key_path: str,
        public_key_path: str,
        explicit_kid: Optional[str] = None,
    ) -> None:
        """加载私钥(签发)+ 公钥(验证)。无私钥路径时只加载公钥(仅验证模式)。"""
        if public_key_path:
            pub = serialization.load_pem_public_key(open(public_key_path, "rb").read())
            kid = explicit_kid or self._kid(pub)
            self.keys[kid] = (None, pub)

        if private_key_path:
            priv = serialization.load_pem_private_key(
                open(private_key_path, "rb").read(), password=None
            )
            pub = priv.public_key()
            kid = explicit_kid or self._kid(pub)
            self.keys[kid] = (priv, pub)
            self.current_kid = kid
            logger.info("JWT signing key loaded kid=%s", kid)

    def ensure_loaded(self) -> None:
        """若尚未加载(且配置了密钥路径),加载之。"""
        if self.keys:
            return
        if settings.jwt_private_key_path or settings.jwt_public_key_path:
            self.load(
                settings.jwt_private_key_path,
                settings.jwt_public_key_path,
                settings.jwt_key_id or None,
            )

    @property
    def is_configured(self) -> bool:
        return self.current_kid is not None

    def signing_key(self) -> tuple:
        """返回 (private_key, kid) 用于签发。"""
        self.ensure_loaded()
        if not self.current_kid:
            raise RuntimeError("JWT RS256 密钥未配置:请设置 JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH")
        return self.keys[self.current_kid][0], self.current_kid

    def verifying_key(self, kid: Optional[str]):
        """按 kid 取公钥验证;kid 不匹配则返回 None。"""
        self.ensure_loaded()
        if not kid:
            # 兼容无 kid 的旧 token:单密钥时回退
            if len(self.keys) == 1:
                return next(iter(self.keys.values()))[1]
            return None
        entry = self.keys.get(kid)
        return entry[1] if entry else None

    def public_jwks(self) -> Dict[str, Any]:
        self.ensure_loaded()
        keys = []
        for kid, (_, pub) in self.keys.items():
            nums = pub.public_numbers()
            keys.append({
                "kty": "RSA",
                "use": "sig",
                "alg": settings.jwt_algorithm,
                "kid": kid,
                "n": self._b64uint(nums.n),
                "e": self._b64uint(nums.e),
            })
        return {"keys": keys}


keystore = KeyStore()


def generate_rsa_keypair(private_path: str, public_path: str) -> None:
    """生成 RSA-2048 密钥对并写文件(开发/部署初始化用)。"""
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    open(private_path, "wb").write(
        priv.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    pub = priv.public_key()
    open(public_path, "wb").write(
        pub.public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash"""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def get_password_hash(password: str) -> str:
    """Hash a password"""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


# ---------------------------------------------------------------------------
# Token creation (access/id → RS256; refresh → HS256 symmetric)
# ---------------------------------------------------------------------------
def _sign_asymmetric(to_encode: dict) -> str:
    priv, kid = keystore.signing_key()
    to_encode = {**to_encode}
    return jwt.encode(to_encode, priv, algorithm=settings.jwt_algorithm, headers={"kid": kid})


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, token_version: int = 0) -> str:
    """Create a JWT access token (RS256).

    token_version 写入 tv claim;改密/封禁时用户 token_version+1,使旧 token 验证失败。
    """
    to_encode = data.copy()
    if expires_delta:
        expire = utcnow() + expires_delta
    else:
        expire = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire, "type": "access", "tv": token_version})
    return _sign_asymmetric(to_encode)


def create_refresh_token(data: dict, remember_me: bool = False) -> str:
    """Create a JWT refresh token (HS256, symmetric — never exposed for verification)."""
    to_encode = data.copy()
    to_encode.update({"jti": secrets.token_urlsafe(16)})  # avoid collisions across rapid refreshes
    if remember_me:
        expire = utcnow() + timedelta(days=settings.refresh_token_remember_me_days)
    else:
        expire = utcnow() + timedelta(days=settings.refresh_token_expire_days)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


def create_id_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create an OpenID Connect ID Token (RS256)."""
    to_encode = data.copy()
    now = utcnow()
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire, "iat": now, "type": "id"})
    return _sign_asymmetric(to_encode)


def get_jwks() -> Dict[str, Any]:
    """Return JWKS with RSA public keys only (no secret material)."""
    if not keystore.is_configured:
        # RS256 未配置时返回空(止血语义),不泄露任何对称密钥
        return {"keys": []}
    return keystore.public_jwks()


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and verify a JWT token.

    access/id token: RS256(按 header kid 取公钥)。
    refresh token: HS256(secret_key)。
    """
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError:
        return None

    alg = unverified_header.get("alg")
    kid = unverified_header.get("kid")

    if alg == "RS256":
        pub = keystore.verifying_key(kid)
        if pub is None:
            return None
        try:
            return jwt.decode(token, pub, algorithms=["RS256"])
        except JWTError:
            return None
    elif alg == "HS256":
        try:
            return jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        except JWTError:
            return None
    return None


def generate_random_string(length: int = 32) -> str:
    """Generate a random string for client_id, client_secret, etc."""
    return secrets.token_urlsafe(length)


def hash_token(token: str) -> str:
    """Hash a token for storage (using SHA-256)"""
    return hashlib.sha256(token.encode()).hexdigest()


def verify_client_secret(plain_secret: str, hashed_secret: str) -> bool:
    """Verify a client secret against a hash (constant-time comparison)."""
    return hmac.compare_digest(hash_token(plain_secret), hashed_secret)


# Alias kept for backward compatibility (some call sites use hash_password).
hash_password = get_password_hash
