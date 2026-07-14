from fastapi import APIRouter, Request

from app.config import get_settings
from app.utils.security import get_jwks

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
        "id_token_signing_alg_values_supported": [settings.jwt_algorithm],
        "scopes_supported": ["openid", "profile", "email"],
        "claims_supported": ["sub", "username", "email", "avatar"],
        "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
    }


@router.get("/.well-known/jwks.json")
async def jwks():
    # RS256 非对称签名:JWKS 仅暴露 RSA 公钥,私钥不离开服务端。
    # 未配置密钥路径时返回空(不泄露对称密钥)。
    return get_jwks()

