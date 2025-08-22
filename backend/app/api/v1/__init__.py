from fastapi import APIRouter
from . import auth, oauth, admin

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(oauth.router, prefix="/oauth", tags=["oauth"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])