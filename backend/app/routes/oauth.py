import base64
import hashlib
import logging
from typing import Optional, Tuple
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.middleware.auth import get_optional_user
from app.middleware.ratelimit import limiter
from app.models import User
from app.schemas import UserInfoResponse
from app.services.oauth_service import OAuthService, is_valid_pkce_param
from app.utils.device import get_client_ip
from app.utils.security import create_id_token, decode_token, verify_client_secret

settings = get_settings()

router = APIRouter(prefix="/api/oauth", tags=["OAuth 2.0"])
# Use uvicorn's configured logger so messages always show up in container logs.
logger = logging.getLogger("uvicorn.error")


def _build_redirect_url(base_url: str, params: dict) -> str:
    """构造带 query 的跳转 URL。

    - 正确处理 base_url 已带 query 的情况(用 & 而非 ? 拼接)
    - 所有值经 urlencode 编码(state 含 &/# 时不会注入/截断参数)
    - 值为 None 的键跳过
    """
    pairs = {k: v for k, v in params.items() if v is not None}
    if not pairs:
        return base_url
    sep = "&" if "?" in base_url else "?"
    return f"{base_url}{sep}{urlencode(pairs)}"


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
        "website_url": getattr(client, "website_url", None),
    }


@router.get("/authorize")
async def authorize_get(
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    scope: str = Query(default="profile"),
    state: Optional[str] = Query(default=None),
    nonce: Optional[str] = Query(default=None),
    code_challenge: Optional[str] = Query(default=None),
    code_challenge_method: Optional[str] = Query(default=None),
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
    request: Request = None
):
    """OAuth authorization endpoint (GET) - Shows authorization page"""
    accept_header = request.headers.get("accept", "") if request else ""
    auth_header = request.headers.get("authorization", "") if request else ""
    is_api_call = bool(auth_header) or "application/json" in accept_header

    # Verify client
    client = OAuthService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=400, detail="Invalid client_id")

    # Verify redirect_uri
    if not OAuthService.verify_redirect_uri(client, redirect_uri):
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")

    # response_type 校验:redirect_uri 已验证合法,按 RFC 6749 §4.1.2.1
    # 以 302 回传 error=unsupported_response_type(schemas 里的 pattern
    # 此前没被路由实际使用)
    if response_type != "code":
        error_url = _build_redirect_url(
            redirect_uri,
            {
                "error": "unsupported_response_type",
                "error_description": "only response_type=code is supported",
                "state": state,
            },
        )
        if is_api_call:
            return {"redirect_url": error_url}
        return RedirectResponse(url=error_url, status_code=302)

    # Verify scope
    if not OAuthService.verify_scope(client, scope):
        raise HTTPException(status_code=400, detail="Invalid scope")

    # PKCE:仅允许 S256(OAuth 2.1 BCP,plain 明文传输 verifier 削弱防拦截
    # 意义);challenge 格式按 RFC 7636 校验(43-128,限定字符集)
    if code_challenge:
        if code_challenge_method not in (None, "S256"):
            raise HTTPException(status_code=400, detail="Unsupported code_challenge_method (only S256)")
        if not is_valid_pkce_param(code_challenge):
            raise HTTPException(status_code=400, detail="Invalid code_challenge format")

    # 公开客户端(public,无 client_secret)必须在 authorize 阶段就带 PKCE
    # code_challenge——提前拒绝而非等到兑换时才失败(fail-fast,
    # 与 RFC 7636 §4.3 授权请求中 SHOULD 要求 challenge 的实践一致)
    if getattr(client, 'client_type', 'confidential') == 'public' and not code_challenge:
        raise HTTPException(status_code=400, detail="Public clients must use PKCE (code_challenge required)")

    # Check if user is logged in
    if not current_user:
        # Redirect to login page with return URL
        return_url = _build_redirect_url(
            "/oauth/authorize",
            {
                "response_type": response_type,
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "scope": scope,
                "state": state,
                "nonce": nonce,
                "code_challenge": code_challenge,
                "code_challenge_method": (
                    code_challenge_method or "S256" if code_challenge else None
                ),
            },
        )
        login_url = _build_redirect_url("/login", {"redirect": return_url})
        return RedirectResponse(url=login_url, status_code=302)

    # Check if user has access to this client based on group permissions
    if not OAuthService.check_user_access(current_user, client):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您没有权限访问此应用"
        )

    # Check if user is in restricted mode(静态属性:未验证邮箱/无第二因子)
    if current_user.is_restricted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您的账户处于受限模式，请先完成邮箱验证和二次验证设置"
        )

    # 受限会话 claim 双检(批次1 遗留):身份来自跳过验证签发的 restricted
    # token 时,即使静态属性已解除受限,也不得进入授权流程
    if (getattr(request.state, "token_payload", None) or {}).get("restricted"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前为受限会话（跳过验证登录），请重新登录并完成安全验证后再授权"
        )

    # P2-4:仅当请求 scope 是已授权 scope 的子集时才跳过同意(避免静默升级)
    needs_consent = OAuthService.needs_consent(db, current_user, client, scope)

    # Check if client is trusted or user has already authorized (sufficient scope)
    if client.trusted or not needs_consent:
        # Auto-approve
        code = OAuthService.create_authorization_code(
            db, client, current_user, redirect_uri, scope,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            nonce=nonce,
        )

        # Redirect back with code
        redirect_url = _build_redirect_url(redirect_uri, {"code": code, "state": state})

        if is_api_call:
            return {"redirect_url": redirect_url}
        return RedirectResponse(url=redirect_url, status_code=302)

    # Need user confirmation - check if request wants JSON
    # Check Accept header or if Authorization header is present (API call from frontend)
    # If it's an API call (has Authorization header or wants JSON), return JSON
    if is_api_call:
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
    # (透传 PKCE/nonce/response_type:丢掉它们会让 public client 在
    # consent 页重新 POST 时缺 code_challenge 被 400 拒绝,OIDC 的
    # nonce 也会丢失——浏览器授权流功能死锁)
    frontend_url = _build_redirect_url(
        "/oauth/authorize",
        {
            "response_type": response_type,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": scope,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": (
                code_challenge_method or "S256" if code_challenge else None
            ),
        },
    )
    return RedirectResponse(url=frontend_url, status_code=302)


