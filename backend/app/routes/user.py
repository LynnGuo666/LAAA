from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.schemas import (
    UserMeResponse,
    UserUpdate,
    AuthorizationListItem,
    SessionResponse
)
from app.middleware.auth import get_current_user
from app.models import User, UserAuthorization, Session as SessionModel
from app.utils.device import generate_device_id
from datetime import datetime

router = APIRouter(prefix="/api/user", tags=["User Management"])


@router.get("/me", response_model=UserMeResponse)
async def get_profile(current_user: User = Depends(get_current_user)):
    """Get current user profile"""
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


@router.put("/me", response_model=UserMeResponse)
async def update_profile(
    user_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user profile"""
    if user_data.email:
        # Check if email is already taken
        existing = db.query(User).filter(
            User.email == user_data.email,
            User.id != current_user.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already taken")
        current_user.email = user_data.email

    if user_data.avatar is not None:
        current_user.avatar = user_data.avatar

    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)

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


@router.get("/authorizations", response_model=List[AuthorizationListItem])
async def get_authorizations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of authorized applications"""
    authorizations = db.query(UserAuthorization).filter(
        UserAuthorization.user_id == current_user.id
    ).all()

    result = []
    for auth in authorizations:
        result.append(AuthorizationListItem(
            id=auth.id,
            client_name=auth.client.name,
            client_logo=auth.client.logo,
            scope=auth.scope,
            created_at=auth.created_at,
            last_used_at=auth.last_used_at
        ))

    return result


@router.delete("/authorizations/{auth_id}")
async def revoke_authorization(
    auth_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke authorization for an application"""
    auth = db.query(UserAuthorization).filter(
        UserAuthorization.id == auth_id,
        UserAuthorization.user_id == current_user.id
    ).first()

    if not auth:
        raise HTTPException(status_code=404, detail="Authorization not found")

    # Also delete related tokens
    from app.models import Token
    db.query(Token).filter(
        Token.user_id == current_user.id,
        Token.client_id == auth.client_id
    ).delete()

    db.delete(auth)
    db.commit()

    return {"message": "Authorization revoked"}


@router.get("/sessions", response_model=List[SessionResponse])
async def get_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of active sessions (remembered devices)"""
    user_agent = request.headers.get("user-agent", "") or "unknown"
    client_ip = request.client.host if request.client else "unknown"
    current_device_id = generate_device_id(current_user.id, user_agent, client_ip)

    sessions = db.query(SessionModel).filter(
        SessionModel.user_id == current_user.id,
        SessionModel.expires_at > datetime.utcnow()
    ).order_by(SessionModel.last_active.desc()).all()

    result = []
    for session in sessions:
        result.append(SessionResponse(
            id=session.id,
            device_id=session.device_id,
            device_name=session.device_name,
            device_type=session.device_type,
            ip_address=session.ip_address,
            last_active=session.last_active,
            expires_at=session.expires_at,
            is_current=session.device_id == current_device_id
        ))

    return result


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke a session (forget a device)"""
    session = db.query(SessionModel).filter(
        SessionModel.id == session_id,
        SessionModel.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Also delete related refresh token
    from app.models import Token
    db.query(Token).filter(
        Token.token_hash == session.refresh_token_hash
    ).delete()

    db.delete(session)
    db.commit()

    return {"message": "Session revoked"}
