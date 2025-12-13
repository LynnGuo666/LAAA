from pydantic import BaseModel, Field


class SiteConfigResponse(BaseModel):
    site_name: str


class SiteConfigUpdate(BaseModel):
    site_name: str = Field(..., min_length=1, max_length=60)

