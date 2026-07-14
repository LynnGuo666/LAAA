from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import SystemSetting


class SiteService:
    SITE_NAME_KEY = "site_name"

    @staticmethod
    def get_site_name(db: Session) -> str:
        settings = get_settings()
        row = db.query(SystemSetting).filter(SystemSetting.key == SiteService.SITE_NAME_KEY).first()
        value = row.value.strip() if row and row.value else ""
        return value or settings.app_name

    @staticmethod
    def set_site_name(db: Session, site_name: str) -> str:
        normalized = (site_name or "").strip()
        if not normalized:
            raise ValueError("站点名称不能为空")

        row = db.query(SystemSetting).filter(SystemSetting.key == SiteService.SITE_NAME_KEY).first()
        if row:
            row.value = normalized
        else:
            row = SystemSetting(key=SiteService.SITE_NAME_KEY, value=normalized)
            db.add(row)
        db.commit()
        db.refresh(row)
        return row.value

