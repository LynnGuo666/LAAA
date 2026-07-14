from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.permission import require_permission
from app.models import InviteCode, User
from app.schemas.invite import InviteCodeCreate, InviteCodeResponse, InviteCodeUpdate
from app.services.invite_service import InviteService

router = APIRouter()


@router.get("/", response_model=List[InviteCodeResponse])
def list_invite_codes(
    skip: int = 0,
    limit: int = 100,
    active: Optional[bool] = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("admin.users")),
):
    query = db.query(InviteCode)
    if active is not None:
        query = query.filter(InviteCode.is_active == active)

    invites = (
        query.order_by(InviteCode.id.desc())
        .offset(skip)
        .limit(min(limit, 500))
        .all()
    )

    result: List[InviteCodeResponse] = []
    for invite in invites:
        result.append(
            InviteCodeResponse(
                id=invite.id,
                code=invite.code,
                note=invite.note,
                group_id=invite.group_id,
                group_name=invite.group.name if invite.group else "",
                is_active=invite.is_active,
                expires_at=invite.expires_at,
                max_uses=invite.max_uses,
                used_count=invite.used_count or 0,
                created_by_user_id=invite.created_by_user_id,
                used_by_user_id=invite.used_by_user_id,
                used_at=invite.used_at,
                created_at=invite.created_at,
                updated_at=invite.updated_at,
            )
        )
    return result


@router.post("/", response_model=InviteCodeResponse, status_code=status.HTTP_201_CREATED)
def create_invite_code(
    payload: InviteCodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin.users")),
):
    try:
        invite = InviteService.create_invite(
            db,
            group_id=payload.group_id,
            created_by_user_id=current_user.id,
            expires_at=payload.expires_at,
            max_uses=payload.max_uses,
            note=payload.note,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return InviteCodeResponse(
        id=invite.id,
        code=invite.code,
        note=invite.note,
        group_id=invite.group_id,
        group_name=invite.group.name if invite.group else "",
        is_active=invite.is_active,
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        used_count=invite.used_count or 0,
        created_by_user_id=invite.created_by_user_id,
        used_by_user_id=invite.used_by_user_id,
        used_at=invite.used_at,
        created_at=invite.created_at,
        updated_at=invite.updated_at,
    )


@router.put("/{invite_id}", response_model=InviteCodeResponse)
def update_invite_code(
    invite_id: int,
    payload: InviteCodeUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("admin.users")),
):
    invite = db.query(InviteCode).filter(InviteCode.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="邀请码不存在")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(invite, field, value)

    if invite.max_uses is not None and (invite.used_count or 0) >= invite.max_uses:
        invite.is_active = False

    db.commit()
    db.refresh(invite)

    return InviteCodeResponse(
        id=invite.id,
        code=invite.code,
        note=invite.note,
        group_id=invite.group_id,
        group_name=invite.group.name if invite.group else "",
        is_active=invite.is_active,
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        used_count=invite.used_count or 0,
        created_by_user_id=invite.created_by_user_id,
        used_by_user_id=invite.used_by_user_id,
        used_at=invite.used_at,
        created_at=invite.created_at,
        updated_at=invite.updated_at,
    )
