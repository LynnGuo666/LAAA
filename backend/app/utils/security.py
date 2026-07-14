import bcrypt
from jose import JWTError, jwt
from datetime import timedelta
from typing import Optional, Dict, Any
from app.config import get_settings
from app.utils.time import utcnow
import secrets
import hashlib
import base64
import hmac

settings = get_settings()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash"""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def get_password_hash(password: str) -> str:
    """Hash a password"""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = utcnow() + expires_delta
    else:
        expire = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)

    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt


def create_refresh_token(data: dict, remember_me: bool = False) -> str:
    """Create a JWT refresh token"""
    to_encode = data.copy()
    # Add unique ID to avoid collisions across rapid refreshes
    to_encode.update({"jti": secrets.token_urlsafe(16)})
    if remember_me:
        expire = utcnow() + timedelta(days=settings.refresh_token_remember_me_days)
    else:
        expire = utcnow() + timedelta(days=settings.refresh_token_expire_days)

    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt


def create_id_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create an OpenID Connect ID Token (JWT)"""
    to_encode = data.copy()
    now = utcnow()
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire, "iat": now, "type": "id"})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt


def get_jwks() -> Dict[str, Any]:
    """Return JWKS for current signing key (HS* via oct key)."""
    secret_bytes = settings.secret_key.encode("utf-8")
    k = base64.urlsafe_b64encode(secret_bytes).rstrip(b"=").decode("ascii")
    kid = hashlib.sha256(secret_bytes).hexdigest()[:16]
    return {
        "keys": [
            {
                "kty": "oct",
                "use": "sig",
                "alg": settings.algorithm,
                "kid": kid,
                "k": k,
            }
        ]
    }


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and verify a JWT token"""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return payload
    except JWTError:
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