@router.post("/authorize")
async def authorize_post(
    response_type: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    scope: str = Form(default="profile"),
    state: Optional[str] = Form(default=None),
    nonce: Optional[str] = Form(default=None),
    code_challenge: Optional[str] = Form(default=None),
    code_challenge_method: Optional[str] = Form(default=None),
    action: str = Form(...),
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
    request: Request = None,
):
    """OAuth authorization endpoint (POST) - Handle user approval/denial"""
    accept_header = request.headers.get("accept", "") if request else ""
    auth_header = request.headers.get("authorization", "") if request else ""
    is_api_call = bool(auth_header) or "application/json" in accept_header

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

    # response_type 校验(与 GET 一致:redirect_uri 已验证,302 回传错误)
    if response_type != "code":
        error_url = _build_redirect_url(
            redirect_uri,
            {
                "error": "unsupported_response_type",
                "error_description": "only response_type=code is supported",
                "state": state,
            },
        )
        if is_api_call:
            return {"redirect_url": error_url}
        return RedirectResponse(url=error_url, status_code=302)

    # PKCE:与 GET 一致,仅允许 S256 + challenge 格式校验
    if code_challenge:
        if code_challenge_method not in (None, "S256"):
            raise HTTPException(status_code=400, detail="Unsupported code_challenge_method (only S256)")
        if not is_valid_pkce_param(code_challenge):
            raise HTTPException(status_code=400, detail="Invalid code_challenge format")

    # 公开客户端必须在 authorize 阶段就带 PKCE challenge(与 GET 一致,fail-fast)
    if getattr(client, 'client_type', 'confidential') == 'public' and not code_challenge:
        raise HTTPException(status_code=400, detail="Public clients must use PKCE (code_challenge required)")

    # Check if user has access to this client based on group permissions
    if not OAuthService.check_user_access(current_user, client):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您没有权限访问此应用"
        )

    # Check if user is in restricted mode(静态属性:未验证邮箱/无第二因子)
    if current_user.is_restricted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您的账户处于受限模式，请先完成邮箱验证和二次验证设置"
        )

    # 受限会话 claim 双检(批次1 遗留):身份来自跳过验证签发的 restricted
    # token 时,即使静态属性已解除受限,也不得签发授权码
    if (getattr(request.state, "token_payload", None) or {}).get("restricted"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前为受限会话（跳过验证登录），请重新登录并完成安全验证后再授权"
        )

    # Handle denial
    if action == "deny":
        redirect_url = _build_redirect_url(
            redirect_uri, {"error": "access_denied", "state": state}
        )
        if is_api_call:
            return {"redirect_url": redirect_url}
        return RedirectResponse(url=redirect_url, status_code=302)

    # Handle approval
    if action == "approve":
        # Verify scope
        if not OAuthService.verify_scope(client, scope):
            raise HTTPException(status_code=400, detail="Invalid scope")

        # Create authorization code(透传 PKCE + nonce)
        code = OAuthService.create_authorization_code(
            db, client, current_user, redirect_uri, scope,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            nonce=nonce,
        )

        # Redirect back with code
        redirect_url = _build_redirect_url(redirect_uri, {"code": code, "state": state})

        if is_api_call:
            return {"redirect_url": redirect_url}
        return RedirectResponse(url=redirect_url, status_code=302)

    raise HTTPException(status_code=400, detail="Invalid action")


