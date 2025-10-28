from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.config import get_settings
from app.database import init_db
from app.routes import auth, oauth, user, client
from app.api import groups, admin
import os

settings = get_settings()

# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    description="Personal OAuth 2.0 Authorization Server",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

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
app.include_router(groups.router, prefix="/api/groups", tags=["groups"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])


# Health check
@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


# Serve Next.js static files
# This will be configured after frontend is built
static_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "out")
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
    print("✅ Database initialized")
    print(f"📝 API documentation: http://localhost:{settings.port}/api/docs")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
