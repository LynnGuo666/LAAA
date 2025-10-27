from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.schemas import (
    UserResponse,
    UserUpdate,
    AuthorizationListItem,
    SessionResponse
)
from app.middleware.auth import get_current_user
from app.models import User, UserAuthorization, Session as SessionModel
from datetime import datetime

router = APIRouter(prefix="/api/user", tags=["User Management"])


@router.get("/me", response_model=UserResponse)
async def get_profile(current_user: User = Depends(get_current_user)):
    """Get current user profile"""
    return current_user


@router.put("/me", response_model=UserResponse)
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

    return current_user


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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of active sessions (remembered devices)"""
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
            is_current=False  # TODO: detect current session
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
