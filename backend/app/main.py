from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.config import get_settings
from app.database import init_db
from app.routes import auth, oauth, user, client, oidc, site, passkey, totp
from app.api import groups, admin, invites
from app.middleware.auth import get_current_user
from app.models import User
import os
import logging

settings = get_settings()
logger = logging.getLogger("uvicorn.error")

# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    description="Personal OAuth 2.0 Authorization Server",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError):
    logger.warning("validation error path=%s errors=%s", request.url.path, exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


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


# Health check
@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


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


# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()
    logger.info("startup: db initialized debug=%s", settings.debug)
    logger.info("docs: http://localhost:%s/api/docs", settings.port)


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
