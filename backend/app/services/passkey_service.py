"""
Passkey/WebAuthn service for handling credential registration and authentication
"""

import json
from datetime import timedelta
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.cose import COSEAlgorithmIdentifier
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import get_settings
from app.models import Passkey, User, WebAuthnChallenge
from app.utils.time import utcnow

settings = get_settings()


class PasskeyService:
    """Service for WebAuthn/Passkey operations"""

    @staticmethod
    def generate_registration_options(
        db: Session,
        user: User
    ) -> dict:
        """
        Generate WebAuthn registration options for a user.

        Args:
            db: Database session
            user: The authenticated user

        Returns:
            Registration options as a JSON-serializable dict

        Raises:
            ValueError: If non-admin user already has a passkey
        """
        # Check passkey limit for non-admin users
        existing_count = db.query(Passkey).filter(Passkey.user_id == user.id).count()
        is_admin = user.has_permission("admin.*") or user.has_role("admin")
        if not is_admin and existing_count >= 1:
            raise ValueError("非管理员用户最多只能绑定 1 个通行密钥")

        # Get existing credentials to exclude
        existing_passkeys = db.query(Passkey).filter(Passkey.user_id == user.id).all()
        exclude_credentials = []
        for passkey in existing_passkeys:
            transports = []
            if passkey.transports:
                try:
                    transport_list = json.loads(passkey.transports)
                    transports = [AuthenticatorTransport(t) for t in transport_list if t in [e.value for e in AuthenticatorTransport]]
                except (json.JSONDecodeError, ValueError):
                    pass
            exclude_credentials.append(
                PublicKeyCredentialDescriptor(
                    id=base64url_to_bytes(passkey.credential_id),
                    transports=transports if transports else None,
                )
            )

        # Generate options
        options = generate_registration_options(
            rp_id=settings.webauthn_rp_id,
            rp_name=settings.webauthn_rp_name,
            user_id=str(user.id).encode(),
            user_name=user.username,
            user_display_name=user.username,
            exclude_credentials=exclude_credentials if exclude_credentials else None,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.PREFERRED,
            ),
            supported_pub_key_algs=[
                COSEAlgorithmIdentifier.ECDSA_SHA_256,
                COSEAlgorithmIdentifier.RSASSA_PKCS1_v1_5_SHA_256,
            ],
        )

        # Store challenge
        challenge_b64 = bytes_to_base64url(options.challenge)
        expires_at = utcnow() + timedelta(seconds=settings.webauthn_challenge_timeout_seconds)

        # Clean up old challenges for this user
        db.query(WebAuthnChallenge).filter(
            WebAuthnChallenge.user_id == user.id,
            WebAuthnChallenge.type == 'registration'
        ).delete()

        challenge_record = WebAuthnChallenge(
            challenge=challenge_b64,
            type='registration',
            user_id=user.id,
            expires_at=expires_at
        )
        db.add(challenge_record)
        db.commit()

        result = json.loads(options_to_json(options))
        # challenge 绑定:verify 请求回传该 id,按 id+user 精确取对应 challenge
        # (浏览器端 parseRegistrationOptions 透传未知字段,不影响 WebAuthn 仪式)
        result['challenge_id'] = challenge_record.id
        return result

    @staticmethod
    def verify_registration(
        db: Session,
        user: User,
        credential_data: dict,
        name: str,
        challenge_id: Optional[int] = None
    ) -> Passkey:
        """
        Verify WebAuthn registration response and store credential.

        Args:
            db: Database session
            user: The authenticated user
            credential_data: The credential response from the client
            name: User-provided name for the passkey
            challenge_id: options 响应回传的 challenge 记录 id;
                提供时按 id+user 精确匹配(并发注册互不干扰)。

        Returns:
            The created Passkey object

        Raises:
            ValueError: If verification fails
        """
        # Get and validate challenge
        # 注册是已认证端点且 challenge 绑定 user_id,风险低于匿名认证流程;
        # 未回传 challenge_id 时保持「取该用户最新一条」的旧行为以兼容。
        challenge_filters = [
            WebAuthnChallenge.type == 'registration',
            WebAuthnChallenge.user_id == user.id,
            WebAuthnChallenge.expires_at > utcnow(),
        ]
        if challenge_id is not None:
            challenge_filters.append(WebAuthnChallenge.id == challenge_id)
        challenge_record = db.query(WebAuthnChallenge).filter(*challenge_filters).first()

        if not challenge_record:
            raise ValueError("Challenge expired or not found")

        expected_challenge = base64url_to_bytes(challenge_record.challenge)

        # Verify registration - new webauthn accepts dict directly
        try:
            verification = verify_registration_response(
                credential=credential_data,
                expected_challenge=expected_challenge,
                expected_rp_id=settings.webauthn_rp_id,
                expected_origin=settings.webauthn_rp_origin,
                require_user_verification=False,
            )
        except Exception as e:
            raise ValueError(f"Registration verification failed: {e}")

        # Delete used challenge
        db.delete(challenge_record)

        # Extract transports from credential response if available
        transports_json = None
        response_data = credential_data.get('response', {})
        if 'transports' in response_data:
            transports_json = json.dumps(response_data['transports'])

        # Create passkey record
        # backup_eligible: authenticator 是否支持多设备同步(credential_device_type == multiDevice)
        # backup_state:   当前凭据是否已同步备份(credential_backed_up)
        passkey = Passkey(
            user_id=user.id,
            credential_id=bytes_to_base64url(verification.credential_id),
            public_key=bytes_to_base64url(verification.credential_public_key),
            name=name,
            sign_count=verification.sign_count,
            transports=transports_json,
            backup_eligible=(
                getattr(verification, 'credential_device_type', None) == 'multiDevice'
            ),
            backup_state=bool(getattr(verification, 'credential_backed_up', False)),
            aaguid=str(verification.aaguid) if verification.aaguid else None,
        )
        db.add(passkey)
        db.commit()
        db.refresh(passkey)

        return passkey

    @staticmethod
    def generate_authentication_options(
        db: Session,
        username: Optional[str] = None
    ) -> dict:
        """
        Generate WebAuthn authentication options.

        Args:
            db: Database session
            username: Optional username to limit to specific user's credentials

        Returns:
            Authentication options as a JSON-serializable dict
        """
        allow_credentials = []
        user_id = None

        if username:
            # Get user's credentials
            user = db.query(User).filter(User.username == username).first()
            if user:
                user_id = user.id
                passkeys = db.query(Passkey).filter(Passkey.user_id == user.id).all()
                for passkey in passkeys:
                    transports = []
                    if passkey.transports:
                        try:
                            transport_list = json.loads(passkey.transports)
                            transports = [AuthenticatorTransport(t) for t in transport_list if t in [e.value for e in AuthenticatorTransport]]
                        except (json.JSONDecodeError, ValueError):
                            pass
                    allow_credentials.append(
                        PublicKeyCredentialDescriptor(
                            id=base64url_to_bytes(passkey.credential_id),
                            transports=transports if transports else None,
                        )
                    )

        # Generate options
        options = generate_authentication_options(
            rp_id=settings.webauthn_rp_id,
            allow_credentials=allow_credentials if allow_credentials else None,
            user_verification=UserVerificationRequirement.PREFERRED,
        )

        # Store challenge
        challenge_b64 = bytes_to_base64url(options.challenge)
        expires_at = utcnow() + timedelta(seconds=settings.webauthn_challenge_timeout_seconds)

        challenge_record = WebAuthnChallenge(
            challenge=challenge_b64,
            type='authentication',
            user_id=user_id,
            expires_at=expires_at
        )
        db.add(challenge_record)
        db.commit()

        result = json.loads(options_to_json(options))
        # challenge 绑定:verify 请求必须回传该 id,按 id 精确取对应 challenge。
        # 此前按「最新一条」匹配,攻击者高频刷 options 可不断刷新 challenge,
        # 让受害者的 passkey 登录持续 DoS。
        result['challenge_id'] = challenge_record.id
        return result

    @staticmethod
    def verify_authentication(
        db: Session,
        credential_data: dict,
        challenge_id: Optional[int] = None
    ) -> Tuple[User, Passkey]:
        """
        Verify WebAuthn authentication response.

        Args:
            db: Database session
            credential_data: The credential response from the client
            challenge_id: options 响应回传的 challenge 记录 id(必填;
                未回传直接拒绝——「取最新一条」的兜底会重新打开 DoS 窗口)

        Returns:
            Tuple of (User, Passkey) on success

        Raises:
            ValueError: If verification fails
        """
        # Parse credential to get credential ID
        credential_id = credential_data.get('id')
        if not credential_id:
            raise ValueError("Missing credential ID")

        # Find passkey by credential ID
        # (discoverable 流程不带 username,验证前无法得知用户——
        #  从 credential 反查 passkey → user)
        passkey = db.query(Passkey).filter(
            Passkey.credential_id == credential_id
        ).first()

        if not passkey:
            raise ValueError("Passkey not found")

        # Get user
        user = passkey.user
        if not user or user.status != 'active':
            raise ValueError("User not found or inactive")

        # Get and validate challenge:按回传的 challenge_id 精确取对应记录。
        # 攻击者刷 options 只会新增记录,无法顶掉受害者持有的 challenge;
        # challenge 单次消费,验证成功即删除。
        if challenge_id is None:
            raise ValueError("缺少 challenge_id")
        challenge_record = db.query(WebAuthnChallenge).filter(
            WebAuthnChallenge.id == challenge_id,
            WebAuthnChallenge.type == 'authentication',
            WebAuthnChallenge.expires_at > utcnow()
        ).first()

        if not challenge_record:
            raise ValueError("Challenge expired or not found")

        # challenge 与用户绑定:带 username 的认证 challenge 已绑定 user_id;
        # discoverable(不带 username)的 challenge 不绑用户(user_id 为 NULL),
        # 验证后从 credential 反查用户——两种情况都放行,其余拒绝。
        if challenge_record.user_id is not None and challenge_record.user_id != passkey.user_id:
            raise ValueError("Challenge does not match user")

        expected_challenge = base64url_to_bytes(challenge_record.challenge)

        # Verify authentication - new webauthn accepts dict directly
        try:
            verification = verify_authentication_response(
                credential=credential_data,
                expected_challenge=expected_challenge,
                expected_rp_id=settings.webauthn_rp_id,
                expected_origin=settings.webauthn_rp_origin,
                credential_public_key=base64url_to_bytes(passkey.public_key),
                credential_current_sign_count=passkey.sign_count,
                require_user_verification=False,
            )
        except Exception as e:
            raise ValueError(f"Authentication verification failed: {e}")

        # Delete used challenge
        db.delete(challenge_record)

        # Update passkey sign count and last used
        passkey.sign_count = verification.new_sign_count
        passkey.last_used_at = utcnow()

        db.commit()

        return user, passkey

    @staticmethod
    def list_passkeys(db: Session, user: User) -> List[Passkey]:
        """List all passkeys for a user"""
        return db.query(Passkey).filter(Passkey.user_id == user.id).all()

    @staticmethod
    def get_passkey(db: Session, passkey_id: int, user: User) -> Optional[Passkey]:
        """Get a specific passkey"""
        return db.query(Passkey).filter(
            Passkey.id == passkey_id,
            Passkey.user_id == user.id
        ).first()

    @staticmethod
    def update_passkey(db: Session, passkey: Passkey, name: str) -> Passkey:
        """Update passkey name"""
        passkey.name = name
        db.commit()
        db.refresh(passkey)
        return passkey

    @staticmethod
    def delete_passkey(db: Session, passkey: Passkey) -> None:
        """Delete a passkey"""
        db.delete(passkey)
        db.commit()

    @staticmethod
    def user_has_passkeys(db: Session, username: str) -> bool:
        """Check if a user has any passkeys registered"""
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return False
        count = db.query(Passkey).filter(Passkey.user_id == user.id).count()
        return count > 0

    @staticmethod
    def cleanup_expired_challenges(db: Session) -> int:
        """Clean up expired challenges"""
        result = db.query(WebAuthnChallenge).filter(
            WebAuthnChallenge.expires_at < utcnow()
        ).delete()
        db.commit()
        return result
