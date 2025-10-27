from fastapi import APIRouter, Depends, HTTPException, status, Query, Form, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.schemas import TokenRequest, UserInfoResponse
from app.services.oauth_service import OAuthService
from app.middleware.auth import get_optional_user
from app.models import User

router = APIRouter(prefix="/oauth", tags=["OAuth 2.0"])


@router.get("/authorize")
async def authorize_get(
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    scope: str = Query(default="profile"),
    state: Optional[str] = Query(default=None),
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
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
        login_url = f"/login?redirect=/oauth/authorize?response_type={response_type}&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}"
        if state:
            login_url += f"&state={state}"
        return RedirectResponse(url=login_url, status_code=302)

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

    # Show authorization page (for now, return HTML)
    # In production, this should render from Next.js
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Authorize Application</title>
        <style>
            body {{
                font-family: Arial, sans-serif;
                max-width: 500px;
                margin: 50px auto;
                padding: 20px;
                border: 1px solid #ddd;
                border-radius: 8px;
            }}
            h2 {{ color: #333; }}
            .app-info {{ background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }}
            .scopes {{ margin: 20px 0; }}
            .scope-item {{ padding: 5px 0; }}
            .buttons {{ margin-top: 20px; }}
            button {{
                padding: 10px 20px;
                margin-right: 10px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
            }}
            .approve {{ background: #4CAF50; color: white; }}
            .deny {{ background: #f44336; color: white; }}
        </style>
    </head>
    <body>
        <h2>Authorize Application</h2>
        <div class="app-info">
            <strong>{client.name}</strong> wants to access your account
        </div>
        <div class="scopes">
            <p><strong>This application will be able to:</strong></p>
            {''.join([f'<div class="scope-item">✓ {s}</div>' for s in scope.split()])}
        </div>
        <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="response_type" value="{response_type}">
            <input type="hidden" name="client_id" value="{client_id}">
            <input type="hidden" name="redirect_uri" value="{redirect_uri}">
            <input type="hidden" name="scope" value="{scope}">
            {'<input type="hidden" name="state" value="' + state + '">' if state else ''}
            <div class="buttons">
                <button type="submit" name="action" value="approve" class="approve">Authorize</button>
                <button type="submit" name="action" value="deny" class="deny">Deny</button>
            </div>
        </form>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)


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
    grant_type: str = Form(...),
    code: Optional[str] = Form(default=None),
    redirect_uri: Optional[str] = Form(default=None),
    refresh_token: Optional[str] = Form(default=None),
    username: Optional[str] = Form(default=None),
    password: Optional[str] = Form(default=None),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    scope: Optional[str] = Form(default="profile"),
    db: Session = Depends(get_db)
):
    """OAuth token endpoint"""

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

        return {
            "access_token": access_token,
            "refresh_token": refresh_token_value,
            "token_type": "bearer",
            "expires_in": expires_in
        }

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

        return {
            "access_token": access_token,
            "refresh_token": new_refresh_token,
            "token_type": "bearer",
            "expires_in": expires_in
        }

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

        return {
            "access_token": access_token,
            "refresh_token": refresh_token_value,
            "token_type": "bearer",
            "expires_in": expires_in
        }

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
