from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import settings
from app.core.database import Base, engine
from app.api.v1 import router as api_router
from app.api.v1.oauth import router as oauth_router
import logging

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


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    logger.error(f"Database error: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Database error occurred"}
    )


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


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)