@router.post("/token")
@limiter.limit("10/minute")
async def token(
    request: Request,
    db: Session = Depends(get_db),
):
    """OAuth token endpoint"""
    def oauth_error(
        status_code: int,
        error: str,
        error_description: str,
        headers: Optional[dict] = None,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status_code,
            content={"error": error, "error_description": error_description},
            headers=headers or {},
        )

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
        except Exception as e:
            logger.debug("oauth token: invalid basic auth encoding err=%s", e)
            return None, None
        if ":" not in decoded:
            return None, None
        client_id_value, client_secret_value = decoded.split(":", 1)
        return client_id_value or None, client_secret_value or None

    if not request:
        raise HTTPException(status_code=400, detail="Missing request context")

    logger.info(
        "oauth token: received ct=%s cl=%s has_auth=%s",
        (request.headers.get("content-type") or "").lower(),
        request.headers.get("content-length"),
        bool(request.headers.get("authorization")),
    )

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
    code_verifier = payload.get("code_verifier")  # PKCE

    client_id = payload.get("client_id")
    client_secret = payload.get("client_secret")
    basic_client_id, basic_client_secret = parse_basic_client_credentials(request)
    client_id = client_id or basic_client_id
    client_secret = client_secret or basic_client_secret

    if not grant_type:
        logger.warning("oauth token: missing grant_type client_id=%s", client_id)
        return oauth_error(400, "invalid_request", "grant_type required")
    if not client_id:
        logger.warning(
            "oauth token: missing client_id grant_type=%s", grant_type,
        )
        return oauth_error(
            401,
            "invalid_client",
            "client authentication failed (missing client_id)",
            headers={"WWW-Authenticate": 'Basic realm="oauth"'},
        )

    client = OAuthService.get_client_by_id(db, client_id)
    if not client:
        return oauth_error(
            401,
            "invalid_client",
            "client authentication failed (invalid client_id)",
            headers={"WWW-Authenticate": 'Basic realm="oauth"'},
        )
    # 公开客户端(public)免 secret,靠 PKCE;机密客户端仍校验 secret
    is_public = (getattr(client, 'client_type', 'confidential') == 'public')
    if not is_public and not verify_client_secret(client_secret, client.client_secret_hash):
        return oauth_error(
            401,
            "invalid_client",
            "client authentication failed (invalid client_secret)",
            headers={"WWW-Authenticate": 'Basic realm="oauth"'},
        )

    base = str(request.base_url).rstrip("/") if request else ""
    issuer = settings.oidc_issuer or base

    def maybe_add_id_token(response_dict: dict, access_token_value: str, nonce: Optional[str] = None) -> dict:
        payload = decode_token(access_token_value) or {}
        if "openid" not in (payload.get("scope") or "").split():
            return response_dict
        user = None
        try:
            user_id = int(payload.get("sub"))
            user = db.query(User).filter(User.id == user_id).first()
        except Exception as e:
            logger.warning("oauth token: id_token user lookup failed sub=%s err=%s", payload.get("sub"), e)
            user = None

        # OIDC 完整性 claims:
        # - nonce:请求时透传,回填防重放
        # - at_hash:access_token hash 的左半,RP 校验 id_token 与 access_token 绑定
        # claims 按 scope 过滤(与 userinfo 的披露策略一致):
        # 仅授权 profile 才给 username/avatar,仅授权 email 才给 email
        granted_scopes = set((payload.get("scope") or "").split())
        id_claims = {
            "sub": payload.get("sub"),
            "aud": payload.get("client_id"),
            "iss": issuer or None,
        }
        if "profile" in granted_scopes:
            id_claims["username"] = getattr(user, "username", None)
            id_claims["avatar"] = getattr(user, "avatar", None)
        if "email" in granted_scopes:
            id_claims["email"] = getattr(user, "email", None)
        if nonce:
            id_claims["nonce"] = nonce
        # at_hash = base64url(sha256(access_token)[0:16])
        # OIDC §3.1.3.6:at_hash 对隐式流必填,对 code 流 SHOULD。这里都加,便于 RP 校验绑定。
        try:
            digest = hashlib.sha256(access_token_value.encode("ascii")).digest()
            id_claims["at_hash"] = base64.urlsafe_b64encode(digest[:16]).rstrip(b"=").decode("ascii")
        except Exception:
            pass

        id_token = create_id_token(id_claims)
        response_dict["id_token"] = id_token
        return response_dict

    if grant_type == "authorization_code":
        # Authorization code flow
        if not code or not redirect_uri:
            logger.warning(
                "oauth token: missing code/redirect_uri client_id=%s has_code=%s has_redirect_uri=%s",
                client_id,
                bool(code),
                bool(redirect_uri),
            )
            return oauth_error(400, "invalid_request", "code and redirect_uri required")

        result = OAuthService.exchange_code_for_token(
            db, code, client_id, client_secret or "", redirect_uri, code_verifier=code_verifier
        )

        if not result:
            logger.warning(
                "oauth token: authorization_code exchange failed client_id=%s redirect_uri=%s",
                client_id,
                redirect_uri,
            )
            return oauth_error(400, "invalid_grant", "invalid authorization code")

        access_token, refresh_token_value, expires_in, nonce = result

        response = {
            "access_token": access_token,
            "refresh_token": refresh_token_value,
            "token_type": "bearer",
            "expires_in": expires_in
        }
        return maybe_add_id_token(response, access_token, nonce)

    elif grant_type == "refresh_token":
        # Refresh token flow
        if not refresh_token:
            logger.warning("oauth token: missing refresh_token client_id=%s", client_id)
            return oauth_error(400, "invalid_request", "refresh_token required")

        result = OAuthService.refresh_token_grant(
            db, refresh_token, client_id, client_secret or ""
        )

        if not result:
            logger.warning("oauth token: refresh_token grant failed client_id=%s", client_id)
            return oauth_error(400, "invalid_grant", "invalid refresh token")

        access_token, new_refresh_token, expires_in = result

        response = {
            "access_token": access_token,
            "refresh_token": new_refresh_token,
            "token_type": "bearer",
            "expires_in": expires_in
        }
        return maybe_add_id_token(response, access_token, None)

    elif grant_type == "password":
        # Password flow (for trusted clients)
        if not username or not password:
            logger.warning(
                "oauth token: missing username/password client_id=%s has_username=%s has_password=%s",
                client_id,
                bool(username),
                bool(password),
            )
            return oauth_error(400, "invalid_request", "username and password required")

        result = OAuthService.password_grant(
            db, username, password, client_id, client_secret or "", scope or "profile",
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )

        if not result:
            logger.warning("oauth token: password grant failed client_id=%s username=%s", client_id, username)
            return oauth_error(400, "invalid_grant", "invalid credentials or client not trusted")

        access_token, refresh_token_value, expires_in = result

        response = {
            "access_token": access_token,
            "refresh_token": refresh_token_value,
            "token_type": "bearer",
            "expires_in": expires_in
        }
        return maybe_add_id_token(response, access_token, None)

    else:
        return oauth_error(400, "unsupported_grant_type", "unsupported grant_type")


