"""
Passkey/WebAuthn service for handling credential registration and authentication
"""

import json
import secrets
from datetime import timedelta
from typing import Optional, Tuple, List

from sqlalchemy.orm import Session
from app.utils.time import utcnow
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers.structs import (
    PublicKeyCredentialDescriptor,
    AuthenticatorTransport,
    UserVerificationRequirement,
    ResidentKeyRequirement,
    AuthenticatorSelectionCriteria,
)
from webauthn.helpers.cose import COSEAlgorithmIdentifier
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url

from app.models import User, Passkey, WebAuthnChallenge
from app.config import get_settings

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

        return json.loads(options_to_json(options))

    @staticmethod
    def verify_registration(
        db: Session,
        user: User,
        credential_data: dict,
        name: str
    ) -> Passkey:
        """
        Verify WebAuthn registration response and store credential.

        Args:
            db: Database session
            user: The authenticated user
            credential_data: The credential response from the client
            name: User-provided name for the passkey

        Returns:
            The created Passkey object

        Raises:
            ValueError: If verification fails
        """
        # Get and validate challenge
        challenge_record = db.query(WebAuthnChallenge).filter(
            WebAuthnChallenge.user_id == user.id,
            WebAuthnChallenge.type == 'registration',
            WebAuthnChallenge.expires_at > utcnow()
        ).first()

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
        passkey = Passkey(
            user_id=user.id,
            credential_id=bytes_to_base64url(verification.credential_id),
            public_key=bytes_to_base64url(verification.credential_public_key),
            name=name,
            sign_count=verification.sign_count,
            transports=transports_json,
            backup_eligible=getattr(verification, 'credential_backed_up', False),
            backup_state=getattr(verification, 'credential_backed_up', False),
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

        return json.loads(options_to_json(options))

    @staticmethod
    def verify_authentication(
        db: Session,
        credential_data: dict
    ) -> Tuple[User, Passkey]:
        """
        Verify WebAuthn authentication response.

        Args:
            db: Database session
            credential_data: The credential response from the client

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
        passkey = db.query(Passkey).filter(
            Passkey.credential_id == credential_id
        ).first()

        if not passkey:
            raise ValueError("Passkey not found")

        # Get user
        user = passkey.user
        if not user or user.status != 'active':
            raise ValueError("User not found or inactive")

        # Get and validate challenge
        challenge_record = db.query(WebAuthnChallenge).filter(
            WebAuthnChallenge.type == 'authentication',
            WebAuthnChallenge.expires_at > utcnow()
        ).order_by(WebAuthnChallenge.created_at.desc()).first()

        if not challenge_record:
            raise ValueError("Challenge expired or not found")

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
