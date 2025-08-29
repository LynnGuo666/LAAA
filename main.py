from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import settings
from app.core.database import Base, engine
from app.api.v1 import router as api_router
from app.api.v1.oauth import router as oauth_router
from app.api.v1.permissions import router as permissions_router
from app.api.v1.dashboard import router as dashboard_router
import logging
import os

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 创建数据库表
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="OAuth 2.0 / OIDC Authorization Server",
    description="A complete OAuth 2.0 and OpenID Connect implementation using FastAPI",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 包含路由
app.include_router(oauth_router)
app.include_router(api_router)
app.include_router(permissions_router)
app.include_router(dashboard_router)

# 静态文件服务
static_dir = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    
    @app.get("/login")
    async def serve_login():
        return FileResponse(os.path.join(static_dir, "login", "index.html"))
    
    @app.get("/register")
    async def serve_register():
        return FileResponse(os.path.join(static_dir, "register", "index.html"))
    
    @app.get("/authorize")
    async def serve_authorize():
        return FileResponse(os.path.join(static_dir, "authorize", "index.html"))
    
    @app.get("/callback")
    @app.post("/callback")
    async def serve_callback():
        return FileResponse(os.path.join(static_dir, "callback", "index.html"))
    
    @app.get("/permission-request")
    async def serve_permission_request():
        return FileResponse(os.path.join(static_dir, "permission-request", "index.html"))
    
    @app.get("/dashboard")
    async def serve_dashboard():
        return FileResponse(os.path.join(static_dir, "dashboard", "index.html"))
    
    @app.get("/admin/dashboard")
    async def serve_admin_dashboard():
        return FileResponse(os.path.join(static_dir, "admin", "dashboard", "index.html"))
    
    @app.get("/admin/permissions")
    async def serve_admin_permissions():
        return FileResponse(os.path.join(static_dir, "admin", "permissions", "index.html"))
    
    # 前端静态资源
    @app.get("/_next/{file_path:path}")
    async def serve_next_assets(file_path: str):
        asset_path = os.path.join(static_dir, "_next", file_path)
        if os.path.exists(asset_path):
            return FileResponse(asset_path)
        return {"error": "Not found"}, 404
    
    # 根路径服务前端
    @app.get("/")
    async def serve_frontend():
        return FileResponse(os.path.join(static_dir, "index.html"))
    
    logger.info(f"Frontend static files served from: {static_dir}")
else:
    logger.warning(f"Frontend static directory not found: {static_dir}")
    
    @app.get("/")
    async def root():
        """根端点"""
        return {
            "message": "OAuth 2.0 / OIDC Authorization Server",
            "version": "1.0.0",
            "endpoints": {
                "authorization": "/oauth/authorize",
                "token": "/oauth/token",
                "userinfo": "/oauth/userinfo",
                "jwks": "/oauth/jwks",
                "discovery": "/oauth/.well-known/openid_configuration",
                "api": "/api/v1",
                "docs": "/docs"
            }
        }


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    logger.error(f"Database error: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Database error occurred"}
    )


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)