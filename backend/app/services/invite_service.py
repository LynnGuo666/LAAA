from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models import InviteCode, Group
import secrets
import string


class InviteService:
    @staticmethod
    def normalize_code(code: str) -> str:
        return (code or "").strip().upper()

    @staticmethod
    def generate_code(length: int = 12) -> str:
        alphabet = string.ascii_uppercase + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(length))

    @staticmethod
    def create_invite(
        db: Session,
        *,
        group_id: int,
        created_by_user_id: Optional[int] = None,
        expires_at: Optional[datetime] = None,
        max_uses: Optional[int] = None,
        note: Optional[str] = None,
    ) -> InviteCode:
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            raise ValueError("用户组不存在")
        if max_uses is not None and max_uses < 1:
            raise ValueError("使用次数必须为正整数，或留空表示不限制")

        invite: Optional[InviteCode] = None
        last_error: Optional[Exception] = None
        for _ in range(12):
            code = InviteService.generate_code()
            invite = InviteCode(
                code=code,
                group_id=group_id,
                created_by_user_id=created_by_user_id,
                expires_at=expires_at,
                max_uses=max_uses,
                used_count=0,
                note=note,
                is_active=True,
            )
            db.add(invite)
            try:
                db.commit()
                db.refresh(invite)
                return invite
            except IntegrityError as e:
                db.rollback()
                last_error = e
                invite = None

        raise RuntimeError("生成邀请码失败，请重试") from last_error

    @staticmethod
    def get_redeemable_invite(db: Session, code: str) -> Optional[InviteCode]:
        normalized = InviteService.normalize_code(code)
        if not normalized:
            return None

        invite = db.query(InviteCode).filter(InviteCode.code == normalized).first()
        if not invite:
            return None
        if not invite.is_active:
            return None
        if invite.expires_at and invite.expires_at <= datetime.utcnow():
            return None
        if invite.max_uses is not None and (invite.used_count or 0) >= invite.max_uses:
            return None
        return invite

    @staticmethod
    def redeem_invite(db: Session, invite: InviteCode, *, user_id: Optional[int]) -> InviteCode:
        from app.models import InviteRedemption

        invite.used_count = (invite.used_count or 0) + 1
        invite.used_by_user_id = user_id
        invite.used_at = datetime.utcnow()
        db.add(InviteRedemption(invite_id=invite.id, user_id=user_id, used_at=invite.used_at))

        if invite.max_uses is not None and invite.used_count >= invite.max_uses:
            invite.is_active = False
        return invite
