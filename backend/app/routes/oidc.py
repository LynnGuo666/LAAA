from fastapi import APIRouter, Request
from app.config import get_settings

settings = get_settings()

router = APIRouter(tags=["OpenID Connect"])


@router.get("/.well-known/openid-configuration")
async def openid_configuration(request: Request):
    base = str(request.base_url).rstrip("/")
    issuer = settings.oidc_issuer or base

    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/api/oauth/authorize",
        "token_endpoint": f"{issuer}/api/oauth/token",
        "userinfo_endpoint": f"{issuer}/api/oauth/userinfo",
        "jwks_uri": f"{issuer}/.well-known/jwks.json",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": [settings.algorithm],
        "scopes_supported": ["openid", "profile", "email"],
        "claims_supported": ["sub", "username", "email", "avatar"],
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
    }


@router.get("/.well-known/jwks.json")
async def jwks():
    # 止血:HS256 对称密钥不可安全暴露,JWKS 暂返回空。
    # RS256 迁移(P0-2)后在此返回 RSA 公钥。
    return {"keys": []}

