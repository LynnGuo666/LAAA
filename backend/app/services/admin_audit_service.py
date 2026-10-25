"""管理员操作审计服务。

只负责把审计行加入当前事务,不 commit——由调用方与业务变更一起提交,
保证「操作成功才留痕、操作回滚则审计也回滚」。
"""
import json
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models import AdminAuditLog, User


class AdminAuditService:
    @staticmethod
    def record(
        db: Session,
        *,
        actor: User,
        action: str,
        target_type: Optional[str] = None,
        target_id: Optional[int] = None,
        target_username: Optional[str] = None,
        detail: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> AdminAuditLog:
        """在当前事务中追加一条审计记录(调用方负责 commit)。"""
        entry = AdminAuditLog(
            actor_id=actor.id,
            actor_username=actor.username,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_username=target_username,
            detail=json.dumps(detail, ensure_ascii=False, default=str) if detail else None,
            ip_address=(ip_address or "")[:50] or None,
            user_agent=(user_agent or "")[:2000] or None,
        )
        db.add(entry)
        return entry
