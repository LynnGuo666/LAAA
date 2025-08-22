from fastapi import APIRouter, Depends, HTTPException, status, Query, Request, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from typing import Optional
from ...core.database import get_db
from ...services.oauth_service import OAuthService
from ...services.auth_service import AuthService
from ...services.permission_service import PermissionService
from ...models.user import User
from ...models.application import Application
from .auth import get_current_user

router = APIRouter()


@router.get("/app-info")
async def get_application_info(
    client_id: str = Query(...),
    db: Session = Depends(get_db)
):
    """获取应用信息用于授权页面展示"""
    oauth_service = OAuthService(db)
    
    application = oauth_service.validate_application(client_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid client"
        )
    
    return {
        "id": application.id,
        "name": application.name,
        "description": application.description,
        "logo_url": application.logo_url,
        "website_url": application.website_url,
        "support_email": application.support_email,
        "privacy_policy_url": application.privacy_policy_url,
        "terms_of_service_url": application.terms_of_service_url,
        "required_security_level": application.required_security_level,
        "require_mfa": application.require_mfa
    }


@router.get("/authorize")
async def authorize_get(
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    scope: str = Query(default="read"),
    state: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """OAuth2 授权页面 - 显示应用信息供用户确认"""
    if response_type != "code":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported response type"
        )
    
    oauth_service = OAuthService(db)
    permission_service = PermissionService(db)
    
    # 验证应用
    application = oauth_service.validate_application(client_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid client"
        )
    
    # 验证重定向URI
    if not oauth_service.validate_redirect_uri(application, redirect_uri):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid redirect URI"
        )
    
    # 检查应用访问权限
    if not permission_service.check_application_access(current_user.id, application.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您没有权限访问此应用"
        )
    
    # 返回授权页面需要的信息
    return {
        "application": {
            "id": application.id,
            "name": application.name,
            "description": application.description,
            "logo_url": application.logo_url,
            "website_url": application.website_url,
            "support_email": application.support_email,
            "privacy_policy_url": application.privacy_policy_url,
            "terms_of_service_url": application.terms_of_service_url
        },
        "user": {
            "username": current_user.username,
            "email": current_user.email,
            "security_level": current_user.security_level
        },
        "scopes": scope.split(),
        "redirect_uri": redirect_uri,
        "state": state
    }


@router.post("/authorize")
async def authorize_post(
    response_type: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    scope: str = Form(default="read"),
    state: Optional[str] = Form(default=None),
    authorize: bool = Form(...),  # 用户是否同意授权
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """OAuth2 授权处理"""
    if response_type != "code":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported response type"
        )
    
    # 如果用户拒绝授权
    if not authorize:
        error_url = f"{redirect_uri}?error=access_denied"
        if state:
            error_url += f"&state={state}"
        return RedirectResponse(url=error_url, status_code=302)
    
    oauth_service = OAuthService(db)
    permission_service = PermissionService(db)
    
    # 验证应用
    application = oauth_service.validate_application(client_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid client"
        )
    
    # 验证重定向URI
    if not oauth_service.validate_redirect_uri(application, redirect_uri):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid redirect URI"
        )
    
    # 检查应用访问权限
    if not permission_service.check_application_access(current_user.id, application.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您没有权限访问此应用"
        )
    
    # 验证作用域
    requested_scopes = scope.split()
    valid_scopes = oauth_service.validate_scopes(application, requested_scopes)
    
    # 生成授权码
    code = oauth_service.create_authorization_code(
        current_user.id,
        application.id,
        redirect_uri,
        valid_scopes
    )
    
    # 重定向到客户端
    redirect_url = f"{redirect_uri}?code={code}"
    if state:
        redirect_url += f"&state={state}"
    
    return RedirectResponse(url=redirect_url, status_code=302)


@router.post("/token")
async def token(
    grant_type: str,
    code: Optional[str] = None,
    refresh_token: Optional[str] = None,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    redirect_uri: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """OAuth2 令牌端点"""
    oauth_service = OAuthService(db)
    
    if grant_type == "authorization_code":
        if not all([code, client_id, redirect_uri]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing required parameters"
            )
        
        # 验证应用
        application = oauth_service.validate_application(client_id, client_secret)
        if not application:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid client credentials"
            )
        
        # 交换令牌
        token_data = oauth_service.exchange_code_for_token(
            code, application.id, redirect_uri
        )
        
        if not token_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid authorization code"
            )
        
        return token_data
    
    elif grant_type == "refresh_token":
        if not refresh_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing refresh token"
            )
        
        token_data = oauth_service.refresh_access_token(refresh_token)
        
        if not token_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid refresh token"
            )
        
        return token_data
    
    elif grant_type == "client_credentials":
        if not all([client_id, client_secret]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing client credentials"
            )
        
        # 验证应用
        application = oauth_service.validate_application(client_id, client_secret)
        if not application:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid client credentials"
            )
        
        # 客户端凭证模式 - 生成应用级别的令牌
        from ...core.security import create_access_token
        from datetime import timedelta
        
        access_token = create_access_token(
            subject=f"app:{application.id}",
            expires_delta=timedelta(minutes=60)
        )
        
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": " ".join(application.allowed_scopes)
        }
    
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported grant type"
        )


@router.get("/userinfo")
async def userinfo(
    authorization: str = Depends(lambda request: request.headers.get("authorization")),
    db: Session = Depends(get_db)
):
    """OAuth2 用户信息端点"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header"
        )
    
    access_token = authorization[7:]  # 移除 "Bearer "
    
    oauth_service = OAuthService(db)
    user_info = oauth_service.get_user_info(access_token)
    
    if not user_info:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token"
        )
    
    return user_info


@router.post("/revoke")
async def revoke(
    token: str,
    token_type_hint: Optional[str] = None,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """OAuth2 令牌撤销端点"""
    if client_id and client_secret:
        oauth_service = OAuthService(db)
        application = oauth_service.validate_application(client_id, client_secret)
        if not application:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid client credentials"
            )
    
    oauth_service = OAuthService(db)
    revoked = oauth_service.revoke_token(token, token_type_hint or "access_token")
    
    return {"revoked": revoked}