@router.post("/introspect")
@limiter.limit("30/minute")
async def introspect(
    request: Request,
    db: Session = Depends(get_db),
):
    """RFC 7662 token introspection.

    资源服务器用 client 凭据查询某 access_token 是否有效及其 scope/sub/exp。
    返回 {"active": false} 表示无效/过期/吊销(不暴露具体原因)。
    """
    body = await _parse_form_or_json(request)
    token_value = body.get("token")
    # client 认证(Basic 或 body)
    cid, csec = _extract_client_credentials(request, body)
    client = OAuthService.get_client_by_id(db, cid) if cid else None
    if not client or not verify_client_secret(csec or "", client.client_secret_hash):
        return JSONResponse(status_code=401, content={"error": "invalid_client"})

    if not token_value:
        return {"active": False}

    payload = decode_token(token_value)
    if not payload or payload.get("type") != "access":
        return {"active": False}
    user = OAuthService.get_user_from_token(db, token_value)
    if not user:
        return {"active": False}

    return {
        "active": True,
        "scope": payload.get("scope", ""),
        "client_id": payload.get("client_id"),
        "sub": payload.get("sub"),
        "token_type": "Bearer",
        "exp": int(payload.get("exp", 0)),
    }


@router.post("/revoke")
@limiter.limit("30/minute")
async def revoke(
    request: Request,
    db: Session = Depends(get_db),
):
    """RFC 7009 token revocation.

    吊销 refresh token(删 DB 记录)。access token 是无状态 JWT,15min TTL,
    配合 P1-5 token_version 机制已可即时吊销(改密/封禁时);此处主要清 refresh。
    成功总是返回 200(即使 token 无效,避免泄露信息)。
    """
    body = await _parse_form_or_json(request)
    token_value = body.get("token")
    token_type_hint = body.get("token_type_hint", "refresh_token")
    cid, csec = _extract_client_credentials(request, body)
    client = OAuthService.get_client_by_id(db, cid) if cid else None
    if not client or not verify_client_secret(csec or "", client.client_secret_hash):
        return JSONResponse(status_code=401, content={"error": "invalid_client"})

    if token_value:
        from app.models import Token
        from app.utils.security import hash_token
        th = hash_token(token_value)
        record = db.query(Token).filter(
            Token.token_hash == th,
            Token.client_id == client.id,
        ).first()
        if record:
            from app.services.auth_service import AuthService
            if record.family_id:
                # 家族吊销(与自家 logout 语义对齐):同一登录链路轮换出的
                # 全部 refresh token 一并移除并联动过期 session,防止吊销
                # 旧 token 后在途的新 token 仍可继续刷新
                AuthService._revoke_token_family(db, record)
            else:
                # 无 family_id 的孤 token(如授权码路径签发的未轮换记录):
                # 退回删单条(与旧行为一致)
                db.delete(record)
                db.commit()
            logger.info("oauth revoke: token revoked client_id=%s type=%s", cid, record.type)

    # RFC 7009 §2.2:始终 200
    return JSONResponse(status_code=200, content={})


