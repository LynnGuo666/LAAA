from fastapi import APIRouter, Depends, HTTPException, status, Form, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any
from urllib.parse import urlencode, parse_qs
from app.core.database import get_db
from app.core.security import security
from app.core.config import settings
from app.services import OAuth2Service, ClientService, UserService
from app.schemas import (
    AuthorizationRequest, TokenRequest, TokenResponse, 
    UserInfo, WellKnownConfiguration
)
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/oauth", tags=["OAuth 2.0"])
security_scheme = HTTPBearer()


@router.get("/.well-known/openid_configuration", response_model=WellKnownConfiguration)
async def openid_configuration():
    """OpenID Connect Discovery endpoint"""
    base_url = settings.jwt_issuer
    return WellKnownConfiguration(
        issuer=base_url,
        authorization_endpoint=f"{base_url}/oauth/authorize",
        token_endpoint=f"{base_url}/oauth/token",
        userinfo_endpoint=f"{base_url}/oauth/userinfo",
        jwks_uri=f"{base_url}/oauth/jwks"
    )


@router.get("/jwks")
async def jwks():
    """JSON Web Key Set endpoint"""
    return security.get_jwks()


@router.get("/authorize")
async def authorize(
    request: Request,
    response_type: str,
    client_id: str,
    redirect_uri: str,
    scope: Optional[str] = None,
    state: Optional[str] = None,
    code_challenge: Optional[str] = None,
    code_challenge_method: Optional[str] = "S256",
    nonce: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """OAuth 2.0 Authorization Endpoint"""
    
    # 验证客户端
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        error_params = {
            "error": "invalid_client",
            "error_description": "Invalid client_id"
        }
        if state:
            error_params["state"] = state
        return RedirectResponse(f"{redirect_uri}?{urlencode(error_params)}")
    
    # 验证response_type
    if response_type not in ["code", "token", "id_token"]:
        error_params = {
            "error": "unsupported_response_type",
            "error_description": "The authorization server does not support this response type"
        }
        if state:
            error_params["state"] = state
        return RedirectResponse(f"{redirect_uri}?{urlencode(error_params)}")
    
    # 验证重定向URI
    if not ClientService.validate_redirect_uri(client, redirect_uri):
        error_params = {
            "error": "invalid_request",
            "error_description": "Invalid redirect_uri"
        }
        if state:
            error_params["state"] = state
        return RedirectResponse(f"{redirect_uri}?{urlencode(error_params)}")
    
    # 验证scope
    if not scope:
        scope = "openid"
    
    # 重定向到前端登录页面，带上所有OAuth参数
    frontend_url = "http://localhost:3000"  # 这应该从配置读取
    login_params = {
        "response_type": response_type,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope
    }
    if state:
        login_params["state"] = state
    if code_challenge:
        login_params["code_challenge"] = code_challenge
        login_params["code_challenge_method"] = code_challenge_method
    if nonce:
        login_params["nonce"] = nonce
    
    login_url = f"{frontend_url}/login?{urlencode(login_params)}"
    return RedirectResponse(login_url)


@router.post("/authorize")
async def handle_authorization(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    scope: str = Form(default="openid"),
    state: Optional[str] = Form(None),
    code_challenge: Optional[str] = Form(None),
    code_challenge_method: str = Form(default="S256"),
    nonce: Optional[str] = Form(None),
    consent: bool = Form(False),
    db: Session = Depends(get_db)
):
    """处理用户授权请求"""
    
    # 验证用户
    user = UserService.authenticate_user(db, username, password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not consent:
        error_params = {
            "error": "access_denied",
            "error_description": "The user denied the request"
        }
        if state:
            error_params["state"] = state
        return RedirectResponse(f"{redirect_uri}?{urlencode(error_params)}")
    
    # 验证客户端
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        error_params = {
            "error": "invalid_client",
            "error_description": "Invalid client_id"
        }
        if state:
            error_params["state"] = state
        return RedirectResponse(f"{redirect_uri}?{urlencode(error_params)}")
    
    # 验证重定向URI
    if not ClientService.validate_redirect_uri(client, redirect_uri):
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")
    
    # 生成授权码
    auth_code = OAuth2Service.create_authorization_code(
        db=db,
        user_id=user.id,
        client_id=client.id,
        redirect_uri=redirect_uri,
        scope=scope,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        nonce=nonce
    )
    
    # 重定向回客户端
    params = {"code": auth_code.code}
    if state:
        params["state"] = state
    
    return RedirectResponse(f"{redirect_uri}?{urlencode(params)}")


@router.post("/token", response_model=TokenResponse)
async def token_endpoint(
    grant_type: str = Form(...),
    code: Optional[str] = Form(None),
    redirect_uri: Optional[str] = Form(None),
    client_id: Optional[str] = Form(None),
    client_secret: Optional[str] = Form(None),
    code_verifier: Optional[str] = Form(None),
    refresh_token: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """OAuth 2.0 Token Endpoint"""
    
    if grant_type == "authorization_code":
        if not all([code, redirect_uri, client_id]):
            raise HTTPException(status_code=400, detail="Missing required parameters")
        
        # 验证客户端（如果提供了client_secret）
        if client_secret:
            client = ClientService.authenticate_client(db, client_id, client_secret)
            if not client:
                raise HTTPException(status_code=401, detail="Invalid client credentials")
        else:
            client = ClientService.get_client_by_id(db, client_id)
            if not client:
                raise HTTPException(status_code=400, detail="Invalid client_id")
        
        # 交换授权码获取令牌
        tokens = OAuth2Service.exchange_code_for_tokens(
            db=db,
            code=code,
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_verifier=code_verifier
        )
        
        return TokenResponse(**tokens)
    
    elif grant_type == "refresh_token":
        if not all([refresh_token, client_id]):
            raise HTTPException(status_code=400, detail="Missing required parameters")
        
        # 验证客户端（如果提供了client_secret）
        if client_secret:
            client = ClientService.authenticate_client(db, client_id, client_secret)
            if not client:
                raise HTTPException(status_code=401, detail="Invalid client credentials")
        
        tokens = OAuth2Service.refresh_token(db, refresh_token, client_id)
        return TokenResponse(**tokens)
    
    else:
        raise HTTPException(status_code=400, detail="Unsupported grant type")


@router.get("/userinfo", response_model=UserInfo)
async def userinfo(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: Session = Depends(get_db)
):
    """OpenID Connect UserInfo Endpoint"""
    access_token = credentials.credentials
    user_info = OAuth2Service.get_user_info(db, access_token)
    return UserInfo(**user_info)


@router.post("/revoke")
async def revoke_token(
    token: str = Form(...),
    token_type_hint: Optional[str] = Form(None),
    client_id: str = Form(...),
    client_secret: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """OAuth 2.0 Token Revocation Endpoint"""
    
    # 验证客户端
    if client_secret:
        client = ClientService.authenticate_client(db, client_id, client_secret)
        if not client:
            raise HTTPException(status_code=401, detail="Invalid client credentials")
    
    # 撤销令牌
    from app.models import OAuth2Token
    token_record = db.query(OAuth2Token).filter(
        (OAuth2Token.access_token == token) | (OAuth2Token.refresh_token == token)
    ).first()
    
    if token_record:
        token_record.revoked = True
        db.commit()
    
    return {"revoked": True}


@router.get("/introspect")
async def introspect_token(
    token: str = Form(...),
    token_type_hint: Optional[str] = Form(None),
    client_id: str = Form(...),
    client_secret: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """OAuth 2.0 Token Introspection Endpoint"""
    
    # 验证客户端
    if client_secret:
        client = ClientService.authenticate_client(db, client_id, client_secret)
        if not client:
            raise HTTPException(status_code=401, detail="Invalid client credentials")
    
    try:
        payload = security.verify_token(token)
        
        # 检查令牌是否被撤销
        from app.models import OAuth2Token
        token_record = db.query(OAuth2Token).filter(
            (OAuth2Token.access_token == token) | (OAuth2Token.refresh_token == token),
            OAuth2Token.revoked == False
        ).first()
        
        if not token_record:
            return {"active": False}
        
        return {
            "active": True,
            "client_id": payload.get("client_id"),
            "sub": payload.get("sub"),
            "scope": payload.get("scope"),
            "exp": payload.get("exp"),
            "iat": payload.get("iat"),
            "iss": payload.get("iss"),
            "aud": payload.get("aud")
        }
    
    except HTTPException:
        return {"active": False}