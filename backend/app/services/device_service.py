"""已知设备(设备信任记忆)管理。

与 sessions 的分工:
- sessions 表示"当前在线的会话",登出/撤销/过期即消失;
- known_devices 表示"这台设备以前登录过",用于风控判定 NEW_DEVICE。

策略(见 ADR-0002):
- 普通登出:保留记忆。否则单设备用户每次登出都会被判新设备、反复强制验证。
- 主动撤销 / 管理员强退 / 安全事件(refresh token 重放):立即遗忘。
  否则被盗设备会永远保持"已知"身份,重新登录不再触发新设备风控。
- 并发超限自动踢人:保留记忆。只是腾会话名额,不代表设备失宠。
- 长期未活跃:由 maintenance 按 KNOWN_DEVICE_RETENTION_DAYS(默认 180 天)清理。
"""
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from app.models import KnownDevice


def list_devices(db: Session, user_id: int) -> List[KnownDevice]:
    """列出用户的已知设备,最近活跃的在前。"""
    return (
        db.query(KnownDevice)
        .filter(KnownDevice.user_id == user_id)
        .order_by(KnownDevice.last_seen.desc())
        .all()
    )


def forget_device(
    db: Session,
    user_id: int,
    device_token: Optional[str],
    commit: bool = True,
) -> int:
    """遗忘单个设备(按客户端上报的 device_token)。返回删除行数。"""
    if not device_token:
        return 0

    deleted = (
        db.query(KnownDevice)
        .filter(
            KnownDevice.user_id == user_id,
            KnownDevice.device_token == device_token,
        )
        .delete(synchronize_session=False)
    )
    if commit:
        db.commit()
    return deleted


def forget_devices_for_sessions(
    db: Session,
    user_id: int,
    sessions: Iterable[object],
    commit: bool = True,
) -> int:
    """遗忘给定 session 列表对应的设备。

    用于"撤销会话/强制下线"：session 对象需带 device_token 属性。
    没有 device_token 的旧会话(迁移前的存量数据)直接跳过。
    """
    tokens = {
        getattr(session, "device_token", None)
        for session in sessions
    }
    tokens.discard(None)
    if not tokens:
        return 0

    deleted = (
        db.query(KnownDevice)
        .filter(
            KnownDevice.user_id == user_id,
            KnownDevice.device_token.in_(tokens),
        )
        .delete(synchronize_session=False)
    )
    if commit:
        db.commit()
    return deleted


def forget_all_devices(
    db: Session,
    user_id: int,
    keep_token: Optional[str] = None,
    commit: bool = True,
) -> int:
    """遗忘用户全部设备,可保留当前设备(keep_token)。

    改密属于安全动作,但保留当前设备可避免"改完密码立刻被锁在验证页"
    (尤其 SMTP 未配置、用户又没有 TOTP 的环境)。
    """
    query = db.query(KnownDevice).filter(KnownDevice.user_id == user_id)
    if keep_token:
        query = query.filter(KnownDevice.device_token != keep_token)
    deleted = query.delete(synchronize_session=False)
    if commit:
        db.commit()
    return deleted
