from fastapi import APIRouter, Depends, HTTPException, status, Query, Form, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session
from typing import Optional, Tuple
from app.database import get_db
from app.schemas import TokenRequest, UserInfoResponse
from app.services.oauth_service import OAuthService
from app.middleware.auth import get_optional_user
from app.models import User
from app.utils.security import create_id_token, decode_token
from app.config import get_settings
from urllib.parse import quote
import base64
import hashlib
import logging

settings = get_settings()

router = APIRouter(prefix="/api/oauth", tags=["OAuth 2.0"])
logger = logging.getLogger("app.oauth")


@router.get("/client/{client_id}")
async def get_client_info(
    client_id: str,
    db: Session = Depends(get_db)
):
    """Get client information by client_id"""
    client = OAuthService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    return {
        "client_id": client.client_id,
        "name": client.name,
        "description": client.description,
        "logo": client.logo,
    }


@router.get("/authorize")
async def authorize_get(
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    scope: str = Query(default="profile"),
    state: Optional[str] = Query(default=None),
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
    request: Request = None
):
    """OAuth authorization endpoint (GET) - Shows authorization page"""
    # Verify client
    client = OAuthService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=400, detail="Invalid client_id")

    # Verify redirect_uri
    if not OAuthService.verify_redirect_uri(client, redirect_uri):
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")

    # Verify scope
    if not OAuthService.verify_scope(client, scope):
        raise HTTPException(status_code=400, detail="Invalid scope")

    # Check if user is logged in
    if not current_user:
        # Redirect to login page with return URL
        return_url = f"/oauth/authorize?response_type={response_type}&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}"
        if state:
            return_url += f"&state={state}"
        login_url = f"/login?redirect={quote(return_url, safe='')}"
        return RedirectResponse(url=login_url, status_code=302)

    # Check if user has access to this client based on group permissions
    if not OAuthService.check_user_access(current_user, client):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您没有权限访问此应用"
        )

    # Check if client is trusted or user has already authorized
    if client.trusted or OAuthService.has_user_authorized_client(db, current_user.id, client.id):
        # Auto-approve
        code = OAuthService.create_authorization_code(
            db, client, current_user, redirect_uri, scope
        )

        # Redirect back with code
        redirect_url = f"{redirect_uri}?code={code}"
        if state:
            redirect_url += f"&state={state}"

        return RedirectResponse(url=redirect_url, status_code=302)

    # Need user confirmation - check if request wants JSON
    # Check Accept header or if Authorization header is present (API call from frontend)
    accept_header = request.headers.get("accept", "") if request else ""
    auth_header = request.headers.get("authorization", "") if request else ""

    # If it's an API call (has Authorization header or wants JSON), return JSON
    if auth_header or "application/json" in accept_header:
        return {
            "client": {
                "name": client.name,
                "description": client.description,
                "logo": client.logo,
            },
            "scope": scope,
            "needs_approval": True
        }

    # For direct browser access, redirect to frontend authorize page
    frontend_url = f"/oauth/authorize?response_type={response_type}&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}"
    if state:
        frontend_url += f"&state={state}"
    return RedirectResponse(url=frontend_url, status_code=302)


@router.post("/authorize")
async def authorize_post(
    response_type: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    scope: str = Form(default="profile"),
    state: Optional[str] = Form(default=None),
    action: str = Form(...),
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """OAuth authorization endpoint (POST) - Handle user approval/denial"""
    # Check if user is logged in
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Verify client
    client = OAuthService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=400, detail="Invalid client_id")

    # Verify redirect_uri
    if not OAuthService.verify_redirect_uri(client, redirect_uri):
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")

    # Check if user has access to this client based on group permissions
    if not OAuthService.check_user_access(current_user, client):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您没有权限访问此应用"
        )

    # Handle denial
    if action == "deny":
        redirect_url = f"{redirect_uri}?error=access_denied"
        if state:
            redirect_url += f"&state={state}"
        return RedirectResponse(url=redirect_url, status_code=302)

    # Handle approval
    if action == "approve":
        # Verify scope
        if not OAuthService.verify_scope(client, scope):
            raise HTTPException(status_code=400, detail="Invalid scope")

        # Create authorization code
        code = OAuthService.create_authorization_code(
            db, client, current_user, redirect_uri, scope
        )

        # Redirect back with code
        redirect_url = f"{redirect_uri}?code={code}"
        if state:
            redirect_url += f"&state={state}"

        return RedirectResponse(url=redirect_url, status_code=302)

    raise HTTPException(status_code=400, detail="Invalid action")