async def _parse_form_or_json(request: Request) -> dict:
    """token/revoke/introspect 端点支持 form 或 json body。"""
    ct = (request.headers.get("content-type") or "").lower()
    if "application/json" in ct:
        try:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    try:
        form = await request.form()
    except Exception:
        return {}
    return dict(form.multi_items())


def _extract_client_credentials(request: Request, body: dict):
    """从 Basic header 或 body 取 client_id/client_secret。"""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("basic "):
        try:
            decoded = base64.b64decode(auth.split(" ", 1)[1].strip()).decode("utf-8")
            if ":" in decoded:
                cid, csec = decoded.split(":", 1)
                return cid or None, csec or None
        except Exception as e:
            logger.debug("oauth: invalid basic auth err=%s", e)
    return body.get("client_id"), body.get("client_secret")


@router.get("/userinfo", response_model=UserInfoResponse)
async def userinfo(request: Request, db: Session = Depends(get_db)):
    """Get user info from access token (OpenID Connect userinfo endpoint).

    OIDC §5.4:按 token 的 scope 过滤返回的 claims。
    - profile scope:sub, username, avatar
    - email scope:email
    无对应 scope 的 claim 不返回(最小披露)。
    """
    # Get token from Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    access_token = auth_header.replace("Bearer ", "")

    # Get user from token
    user = OAuthService.get_user_from_token(db, access_token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid access token")

    # 解析 scope 决定返回哪些 claims(从 token payload 取 scope,不信任请求方)
    from app.utils.security import decode_token
    payload = decode_token(access_token) or {}
    scopes = set((payload.get("scope") or "").split())

    claims = {"sub": str(user.id)}
    if "profile" in scopes:
        claims["username"] = user.username
        claims["avatar"] = user.avatar
    if "email" in scopes:
        claims["email"] = user.email

    return UserInfoResponse(**claims)
