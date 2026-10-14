import base64
import hashlib
import hmac
import json
import logging
import re
from datetime import timedelta
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Client, Token, User, UserAuthorization
from app.utils.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_random_string,
    hash_token,
    verify_client_secret,
)
from app.utils.time import utcnow

settings = get_settings()
logger = logging.getLogger("uvicorn.error")

# RFC 7636 §4.1:code_verifier 由允许的字符集组成且长度 43-128;
# code_challenge(S256)是 verifier 的 base64url(43 字符),plain 则等于
# verifier 本身,两者格式校验一致
_PKCE_PARAM_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")


def is_valid_pkce_param(value: Optional[str]) -> bool:
    """PKCE code_verifier / code_challenge 格式校验(RFC 7636 §4.1/4.2)。"""
    return bool(value) and bool(_PKCE_PARAM_RE.match(value))


class OAuthService:
    """OAuth 2.0 service"""

    @staticmethod
    def _short_hash(value: str) -> str:
        if not value:
            return "empty"
        return hashlib.sha256(value.encode("utf-8")).hexdigest()[:10]

    @staticmethod
    def check_user_access(user: User, client: Client) -> bool:
        """检查用户是否有权限访问该应用"""
        return user.can_access_client(client)

    @staticmethod
    def get_client_by_id(db: Session, client_id: str) -> Optional[Client]:
        """Get client by client_id"""
        return db.query(Client).filter(Client.client_id == client_id).first()

    @staticmethod
    def verify_redirect_uri(client: Client, redirect_uri: str) -> bool:
        """Verify if redirect_uri is allowed for the client"""
        try:
            allowed_uris = json.loads(client.redirect_uris)
            return redirect_uri in allowed_uris
        except Exception as e:
            logger.warning(
                "oauth verify_redirect_uri failed client_id=%s err=%s",
                getattr(client, "client_id", None), e,
            )
            return False

    @staticmethod
    def verify_scope(client: Client, requested_scope: str) -> bool:
        """Verify if requested scope is allowed for the client.

        空 scope(空串/纯空白)一律拒绝:``set("".split())`` 是空集,
        空集恒为任意集合的子集,会让 ``scope=`` 绕过 consent 直接拿到
        「无 scope」token——而 userinfo 曾对无 scope token 兜底返回
        profile+email 全部 claims,等于变相全量授权。
        缺省 scope 的默认值由路由层提供(authorize 默认 ``profile``),
        显式传空串属于非法请求,按 invalid_scope 拒绝。
        """
        try:
            if not requested_scope or not requested_scope.strip():
                return False
            allowed_scopes = json.loads(client.allowed_scopes)
            requested = set(requested_scope.split())
            allowed = set(allowed_scopes)
            return requested.issubset(allowed)
        except Exception as e:
            logger.warning(
                "oauth verify_scope failed client_id=%s err=%s",
                getattr(client, "client_id", None), e,
            )
            return False

    @staticmethod
    def create_authorization_code(
        db: Session,
        client: Client,
        user: User,
        redirect_uri: str,
        scope: str,
        code_challenge: Optional[str] = None,
        code_challenge_method: Optional[str] = None,
        nonce: Optional[str] = None,
    ) -> str:
        """Create an authorization code.

        code_challenge/code_challenge_method: PKCE(RFC 7636),公开客户端防授权码拦截。
        nonce: OIDC 请求透传,签发 id_token 时回填(防重放)。
        """
        # Generate code
        code = generate_random_string(32)

        # Store code in database
        expires_at = utcnow() + timedelta(minutes=10)  # 10 minutes
        token = Token(
            token_hash=hash_token(code),
            type='authorization_code',
            user_id=user.id,
            client_id=client.id,
            scope=scope,
            redirect_uri=redirect_uri,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method or ("S256" if code_challenge else None),
            nonce=nonce,
            expires_at=expires_at
        )
        db.add(token)

        # Update or create user authorization
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()

        if auth:
            # P2-4:scope 存并集(而非覆盖),新增 scope 才需再次同意
            existing_scopes = set(auth.scope.split()) if auth.scope else set()
            new_scopes = set(scope.split())
            auth.scope = " ".join(sorted(existing_scopes | new_scopes))
            auth.last_used_at = utcnow()
        else:
            auth = UserAuthorization(
                user_id=user.id,
                client_id=client.id,
                scope=scope
            )
            db.add(auth)

        db.commit()

        return code

    @staticmethod
    def _verify_pkce(code_verifier: Optional[str], stored_challenge: Optional[str], method: Optional[str]) -> bool:
        """校验 PKCE code_verifier。无 stored_challenge 时视为未启用 PKCE,直接通过。

        仅接受 S256(OAuth 2.1 BCP:plain 会把 verifier 明文过信道,
        削弱 PKCE 的防拦截意义;存量 plain code 一律校验失败)。
        verifier 格式先按 RFC 7636 §4.1 校验(43-128,限定字符集)。
        """
        if not stored_challenge:
            # 客户端未在 authorize 时提供 code_challenge:对公开客户端应拒绝,
            # 对机密客户端允许(向后兼容)。调用方按 client_type 决定。
            return True
        if method != "S256":
            return False
        if not code_verifier or not is_valid_pkce_param(code_verifier):
            return False
        try:
            digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
        except (UnicodeEncodeError, AttributeError):
            # 非 ASCII verifier 直接判失败,而不是 500
            return False
        computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        return hmac.compare_digest(computed, stored_challenge)

    @staticmethod
    def _revoke_tokens_derived_from_code(db: Session, code_hash: str) -> int:
        """吊销某授权码派生的全部 token(RFC 6749 §4.1.2 重放响应)。

        按 code_hash 定位首次兑换签发的 refresh token,逐个走家族吊销
        (复用 AuthService._revoke_token_family:覆盖后续轮换产生的同族
        token,并联动过期挂载的 session)。无派生 token 时为 no-op
        (code 从未成功兑换过,按普通 invalid_grant 处理)。
        返回吊销的派生 token 数。
        """
        from app.services.auth_service import AuthService

        derived = db.query(Token).filter(
            Token.code_hash == code_hash,
            Token.type == 'refresh',
        ).all()
        for record in derived:
            AuthService._revoke_token_family(db, record)
        return len(derived)

    @staticmethod
    def exchange_code_for_token(
        db: Session,
        code: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        code_verifier: Optional[str] = None,
    ) -> Optional[Tuple[str, str, int, Optional[str]]]:
        """Exchange authorization code for access token.

        返回 (access_token, refresh_token, expires_in, nonce) —— nonce 用于签发 id_token。
        """
        # Get client
        client = OAuthService.get_client_by_id(db, client_id)
        if not client:
            logger.info("oauth exchange_code: client not found client_id=%s", client_id)
            return None

        # 公开客户端(public)免 client_secret,但必须用 PKCE
        is_public = (getattr(client, 'client_type', 'confidential') == 'public')
        if is_public:
            if not code_verifier:
                logger.info("oauth exchange_code: public client missing code_verifier client_id=%s", client_id)
                return None
        else:
            # 机密客户端仍校验 secret
            if not verify_client_secret(client_secret, client.client_secret_hash):
                logger.info("oauth exchange_code: invalid client_secret client_id=%s", client_id)
                return None

        # Get authorization code(绑定 client:RFC 6749 §4.1.3,授权码必须兑换给签发它的 client)
        code_hash = hash_token(code)
        token = db.query(Token).filter(
            Token.token_hash == code_hash,
            Token.type == 'authorization_code',
            Token.client_id == client.id,
            Token.expires_at > utcnow()
        ).first()

        if not token:
            # 已消耗(成功兑换后行被删除/失败兑换后置 claimed)的 code 再次
            # 出现 = 重放嫌疑(RFC 6749 §4.1.2:code 被使用多于一次时 MUST
            # 拒绝并 SHOULD 吊销其签发的全部 token)。按 code_hash 找出
            # 首次兑换派生的 token 灭族;无派生记录则只是普通无效 code。
            revoked = OAuthService._revoke_tokens_derived_from_code(db, code_hash)
            if revoked:
                logger.warning(
                    "oauth exchange_code: code replay detected, revoked %s derived token(s) "
                    "client_id=%s code_hash=%s",
                    revoked, client_id, OAuthService._short_hash(code),
                )
            return None

        # 单次使用:条件 UPDATE 抢占,并发兑换只有一个能成功(TOCTOU 竞态防护)
        claimed = db.query(Token).filter(
            Token.id == token.id,
            Token.type == 'authorization_code'
        ).update({"type": "authorization_code_claimed"})
        if not claimed:
            # 并发方已抢占:同样按重放处理(灭族首兑派生的 token)
            db.rollback()
            revoked = OAuthService._revoke_tokens_derived_from_code(db, code_hash)
            logger.warning(
                "oauth exchange_code: code already claimed client_id=%s code_hash=%s revoked=%s",
                client_id,
                OAuthService._short_hash(code),
                revoked,
            )
            return None

        # Verify redirect_uri matches
        if token.redirect_uri != redirect_uri:
            logger.info(
                "oauth exchange_code: redirect_uri mismatch client_id=%s token_redirect_uri=%s request_redirect_uri=%s",
                client_id,
                token.redirect_uri,
                redirect_uri,
            )
            # OAuth BCP:兑换失败即销毁 code——先 commit 掉 claimed 状态,
            # 防止攻击者用错误 redirect_uri/verifier 反复试探正确值
            db.commit()
            return None

        # PKCE 校验(RFC 7636)
        if not OAuthService._verify_pkce(code_verifier, token.code_challenge, token.code_challenge_method):
            logger.info("oauth exchange_code: pkce verification failed client_id=%s", client_id)
            db.commit()
            return None

        # 公开客户端必须走了 PKCE(授权码创建时有 challenge)
        if is_public and not token.code_challenge:
            logger.info("oauth exchange_code: public client code has no pkce challenge client_id=%s", client_id)
            db.commit()
            return None

        # Get user
        user = token.user
        if not user or user.status != 'active':
            logger.info(
                "oauth exchange_code: user inactive/missing client_id=%s user_id=%s",
                client_id,
                getattr(user, "id", None),
            )
            db.commit()
            return None

        # Create tokens
        token_data = {"sub": str(user.id), "scope": token.scope, "client_id": client_id}
        access_token = create_access_token(token_data, token_version=user.token_version)
        refresh_token = create_refresh_token(token_data)

        # Store refresh token(记录 code_hash:授权码重放时按此灭族,
        # RFC 6749 §4.1.2)
        access_expires = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
        refresh_expires = utcnow() + timedelta(days=settings.refresh_token_expire_days)

        refresh_token_record = Token(
            token_hash=hash_token(refresh_token),
            type='refresh',
            user_id=user.id,
            client_id=client.id,
            scope=token.scope,
            code_hash=code_hash,
            expires_at=refresh_expires
        )
        db.add(refresh_token_record)

        # Delete authorization code (one-time use;已先置 claimed 防并发兑换)
        db.delete(token)

        # Update last_used_at for authorization
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()
        if auth:
            auth.last_used_at = utcnow()

        db.commit()

        return access_token, refresh_token, settings.access_token_expire_minutes * 60, token.nonce

    @staticmethod
    def password_grant(
        db: Session,
        username: str,
        password: str,
        client_id: str,
        client_secret: str,
        scope: str = "profile",
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Optional[Tuple[str, str, int]]:
        """Password grant type (for trusted clients only).

        与 /api/auth/login 共用同一套风控/日志约束(此前该路径完全绕过):
        - 受限用户(is_restricted)拒绝发 token
        - 异常检测 + 风险评估命中(BLOCK_SUSPICIOUS_LOGIN)拒绝发 token
          ——token 端点无法承载 202 step-up 流程,风险登录一律 invalid_grant,
          用户需改走浏览器密码登录完成二次验证
        - 成功/失败均写 LoginLog(login_method=password)
        - 会话限制与密码登录一致:超限踢最旧会话(check_and_enforce_limit)
        """
        from app.services.auth_service import AuthService
        from app.services.geoip_service import GeoIPService
        from app.services.login_anomaly_service import LoginAnomalyService
        from app.services.risk_service import RiskLevel, RiskService
        from app.services.session_limit_service import SessionLimitService
        from app.utils.device import generate_device_id

        safe_ip = ip_address or "unknown"
        safe_ua = user_agent or "unknown"
        geo_info = GeoIPService.get_location(safe_ip)

        # Get client
        client = OAuthService.get_client_by_id(db, client_id)
        if not client:
            logger.info("oauth password_grant: client not found client_id=%s", client_id)
            return None

        # Verify client secret
        if not verify_client_secret(client_secret, client.client_secret_hash):
            logger.info("oauth password_grant: invalid client_secret client_id=%s", client_id)
            return None

        # Check if client is trusted
        if not client.trusted:
            logger.info("oauth password_grant: client not trusted client_id=%s", client_id)
            return None

        # Authenticate user
        user, failure_reason = AuthService.authenticate_user(
            db, username, password, ip_address=safe_ip, user_agent=safe_ua
        )
        if not user:
            logger.info("oauth password_grant: invalid user credentials client_id=%s username=%s reason=%s", client_id, username, failure_reason)
            AuthService.record_login_log(
                db,
                user=None,
                username=username,
                success=False,
                failure_reason=failure_reason or "invalid_credentials",
                ip_address=safe_ip,
                user_agent=safe_ua,
                geo_info=geo_info,
                login_method="password",
            )
            return None

        # 受限用户(未完成邮箱验证/无第二因子)不得经 password grant 拿 token:
        # 该路径无 step-up 验证通道,发 token 等于让受限防线失效
        if user.is_restricted:
            logger.info(
                "oauth password_grant: restricted user refused client_id=%s user_id=%s",
                client_id, user.id,
            )
            AuthService.record_login_log(
                db,
                user=user,
                username=username,
                success=False,
                failure_reason="restricted_user",
                ip_address=safe_ip,
                user_agent=safe_ua,
                geo_info=geo_info,
                login_method="password",
            )
            return None

        # 访问控制:与 authorize 端点同一判定(can_access_client),
        # 否则被拒用户凭密码经 trusted client 仍可拿到该应用 token
        if not OAuthService.check_user_access(user, client):
            logger.info(
                "oauth password_grant: user denied by access control client_id=%s user_id=%s",
                client_id, user.id,
            )
            return None

        # Verify scope
        if not OAuthService.verify_scope(client, scope):
            logger.info("oauth password_grant: invalid scope client_id=%s scope=%s", client_id, scope)
            return None

        # 风控链路(与 /api/auth/login 一致):异常检测 → 风险评分;
        # 命中即拒绝(token 端点无法承载 step-up,不能只降级放行)
        login_anomalies = LoginAnomalyService.check_anomalies(
            db, user, safe_ip, safe_ua, geo_info
        )
        if settings.block_suspicious_login:
            risk_assessment = RiskService.assess_password_login_risk(
                db=db,
                user=user,
                ip_address=safe_ip,
                city=geo_info.get("city") if geo_info else None,
                country=geo_info.get("country") if geo_info else None,
                device_token=None,
                existing_anomalies=login_anomalies,
            )
            if risk_assessment.risk_level != RiskLevel.NONE:
                logger.warning(
                    "oauth password_grant: risk detected, refusing grant "
                    "client_id=%s user_id=%s risk=%s",
                    client_id, user.id, risk_assessment.risk_level.value,
                )
                AuthService.record_login_log(
                    db,
                    user=user,
                    username=username,
                    success=False,
                    failure_reason="risk_blocked",
                    ip_address=safe_ip,
                    user_agent=safe_ua,
                    geo_info=geo_info,
                    login_method="password",
                    is_suspicious=True,
                    anomalies=[a.to_dict() for a in risk_assessment.anomalies],
                )
                return None

        # 会话限制(与密码登录一致:超限踢最旧会话,而非拒发)
        device_id = generate_device_id(user.id, safe_ua, safe_ip)
        SessionLimitService.check_and_enforce_limit(db, user, device_id)

        # Create tokens
        token_data = {"sub": str(user.id), "scope": scope, "client_id": client_id}
        access_token = create_access_token(token_data, token_version=user.token_version)
        refresh_token = create_refresh_token(token_data)

        # Store refresh token
        refresh_expires = utcnow() + timedelta(days=settings.refresh_token_expire_days)

        refresh_token_record = Token(
            token_hash=hash_token(refresh_token),
            type='refresh',
            user_id=user.id,
            client_id=client.id,
            scope=scope,
            expires_at=refresh_expires
        )
        db.add(refresh_token_record)

        # Create or update user authorization
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()

        if auth:
            auth.scope = scope
            auth.last_used_at = utcnow()
        else:
            auth = UserAuthorization(
                user_id=user.id,
                client_id=client.id,
                scope=scope
            )
            db.add(auth)

        db.commit()

        # 成功登录日志(在 commit 后写,日志自身独立事务)
        AuthService.record_login_log(
            db,
            user=user,
            username=username,
            success=True,
            ip_address=safe_ip,
            user_agent=safe_ua,
            geo_info=geo_info,
            anomalies=login_anomalies,
            login_method="password",
        )

        return access_token, refresh_token, settings.access_token_expire_minutes * 60

    @staticmethod
    def refresh_token_grant(
        db: Session,
        refresh_token: str,
        client_id: str,
        client_secret: str
    ) -> Optional[Tuple[str, str, int]]:
        """Refresh token grant type"""
        # Get client
        client = OAuthService.get_client_by_id(db, client_id)
        if not client:
            logger.info("oauth refresh_token: client not found client_id=%s", client_id)
            return None

        # Verify client secret
        # public 客户端免 secret(靠 PKCE 换取的 refresh token 本身作凭据);
        # confidential 保持 secret 校验
        is_public = (getattr(client, 'client_type', 'confidential') == 'public')
        if not is_public and not verify_client_secret(client_secret, client.client_secret_hash):
            logger.info("oauth refresh_token: invalid client_secret client_id=%s", client_id)
            return None

        # Verify refresh token + 家族轮换统一走 AuthService(重放检测/灭族/惰性回填同源)
        from app.services.auth_service import AuthService
        result = AuthService.refresh_access_token(
            db, refresh_token, client_id=client_id,
            # public 客户端完全免 secret:传入的任意 secret 不参与校验
            client_secret=None if is_public else client_secret,
        )
        if not result:
            logger.info(
                "oauth refresh_token: refresh failed (invalid/expired/replayed) client_id=%s",
                client_id,
            )
            return None

        new_access_token, new_refresh_token = result
        return new_access_token, new_refresh_token, settings.access_token_expire_minutes * 60

    @staticmethod
    def get_user_from_token(db: Session, access_token: str) -> Optional[User]:
        """Get user from access token"""
        payload = decode_token(access_token)
        if not payload or payload.get("type") != "access":
            return None

        user_id = payload.get("sub")
        if not user_id:
            return None

        user = db.query(User).filter(User.id == user_id, User.status == 'active').first()
        if user is None:
            return None

        # 校验 token_version:改密/封禁后 tv 不匹配则拒绝
        # (与 get_current_user 一致,防止 userinfo/introspect 旁路使用已吊销 token)
        if payload.get("tv", 0) != user.token_version:
            return None

        return user

    @staticmethod
    def has_user_authorized_client(db: Session, user_id: int, client_id: int) -> bool:
        """Check if user has already authorized a client"""
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user_id,
            UserAuthorization.client_id == client_id
        ).first()
        return auth is not None

    @staticmethod
    def needs_consent(db: Session, user: User, client: Client, requested_scope: str) -> bool:
        """P2-4:判断是否需要再次征得用户同意。

        仅当请求 scope 是已授权 scope 的子集时,才视为已充分授权、跳过同意。
        新增 scope(超出已授权范围)→ 需要同意(避免静默 scope 升级)。
        从未授权过 → 需要同意。
        """
        if client.trusted:
            return False
        auth = db.query(UserAuthorization).filter(
            UserAuthorization.user_id == user.id,
            UserAuthorization.client_id == client.id
        ).first()
        if not auth:
            return True
        existing = set(auth.scope.split()) if auth.scope else set()
        requested = set(requested_scope.split())
        return not requested.issubset(existing)
