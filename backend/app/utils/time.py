"""时区安全的 UTC 时间 helper。

替代已弃用的 ``datetime.utcnow()``。返回 naive UTC datetime,与现有 SQLite/SQLAlchemy
存取的 naive 语义保持一致——避免 ``datetime > expires_at`` 等比较因 aware/naive 混用抛
``TypeError``。
"""
from datetime import datetime, timezone


def utcnow() -> datetime:
    """返回 naive UTC datetime(等价于旧的 datetime.utcnow())。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)
