from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import (
    UserCreate,
    UserResponse,
    UserMeResponse,
    LoginRequest,
    TokenResponse,
    RefreshTokenRequest
)
from app.services.auth_service import AuthService
from app.middleware.auth import get_current_user
from app.models import User
from app.config import get_settings

settings = get_settings()
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user"""
    try:
        user = AuthService.register_user(
            db,
            username=user_data.username,
            email=user_data.email,
            password=user_data.password,
            invite_code=getattr(user_data, "invite_code", None),
        )
        return user
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/login", response_model=TokenResponse)
async def login(
    login_data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Login and get access token"""
    # Authenticate user
    user = AuthService.authenticate_user(db, login_data.username, login_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )

    # Get client info
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")

    # Create tokens (use a default internal client_id for direct login)
    access_token, refresh_token = AuthService.create_tokens(
        db,
        user=user,
        client_id="internal",
        scope="profile email",
        remember_me=login_data.remember_me,
        device_name=login_data.device_name,
        ip_address=client_ip,
        user_agent=user_agent
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(refresh_data: RefreshTokenRequest, db: Session = Depends(get_db)):
    """Refresh access token"""
    result = AuthService.refresh_access_token(
        db,
        refresh_data.refresh_token,
        client_id=refresh_data.client_id,
        client_secret=refresh_data.client_secret
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )

    access_token, refresh_token = result

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60
    )


@router.post("/logout")
async def logout(
    refresh_data: RefreshTokenRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout user"""
    AuthService.logout(db, refresh_data.refresh_token)
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserMeResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current user information"""
    permissions = sorted({p.code for r in current_user.roles for p in r.permissions})
    roles = sorted({r.name for r in current_user.roles})
    groups = sorted({g.name for g in current_user.groups})

    return UserMeResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        avatar=current_user.avatar,
        status=current_user.status,
        created_at=current_user.created_at,
        groups=groups,
        roles=roles,
        permissions=permissions,
        is_admin=current_user.has_permission("admin.*") or current_user.has_role("admin"),
    )
