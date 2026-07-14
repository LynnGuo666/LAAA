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
        "revocation_endpoint": f"{issuer}/api/oauth/revoke",
        "introspection_endpoint": f"{issuer}/api/oauth/introspect",
        "response_types_supported": ["code"],
        "grant_types_supported": [
            "authorization_code",
            "refresh_token",
            "password",
        ],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": [settings.jwt_algorithm],
        "scopes_supported": ["openid", "profile", "email"],
        "claims_supported": [
            "sub", "username", "email", "avatar",
            "nonce", "at_hash", "aud", "iss", "iat", "exp",
        ],
        # 实现同时支持 client_secret_post 与 client_secret_basic
        "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
        "code_challenge_methods_supported": ["S256", "plain"],
    }


@router.get("/.well-known/jwks.json")
async def jwks():
    # RS256 非对称签名:JWKS 仅暴露 RSA 公钥,私钥不离开服务端。
    # 未配置密钥路径时返回空(不泄露对称密钥)。
    return get_jwks()

