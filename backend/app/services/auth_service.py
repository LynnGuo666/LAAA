import json
import logging
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import KnownDevice, LoginLog, Token, User
from app.models import Session as SessionModel
from app.utils.device import generate_device_id, get_device_name, parse_device_type
from app.utils.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash_async,
    hash_token,
    verify_client_secret,
    verify_password_async,
)
from app.utils.time import utcnow

settings = get_settings()
logger = logging.getLogger("uvicorn.error")

# 用于用户不存在时保持常量时间响应:仍跑一次 bcrypt 验证,避免基于响应时序枚举用户名。
DUMMY_PASSWORD_HASH = "$2b$12$7hCJrIJoByJ9AEiLybrm9Okp2CPh2VB.AbARWEyo9ZqKvWyDtr/nO"


class AuthService:
    """Authentication service"""

    @staticmethod
    async def register_user(
        db: Session,
        *,
        username: str,
        email: str,
        password: str,
        invite_code: Optional[str] = None
    ) -> User:
        """Register a new user"""
        from app.services.invite_service import InviteService

        existing_user_count = db.query(User.id).count()
        invite = None
        if not settings.allow_open_registration:
            if existing_user_count == 0 and settings.bootstrap_allow_first_user:
                invite = InviteService.get_redeemable_invite(db, invite_code) if invite_code else None
            else:
                invite = InviteService.get_redeemable_invite(db, invite_code or "")
                if not invite:
                    raise ValueError("当前为邀请制注册，请提供有效邀请码")

        # Check if user exists
        existing = db.query(User).filter(
            (User.username == username) | (User.email == email)
        ).first()

        if existing:
            raise ValueError("Username or email already exists")

        # Create user
        user = User(
            username=username,
            email=email,
            password_hash=await get_password_hash_async(password)
        )
        db.add(user)
        db.flush()

        # Assign default 'user' role
        from app.models import Group, Role
        user_role = db.query(Role).filter(Role.name == 'user').first()
        if user_role:
            user.roles.append(user_role)

        # Assign default groups (is_default=True)
        default_groups = db.query(Group).filter(Group.is_default == True).all()
        for group in default_groups:
            if group not in user.groups:
                user.groups.append(group)

        # Assign group from invite code (if any)
        if invite:
            invite_group = invite.group
            if invite_group and invite_group not in user.groups:
                user.groups.append(invite_group)
            InviteService.redeem_invite(db, invite, user_id=user.id)

        db.commit()
        db.refresh(user)

        return user

    @staticmethod
    async def authenticate_user(
        db: Session,
        username: str,
        password: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> Tuple[Optional[User], Optional[str]]:
        """
        Authenticate a user.

        Returns:
            Tuple of (User or None, failure_reason or None)
        """
        user = db.query(User).filter(User.username == username).first()
        if not user:
            # 用户不存在也跑一次 bcrypt 校验,使响应时间与"密码错误"分支一致(防时序枚举)
            # 同样走线程池,保证两个分支的事件循环占用语义一致
            await verify_password_async(password, DUMMY_PASSWORD_HASH)
            return None, "user_not_found"
        if not await verify_password_async(password, user.password_hash):
            return None, "invalid_password"
        if user.status != 'active':
            return None, "account_suspended"
        return user, None

    @staticmethod
    def create_tokens(
        db: Session,
        user: User,
        client_id: str,
        scope: str,
        remember_me: bool = False,
        device_name: Optional[str] = None,
        device_token: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        login_method: str = "password",
        geo_info: Optional[Dict[str, Any]] = None,
        anomalies: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Create access and refresh tokens for a user.

        Args:
            geo_info: 调用方已查过的 GeoIP 结果(传入则不重查,省一次 mmdb 读)
            anomalies: 调用方已跑过的异常检测结果(传入则不重跑)

        Returns:
            Dictionary containing:
            - access_token: str
            - refresh_token: str
            - kicked_session: Optional[dict] - Info about kicked session if any
            - is_suspicious: bool - Whether login is suspicious
            - anomalies: List[dict] - List of detected anomalies
        """
        from app.services.geoip_service import GeoIPService
        from app.services.login_anomaly_service import LoginAnomalyService
        from app.services.session_limit_service import SessionLimitService

        safe_user_agent = user_agent or "unknown"
        safe_ip_address = ip_address or "unknown"

        # Always generate device_id for session tracking
        device_id = generate_device_id(user.id, safe_user_agent, safe_ip_address)

        # Get GeoIP information(调用方传入则复用)
        if geo_info is None:
            geo_info = GeoIPService.get_location(safe_ip_address)

        # Check for anomalies(调用方传入则复用)
        if anomalies is None:
            anomalies = LoginAnomalyService.check_anomalies(
                db, user, safe_ip_address, safe_user_agent, geo_info
            )
        is_suspicious = LoginAnomalyService.is_suspicious(anomalies)

        # Check and enforce session limits
        kicked_session = None
        allowed, kicked_info = SessionLimitService.check_and_enforce_limit(
            db, user, device_id
        )
        kicked_session = kicked_info

        # Resolve client early so tokens are bound to a real client_id
        from app.models import Client
        client = db.query(Client).filter(Client.client_id == client_id).first()
        if not client:
            # internal/未知 client 均不再静默 fallback 到任意已注册应用
            # (init_db 已确保 internal 存在,见 database.py)
            raise ValueError(f"Client not found: {client_id}")

        # Create JWT tokens
        token_data = {
            "sub": str(user.id),
            "scope": scope,
            "client_id": client.client_id if client else client_id,
            "device_id": device_id,  # Always include device_id
        }
        access_token = create_access_token(token_data, token_version=user.token_version)
        refresh_token = create_refresh_token(token_data, remember_me)

        # Calculate expiration
        access_expires = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
        if remember_me:
            refresh_expires = utcnow() + timedelta(days=settings.refresh_token_remember_me_days)
        else:
            refresh_expires = utcnow() + timedelta(days=settings.refresh_token_expire_days)

        # Store refresh token(client 在上方已确保存在,不再有 else 1 兜底)
        refresh_token_record = Token(
            token_hash=hash_token(refresh_token),
            type='refresh',
            user_id=user.id,
            client_id=client.id,
            scope=scope,
            expires_at=refresh_expires
        )
        db.add(refresh_token_record)

        # Create or update session (always, not just when remember_me)
        device_type = parse_device_type(safe_user_agent)
        device_display_name = device_name or get_device_name(safe_user_agent)

        # Check if session exists for this user+device
        session_record = db.query(SessionModel).filter(
            SessionModel.user_id == user.id,
            SessionModel.device_id == device_id
        ).first()

        if session_record:
            session_record.refresh_token_hash = hash_token(refresh_token)
            session_record.last_active = utcnow()
            session_record.expires_at = refresh_expires
            session_record.ip_address = safe_ip_address
            session_record.user_agent = safe_user_agent
            if device_name:
                session_record.device_name = device_display_name
            session_record.device_type = device_type
            # Update device_token if provided
            if device_token:
                session_record.device_token = device_token
            # Update geo info
            if geo_info:
                session_record.country = geo_info.get('country')
                session_record.city = geo_info.get('city')
            # Clear kicked status if re-logging in
            session_record.kicked_at = None
            session_record.kicked_reason = None
        else:
            session_record = SessionModel(
                user_id=user.id,
                device_id=device_id,
                device_name=device_display_name,
                device_type=device_type,
                device_token=device_token,
                refresh_token_hash=hash_token(refresh_token),
                ip_address=safe_ip_address,
                user_agent=safe_user_agent,
                expires_at=refresh_expires,
                country=geo_info.get('country') if geo_info else None,
                city=geo_info.get('city') if geo_info else None
            )
            db.add(session_record)

        # 记住该设备(与 session 存活解耦):下次登录不再判为新设备
        if device_token:
            known = db.query(KnownDevice).filter(
                KnownDevice.user_id == user.id,
                KnownDevice.device_token == device_token
            ).first()
            if known:
                known.last_seen = utcnow()
                known.ip_address = safe_ip_address
                if geo_info:
                    known.country = geo_info.get('country')
                    known.city = geo_info.get('city')
                if device_name:
                    known.device_name = device_display_name
            else:
                db.add(KnownDevice(
                    user_id=user.id,
                    device_token=device_token,
                    device_name=device_display_name,
                    device_type=device_type,
                    ip_address=safe_ip_address,
                    country=geo_info.get('country') if geo_info else None,
                    city=geo_info.get('city') if geo_info else None,
                ))

        db.commit()

        # Record login log
        AuthService.record_login_log(
            db,
            user=user,
            username=user.username,
            success=True,
            ip_address=safe_ip_address,
            user_agent=safe_user_agent,
            geo_info=geo_info,
            anomalies=anomalies,
            kicked_session_id=kicked_session.get('id') if kicked_session else None,
            session_id=session_record.id if session_record else None,
            login_method=login_method
        )

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "kicked_session": kicked_session,
            "is_suspicious": is_suspicious,
            "anomalies": anomalies
        }

    @staticmethod
    def create_restricted_access_token(
        user: User,
        client_id: str = "internal",
        scope: str = "profile email",
    ) -> Dict[str, Any]:
        """签发受限会话 token(跳过验证登录专用)。

        与 create_tokens 的区别(均为有意为之,勿"补齐"):
        - 只签发 access token,不签发 refresh token——受限会话不可续期,
          到期(RESTRICTED_ACCESS_TOKEN_EXPIRE_MINUTES,默认 5 分钟)即终止;
        - JWT payload 带 restricted=true claim,敏感端点由
          require_unrestricted 拒绝(改密/TOTP/删 passkey/会话吊销等);
        - 不创建 Token / Session / KnownDevice 记录——受限会话不占会话名额,
          也不把当前设备标记为已知设备(否则攻击者借 skip 洗白设备,
          下次登录风控降级为 NONE 即可拿到完整 token,受限防线形同虚设)。
        """
        token_data = {
            "sub": str(user.id),
            "scope": scope,
            "client_id": client_id,
            "restricted": True,
        }
        access_token = create_access_token(
            token_data,
            expires_delta=timedelta(minutes=settings.restricted_access_token_expire_minutes),
            token_version=user.token_version,
        )
        return {
            "access_token": access_token,
            "expires_in": settings.restricted_access_token_expire_minutes * 60,
        }

    @staticmethod
    def record_login_log(
        db: Session,
        user: Optional[User],
        username: str,
        success: bool,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        failure_reason: Optional[str] = None,
        geo_info: Optional[Dict[str, Any]] = None,
        anomalies: Optional[List[Dict[str, Any]]] = None,
        kicked_session_id: Optional[int] = None,
        session_id: Optional[int] = None,
        login_method: str = "password",
        is_suspicious: Optional[bool] = None
    ) -> LoginLog:
        """Record a login attempt in the log"""
        from app.utils.device import get_device_name, parse_device_type

        # Calculate is_suspicious if not explicitly provided
        if is_suspicious is None:
            is_suspicious = any(a.get('severity') in ('medium', 'high') for a in (anomalies or []))

        log = LoginLog(
            user_id=user.id if user else None,
            username=username,
            success=success,
            failure_reason=failure_reason,
            ip_address=ip_address,
            user_agent=user_agent,
            device_type=parse_device_type(user_agent or "unknown"),
            device_name=get_device_name(user_agent or "unknown"),
            country=geo_info.get('country') if geo_info else None,
            city=geo_info.get('city') if geo_info else None,
            latitude=geo_info.get('latitude') if geo_info else None,
            longitude=geo_info.get('longitude') if geo_info else None,
            is_suspicious=is_suspicious,
            suspicious_reasons=json.dumps(anomalies) if anomalies else None,
            kicked_session_id=kicked_session_id,
            session_id=session_id,
            login_method=login_method
        )
        db.add(log)
        db.commit()
        return log

    @staticmethod
    def refresh_access_token(
        db: Session,
        refresh_token: str,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None
    ) -> Optional[Tuple[str, str]]:
        """Refresh an access token using a refresh token"""
        # Decode refresh token
        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            return None
        device_id = payload.get("device_id")

        # 按 hash 取记录(不预过滤状态),三分支判定:
        # 不存在 → 过期/无效;revoked_at 非空 → 旧 token 重放,灭族;
        # 过期 → 自然失效;活跃 → 正常轮换
        token_hash_value = hash_token(refresh_token)
        token_record = db.query(Token).filter(
            Token.token_hash == token_hash_value,
            Token.type == 'refresh',
        ).first()

        if not token_record:
            return None

        # 重放检测(OAuth 2.1 BCP):已吊销的旧 token 再次出现 = 疑似被盗,
        # 吊销整个家族并联动过期其 session(被盗者与受害者都被迫重新认证)
        if token_record.revoked_at is not None:
            logger.warning(
                "refresh token replay detected: revoking family user=%s family=%s",
                token_record.user_id, token_record.family_id,
            )
            AuthService._revoke_token_family(db, token_record)
            return None

        if token_record.expires_at <= utcnow():
            return None

        # Ensure the refresh token is still bound to a valid client
        bound_client = token_record.client
        if not bound_client:
            return None

        # If caller provides client_id, require it to match the bound client
        if client_id and bound_client.client_id != client_id:
            return None

        # If caller provides client_secret, verify it against the bound client
        if client_secret and not verify_client_secret(client_secret, bound_client.client_secret_hash):
            return None

        # Get user
        user = token_record.user
        if not user or user.status != 'active':
            return None

        # Create new tokens
        token_data = {
            "sub": str(user.id),
            "scope": token_record.scope,
            "client_id": bound_client.client_id,
        }
        if device_id:
            token_data["device_id"] = device_id
        new_access_token = create_access_token(token_data, token_version=user.token_version)

        # 保持"记住我"的时限语义:原 token 剩余寿命超过普通时限时按 remember_me 轮换,
        # 避免勾选"记住我"(30 天)的用户一刷新就被降级为 7 天
        remember = (token_record.expires_at - utcnow()) > timedelta(
            days=settings.refresh_token_expire_days
        )
        new_refresh_token = create_refresh_token(token_data, remember)

        # Calculate new expiration
        refresh_expires = utcnow() + timedelta(
            days=settings.refresh_token_remember_me_days if remember
            else settings.refresh_token_expire_days
        )

        # 轮换:条件 UPDATE 原子抢占 revoked_at(参照 oauth_service.exchange_code
        # 的 code 抢占写法)。SELECT 检查与标记吊销之间不再有 TOCTOU 窗口——
        # 两个并发请求只有一个能抢占成功,失败方按重放处理走家族吊销,
        # 封死「家族分叉成两条活跃链、重放检测永不触发」的竞态绕过。
        # 存量无 family 的旧记录在此惰性回填新 family_id。
        import uuid
        family_id = token_record.family_id or str(uuid.uuid4())
        claimed = db.query(Token).filter(
            Token.id == token_record.id,
            Token.revoked_at.is_(None),
        ).update(
            {"revoked_at": utcnow(), "family_id": family_id},
            synchronize_session=False,
        )
        if not claimed:
            logger.warning(
                "refresh rotation race lost: treating as replay, revoking family user=%s token_id=%s",
                token_record.user_id, token_record.id,
            )
            # 抢占失败 = 并发方已抢先轮换/吊销(或行已被删除)。
            # 重新读取该行的当前状态拿权威 family_id,再灭族。
            current = db.query(Token).filter(
                Token.id == token_record.id
            ).populate_existing().first()
            if current is not None:
                AuthService._revoke_token_family(db, current)
            return None

        new_token_record = Token(
            token_hash=hash_token(new_refresh_token),
            type='refresh',
            user_id=user.id,
            client_id=token_record.client_id,
            scope=token_record.scope,
            family_id=family_id,
            expires_at=refresh_expires,
        )
        db.add(new_token_record)

        # Update session if exists
        session = db.query(SessionModel).filter(
            SessionModel.refresh_token_hash == token_hash_value
        ).first()
        if session:
            session.refresh_token_hash = hash_token(new_refresh_token)
            session.last_active = utcnow()
            session.expires_at = refresh_expires

        db.commit()
        return new_access_token, new_refresh_token

    @staticmethod
    def _revoke_token_family(db: Session, token_record: Token) -> None:
        """吊销整个 refresh token 家族(OAuth 2.1 BCP 重放响应)。

        删除该 family 全部 token(含未过期的),并联动过期挂在其中的 session。
        """
        family_id = token_record.family_id
        if not family_id:
            # 无家族的孤 token(极老记录):只删自身 + session
            db.delete(token_record)
            db.query(SessionModel).filter(
                SessionModel.refresh_token_hash == token_record.token_hash
            ).delete()
            db.commit()
            return

        family_hashes = [t.token_hash for t in db.query(Token).filter(
            Token.family_id == family_id
        ).all()]
        db.query(Token).filter(Token.family_id == family_id).delete()
        if family_hashes:
            db.query(SessionModel).filter(
                SessionModel.refresh_token_hash.in_(family_hashes)
            ).update({
                SessionModel.expires_at: utcnow(),
                SessionModel.kicked_at: utcnow(),
                SessionModel.kicked_reason: 'refresh_replay',
            }, synchronize_session=False)
        db.commit()

    @staticmethod
    def logout(db: Session, refresh_token: Optional[str]) -> bool:
        """Logout user by removing refresh token(整个家族)。

        登出应吊销该登录链路的全部 refresh token(含历史上已轮换的
        revoked 记录),不只是当前这枚——否则同 family 的在途 token
        仍可继续刷新。refresh_token 为空(cookie 形态登出且 body 未带)
        时静默成功。
        """
        if not refresh_token:
            return True

        token_hash_value = hash_token(refresh_token)
        token = db.query(Token).filter(
            Token.token_hash == token_hash_value,
            Token.type == 'refresh'
        ).first()

        if token:
            if token.family_id:
                # 整个家族(当前 + 历史轮换记录)全部移除,并联动过期 session
                AuthService._revoke_token_family(db, token)
            else:
                # 孤 token(极老记录)
                db.delete(token)
                db.query(SessionModel).filter(
                    SessionModel.refresh_token_hash == token_hash_value
                ).delete()
                db.commit()

        return True
