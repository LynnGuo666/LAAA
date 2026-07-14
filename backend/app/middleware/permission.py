from fastapi import Depends, HTTPException, status

from app.middleware.auth import get_current_user
from app.models import User


def require_permission(permission_code: str):
    """Decorator to require a specific permission"""
    def permission_checker(current_user: User = Depends(get_current_user)) -> User:
        if not current_user.has_permission(permission_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission '{permission_code}' required"
            )
        return current_user
    return permission_checker
