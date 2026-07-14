from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.permission import require_permission
from app.models import User
from app.schemas.site import SiteConfigResponse, SiteConfigUpdate
from app.services.site_service import SiteService

router = APIRouter(prefix="/api/site", tags=["Site"])


@router.get("", response_model=SiteConfigResponse)
def get_site_config(db: Session = Depends(get_db)):
    return SiteConfigResponse(site_name=SiteService.get_site_name(db))


@router.put("", response_model=SiteConfigResponse)
def update_site_config(
    payload: SiteConfigUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("admin.users")),
):
    try:
        name = SiteService.set_site_name(db, payload.site_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SiteConfigResponse(site_name=name)

