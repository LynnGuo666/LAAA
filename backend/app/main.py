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

from app.config import get_settings
from app.database import get_db, init_db
from app.middleware.auth import get_current_user
from app.middleware.observability import RequestIdMiddleware, configure_logging
from app.middleware.ratelimit import limiter
from app.models import User
from app.routes import admin, auth, client, groups, invites, oauth, oidc, passkey, site, totp, user
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
    # GeoIP 数据库(mmdb + ip2region xdb ~10MB)启动时在线程池预载,
    # 避免首次登录请求承担全量载入的阻塞
    from fastapi.concurrency import run_in_threadpool

    from app.services.geoip_service import preload as preload_geoip
    await run_in_threadpool(preload_geoip)
    # 后台清理任务:每小时清过期 token/验证码/challenge + 归档超期登录日志
    from app.services.maintenance_service import start_maintenance_task
    maintenance_task = start_maintenance_task()
    logger.info("startup: db initialized debug=%s", settings.debug)
    logger.info("docs: http://localhost:%s/api/docs", settings.port)
    yield
    maintenance_task.cancel()
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

# 全局安全响应头(CSP/XFO/nosniff 等)——静态导出只能由后端注入
from app.middleware.security_headers import SecurityHeadersMiddleware

app.add_middleware(SecurityHeadersMiddleware)

@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError):
    # 响应体归一化为人类可读:每项只保留 msg/loc。
    # - input 字段是用户原始输入(可能是明文密码),绝不能进日志或响应体
    # - ctx 里可能含 ValueError 等不可 JSON 序列化的对象
    # - "Value error, " 是 pydantic 对自定义校验器的包装前缀,对用户无意义,剥离
    # 前端 lib/errors.ts 的 extractErrorMessage 兼容此数组形态(取首项 msg)。
    safe_errors = []
    for err in exc.errors():
        msg = str(err.get("msg", "参数校验失败"))
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        loc = [str(seg) for seg in err.get("loc", []) if isinstance(seg, (str, int))]
        safe_errors.append({"msg": msg, "loc": loc, "type": err.get("type", "")})
    logger.warning("validation error path=%s errors=%s", request.url.path, safe_errors)
    return JSONResponse(
        status_code=422,
        content={"detail": [{"msg": e["msg"], "loc": e["loc"]} for e in safe_errors]},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code >= 400:
        logger.warning("http error path=%s status=%s detail=%s", request.url.path, exc.status_code, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

# CORS middleware
# 配置校验:allow_credentials=True 时,ALLOWED_ORIGINS 含通配符(* 或
# *.example.com 形态)是矛盾配置——浏览器规范禁止凭据请求走通配符来源。
# Starlette 会静默按无凭据处理,容易让人误以为 CORS 生效了。这里启动告警
# 而非 fail-fast(个人部署可能有意公开只读 API)。
_cors_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
_wildcard_origins = [o for o in _cors_origins if "*" in o]
if _wildcard_origins:
    logger.warning(
        "CORS 配置冲突:ALLOWED_ORIGINS 含通配符 %s 且 allow_credentials=True;"
        "浏览器将拒绝带凭据的跨域请求(cookie 无法携带)。如需凭据请改为显式域名列表。",
        _wildcard_origins,
    )
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
app.include_router(groups.router)
app.include_router(admin.router)
app.include_router(invites.router)

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
    失败详情只进日志——该端点未认证,回显异常(含 DB 路径/驱动细节)
    会向匿名探测者泄露内部信息。
    """
    http_status = 200
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
    except Exception as e:
        logger.warning("/api/ready: database check failed: %s", e)
        http_status = 503
    return JSONResponse(
        status_code=http_status,
        content={"status": "ready" if http_status == 200 else "not_ready"},
    )


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
            raise HTTPException(status_code=404, detail="Not found")

        def _resolve(rel: str):
            """把相对路径安全解析到 static_dir 内;穿越出目录返回 None。

            full_path 来自 URL path 参数,FastAPI 只做 URL 解码、不做点段归一,
            `..%2f..%2fbackend%2f.env` 会原样进入 os.path.join。
            realpath 消解符号链接后再校验公共前缀,双保险。
            """
            root = os.path.realpath(static_dir)
            candidate = os.path.realpath(os.path.join(static_dir, rel))
            if candidate != root and not candidate.startswith(root + os.sep):
                return None
            return candidate if os.path.isfile(candidate) else None

        # Root path
        if full_path == "" or full_path == "/":
            index_path = _resolve("index.html")
            if index_path:
                return FileResponse(index_path)

        # Try to serve the exact file first
        file_path = _resolve(full_path)
        if file_path:
            return FileResponse(file_path)

        # Try with /index.html for directories (Next.js static export pattern)
        dir_index = _resolve(full_path + "/index.html")
        if dir_index:
            return FileResponse(dir_index)

        # Try with .html extension
        html_path = _resolve(full_path + ".html")
        if html_path:
            return FileResponse(html_path)

        # Remove trailing slash and try again
        if full_path.endswith("/"):
            no_slash = full_path.rstrip("/")
            html_path = _resolve(no_slash + ".html")
            if html_path:
                return FileResponse(html_path)
            dir_index = _resolve(no_slash + "/index.html")
            if dir_index:
                return FileResponse(dir_index)

        # Fallback to index.html for client-side routing
        index_path = _resolve("index.html")
        if index_path:
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
