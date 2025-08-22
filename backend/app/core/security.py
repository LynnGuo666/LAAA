from datetime import datetime, timedelta
from typing import Any, Union, Optional
from passlib.context import CryptContext
from jose import jwt
import pyotp
import qrcode
from io import BytesIO
import base64
import secrets
import string
from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_access_token(subject: Union[str, Any], expires_delta: timedelta = None) -> str:
    """创建访问令牌"""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token(subject: Union[str, Any]) -> str:
    """创建刷新令牌"""
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {"exp": expire, "sub": str(subject), "type": "refresh"}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """生成密码哈希"""
    return pwd_context.hash(password)


def generate_totp_secret() -> str:
    """生成TOTP密钥"""
    return pyotp.random_base32()


def generate_totp_qr_code(secret: str, email: str, issuer: str = None) -> str:
    """生成TOTP二维码"""
    if not issuer:
        issuer = settings.TOTP_ISSUER
    
    totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
        name=email,
        issuer_name=issuer
    )
    
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    
    return base64.b64encode(buffer.getvalue()).decode()


def verify_totp(secret: str, token: str) -> bool:
    """验证TOTP令牌"""
    totp = pyotp.TOTP(secret)
    return totp.verify(token, valid_window=1)


def generate_verification_code(length: int = 6) -> str:
    """生成验证码"""
    return ''.join(secrets.choice(string.digits) for _ in range(length))


def generate_invitation_code(length: int = None) -> str:
    """生成邀请码"""
    if not length:
        length = settings.INVITATION_CODE_LENGTH
    
    alphabet = string.ascii_uppercase + string.digits
    # 移除容易混淆的字符
    alphabet = alphabet.replace('0', '').replace('O', '').replace('1', '').replace('I', '').replace('L', '')
    
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def generate_backup_codes(count: int = 10) -> list:
    """生成备用验证码"""
    return [generate_verification_code(8) for _ in range(count)]


def hash_backup_codes(codes: list) -> list:
    """哈希备用验证码"""
    return [get_password_hash(code) for code in codes]


def verify_backup_code(code: str, hashed_codes: list) -> bool:
    """验证备用验证码"""
    for hashed_code in hashed_codes:
        if verify_password(code, hashed_code):
            return True
    return False