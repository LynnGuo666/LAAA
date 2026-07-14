import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import admin, groups, invites
from app.config import get_settings
from app.database import get_db, init_db
from app.middleware.auth import get_current_user
from app.middleware.observability import RequestIdMiddleware, configure_logging
from app.middleware.ratelimit import limiter
from app.models import User
from app.routes import auth, client, oauth, oidc, passkey, site, totp, user
from app.utils.security import keystore

settings = get_settings()
configure_logging()
logger = logging.getLogger("uvicorn.error")


# 生命周期:替代已弃用的 @app.on_event("startup")。
# startup 初始化 DB schema + 加载 RS256 签名密钥;shutdown 预留资源清理(目前无)。
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # 加载 RS256 密钥(若配置了路径);未配置则 access/id token 签发时会 fail
    keystore.ensure_loaded()
    if not keystore.is_configured:
        logger.warning(
            "startup: JWT RS256 keys not configured (JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH) "
            "— access/id token issuance will fail"
        )
    logger.info("startup: db initialized debug=%s", settings.debug)
    logger.info("docs: http://localhost:%s/api/docs", settings.port)
    yield
    logger.info("shutdown: cleaning up")


# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    description="Personal OAuth 2.0 Authorization Server",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

# Rate limiting (slowapi)
app.state.limiter = limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# request_id 中间件:每个请求注入 X-Request-ID,贯穿日志便于排障
app.add_middleware(RequestIdMiddleware)

@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError):
    # exc.errors() 的 ctx 里可能含 ValueError 等不可 JSON 序列化的对象,转成 str 再返回
    safe_errors = []
    for err in exc.errors():
        e = dict(err)
        ctx = e.get("ctx")
        if ctx and "error" in ctx:
            e["ctx"] = {k: (str(v) if k == "error" else v) for k, v in ctx.items()}
        safe_errors.append(e)
    logger.warning("validation error path=%s errors=%s", request.url.path, safe_errors)
    return JSONResponse(status_code=422, content={"detail": safe_errors})


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code >= 400:
        logger.warning("http error path=%s status=%s detail=%s", request.url.path, exc.status_code, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(oauth.router)
app.include_router(user.router)
app.include_router(client.router)
app.include_router(oidc.router)
app.include_router(site.router)
app.include_router(passkey.router)
app.include_router(totp.router)
app.include_router(groups.router, prefix="/api/groups", tags=["groups"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(invites.router, prefix="/api/admin/invites", tags=["admin"])

def require_docs_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.has_role("admin") or current_user.has_permission("admin.*"):
        return current_user
    raise HTTPException(status_code=404, detail="Not found")


@app.get("/api/openapi.json", include_in_schema=False)
def openapi_json(_: User = Depends(require_docs_admin)):
    return app.openapi()


@app.get("/api/docs", include_in_schema=False)
def swagger_ui(_: User = Depends(require_docs_admin)):
    return get_swagger_ui_html(
        openapi_url="/api/openapi.json",
        title=f"{settings.app_name} - API Docs",
    )


@app.get("/api/redoc", include_in_schema=False)
def redoc(_: User = Depends(require_docs_admin)):
    return get_redoc_html(
        openapi_url="/api/openapi.json",
        title=f"{settings.app_name} - API Docs",
    )


# Health check —— liveness(进程存活,轻量)
@app.get("/api/health")
async def health_check():
    """Liveness probe:进程能响应即 ok(不检查依赖)。"""
    return {"status": "ok"}


@app.get("/api/ready")
async def readiness_check(db: Session = Depends(get_db)):
    """Readiness probe:深度检查——DB 可读。失败返回 503。

    compose healthcheck 应打此端点,避免 DB 不可用时容器仍报 healthy(假活)。
    GeoIP/SMTP 为非关键依赖(降级可用),不阻塞 ready。
    """
    checks = {"database": "ok"}
    http_status = 200
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
    except Exception as e:
        checks["database"] = f"fail: {e}"
        http_status = 503
    return JSONResponse(status_code=http_status, content={"status": "ready" if http_status == 200 else "not_ready", "checks": checks})


# Serve Next.js static files
# This will be configured after frontend is built.
# Allow override via STATIC_DIR env var.
static_dir = settings.static_dir or os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "out"
)
static_dir = os.path.abspath(static_dir)
if os.path.exists(static_dir):
    # Mount static files (for _next, images, etc.)
    app.mount("/_next", StaticFiles(directory=os.path.join(static_dir, "_next")), name="next-static")

    # Serve index.html for all non-API routes (SPA routing)
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Don't serve frontend for API routes
        if full_path.startswith("api/"):
            return {"error": "Not found"}

        # Root path
        if full_path == "" or full_path == "/":
            index_path = os.path.join(static_dir, "index.html")
            if os.path.isfile(index_path):
                return FileResponse(index_path)

        # Try to serve the exact file first
        file_path = os.path.join(static_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)

        # Try with /index.html for directories (Next.js static export pattern)
        dir_index = os.path.join(static_dir, full_path, "index.html")
        if os.path.isfile(dir_index):
            return FileResponse(dir_index)

        # Try with .html extension
        html_path = os.path.join(static_dir, full_path + ".html")
        if os.path.isfile(html_path):
            return FileResponse(html_path)

        # Remove trailing slash and try again
        if full_path.endswith("/"):
            no_slash = full_path.rstrip("/")
            html_path = os.path.join(static_dir, no_slash + ".html")
            if os.path.isfile(html_path):
                return FileResponse(html_path)
            dir_index = os.path.join(static_dir, no_slash, "index.html")
            if os.path.isfile(dir_index):
                return FileResponse(dir_index)

        # Fallback to index.html for client-side routing
        index_path = os.path.join(static_dir, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)

        return {"error": "Not found"}


# Initialize database + load JWT signing keys on startup
# (moved into lifespan() above)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level="debug" if settings.debug else "info",
        access_log=True,
    )