@router.post("/token")
async def token(
    db: Session = Depends(get_db),
    request: Request = None
):
    """OAuth token endpoint"""
    async def parse_token_request(req: Request) -> dict:
        body_bytes = await req.body()
        body_len = len(body_bytes)
        body_hash = hashlib.sha256(body_bytes).hexdigest()[:12] if body_bytes else "empty"
        content_type = (req.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            try:
                data = await req.json()
                return data if isinstance(data, dict) else {}
            except Exception:
                logger.warning(
                    "oauth token: invalid json body (len=%s hash=%s ct=%s)",
                    body_len,
                    body_hash,
                    content_type,
                )
                raise HTTPException(status_code=400, detail=f"Invalid JSON body (error_id={body_hash})")

        try:
            form = await req.form()
        except Exception:
            logger.warning(
                "oauth token: invalid form body (len=%s hash=%s ct=%s)",
                body_len,
                body_hash,
                content_type,
            )
            raise HTTPException(status_code=400, detail=f"Invalid form body (error_id={body_hash})")

        data: dict = {}
        for k, v in form.multi_items():
            if k not in data:
                data[k] = v
        return data

    def parse_basic_client_credentials(req: Request) -> Tuple[Optional[str], Optional[str]]:
        auth = req.headers.get("authorization") or ""
        if not auth.lower().startswith("basic "):
            return None, None
        encoded = auth.split(" ", 1)[1].strip()
        try:
            decoded = base64.b64decode(encoded).decode("utf-8")
        except Exception:
            return None, None
        if ":" not in decoded:
            return None, None
        client_id_value, client_secret_value = decoded.split(":", 1)
        return client_id_value or None, client_secret_value or None

    if not request:
        raise HTTPException(status_code=400, detail="Missing request context")

    payload = await parse_token_request(request)
    logger.debug(
        "oauth token: parsed keys=%s ct=%s",
        sorted(list(payload.keys())),
        (request.headers.get("content-type") or "").lower(),
    )

    grant_type = payload.get("grant_type")
    code = payload.get("code")
    redirect_uri = payload.get("redirect_uri")
    refresh_token = payload.get("refresh_token")
    username = payload.get("username")
    password = payload.get("password")
    scope = payload.get("scope") or "profile"

    client_id = payload.get("client_id")
    client_secret = payload.get("client_secret")
    basic_client_id, basic_client_secret = parse_basic_client_credentials(request)
    client_id = client_id or basic_client_id
    client_secret = client_secret or basic_client_secret

    if not grant_type:
        raise HTTPException(status_code=400, detail="grant_type required")
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="client_id and client_secret required")

    base = str(request.base_url).rstrip("/") if request else ""
    issuer = settings.oidc_issuer or base

    def maybe_add_id_token(response_dict: dict, access_token_value: str) -> dict:
        payload = decode_token(access_token_value) or {}
        if "openid" not in (payload.get("scope") or "").split():
            return response_dict
        user = None
        try:
            user_id = int(payload.get("sub"))
            user = db.query(User).filter(User.id == user_id).first()
        except Exception:
            user = None
        id_token = create_id_token(
            {
                "sub": payload.get("sub"),
                "aud": payload.get("client_id"),
                "iss": issuer or None,
                "username": getattr(user, "username", None),
                "email": getattr(user, "email", None),
                "avatar": getattr(user, "avatar", None),
            }
        )
        response_dict["id_token"] = id_token
        return response_dict

    if grant_type == "authorization_code":
        # Authorization code flow
        if not code or not redirect_uri:
            raise HTTPException(status_code=400, detail="code and redirect_uri required")

        result = OAuthService.exchange_code_for_token(
            db, code, client_id, client_secret, redirect_uri
        )

        if not result:
            raise HTTPException(status_code=400, detail="Invalid authorization code")

        access_token, refresh_token_value, expires_in = result

        response = {
            "access_token": access_token,
            "refresh_token": refresh_token_value,
            "token_type": "bearer",
            "expires_in": expires_in
        }
        return maybe_add_id_token(response, access_token)

    elif grant_type == "refresh_token":
        # Refresh token flow
        if not refresh_token:
            raise HTTPException(status_code=400, detail="refresh_token required")

        result = OAuthService.refresh_token_grant(
            db, refresh_token, client_id, client_secret
        )

        if not result:
            raise HTTPException(status_code=400, detail="Invalid refresh token")

        access_token, new_refresh_token, expires_in = result

        response = {
            "access_token": access_token,
            "refresh_token": new_refresh_token,
            "token_type": "bearer",
            "expires_in": expires_in
        }
        return maybe_add_id_token(response, access_token)

    elif grant_type == "password":
        # Password flow (for trusted clients)
        if not username or not password:
            raise HTTPException(status_code=400, detail="username and password required")

        result = OAuthService.password_grant(
            db, username, password, client_id, client_secret, scope or "profile"
        )

        if not result:
            raise HTTPException(status_code=400, detail="Invalid credentials or client not trusted")

        access_token, refresh_token_value, expires_in = result

        response = {
            "access_token": access_token,
            "refresh_token": refresh_token_value,
            "token_type": "bearer",
            "expires_in": expires_in
        }
        return maybe_add_id_token(response, access_token)

    else:
        raise HTTPException(status_code=400, detail="Unsupported grant_type")


@router.get("/userinfo", response_model=UserInfoResponse)
async def userinfo(request: Request, db: Session = Depends(get_db)):
    """Get user info from access token (OpenID Connect endpoint)"""
    # Get token from Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    access_token = auth_header.replace("Bearer ", "")

    # Get user from token
    user = OAuthService.get_user_from_token(db, access_token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid access token")

    return UserInfoResponse(
        sub=str(user.id),
        username=user.username,
        email=user.email,
        avatar=user.avatar
    )
