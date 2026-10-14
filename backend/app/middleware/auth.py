from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.utils.security import decode_token

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user from JWT token"""
    token = credentials.credentials
    payload = decode_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify token type
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: int = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Convert sub from string to int
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != 'active':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is not active"
        )

    # 校验 token_version:改密/封禁后 tv 不匹配则拒绝(使旧 access token 立即失效)
    if payload.get("tv", 0) != user.token_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Get current user if authenticated, otherwise return None.

    Checks both Authorization header and session cookie for token.
    """
    # First try Authorization header
    auth_header = request.headers.get("Authorization")
    token = None

    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "")
    else:
        # Fall back to the authorize cookie (HttpOnly, Path=/api/oauth, TTL=access token).
        # 旧名 session_token 的兼容回退已删除:该 cookie 是 JS 可写的,
        # 且全站已无写入方(A2 迁移完成),继续回退等于开放凭据注入面。
        # 注意:This function is only mounted on the OAuth authorize endpoints,
        # do NOT use cookies for business endpoints (get_current_user is always Bearer-only).
        token = request.cookies.get("authorize_token")

    if not token:
        return None

    payload = decode_token(token)

    if payload is None or payload.get("type") != "access":
        return None

    user_id: int = payload.get("sub")
    if user_id is None:
        return None

    # Convert sub from string to int
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        return None

    user = db.query(User).filter(User.id == user_id, User.status == 'active').first()
    if user is None:
        return None

    # 校验 token_version:改密/封禁后 tv 不匹配则拒绝
    # (与 get_current_user 一致,防止 OAuth authorize 旁路使用已吊销 token)
    if payload.get("tv", 0) != user.token_version:
        return None

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Require user to be an admin"""
    if not (
        current_user.has_role('admin') or
        current_user.has_permission('admin.*')
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return current_user
