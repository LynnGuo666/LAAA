"""
Risk Assessment Service

Calculates risk scores based on login anomalies and determines verification requirements.
"""

import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User, Session as UserSession, LoginLog

settings = get_settings()
logger = logging.getLogger(__name__)


class AnomalyType(str, Enum):
    """Types of login anomalies with their risk scores"""
    NEW_DEVICE = "new_device"  # Score: 1
    IP_CHANGE = "ip_change"  # Score: 2
    HIGH_VELOCITY = "high_velocity"  # Score: 2
    MAX_DEVICES = "max_devices"  # Score: 2
    GEO_JUMP = "geo_jump"  # Score: 3
    NEW_COUNTRY = "new_country"  # Score: 3


# Risk scores for each anomaly type
ANOMALY_SCORES = {
    AnomalyType.NEW_DEVICE: 1,
    AnomalyType.IP_CHANGE: 2,
    AnomalyType.HIGH_VELOCITY: 2,
    AnomalyType.MAX_DEVICES: 2,
    AnomalyType.GEO_JUMP: 3,
    AnomalyType.NEW_COUNTRY: 3,
}

# Human-readable anomaly messages
ANOMALY_MESSAGES = {
    AnomalyType.NEW_DEVICE: "新设备登录",
    AnomalyType.IP_CHANGE: "IP 地址变化",
    AnomalyType.HIGH_VELOCITY: "登录频率异常",
    AnomalyType.MAX_DEVICES: "已达到最大设备数限制",
    AnomalyType.GEO_JUMP: "地理位置跳跃",
    AnomalyType.NEW_COUNTRY: "新设备来自不同国家",
}


class RiskLevel(str, Enum):
    """Risk levels based on total score"""
    NONE = "none"  # Score: 0
    LOW = "low"  # Score: 1-2
    MEDIUM = "medium"  # Score: 3-4
    HIGH = "high"  # Score: 5+


class VerificationMethod(str, Enum):
    """Available verification methods"""
    EMAIL_CODE = "email_code"
    MAGIC_LINK = "magic_link"
    TOTP = "totp"
    PASSKEY = "passkey"


class MethodStrength(str, Enum):
    """Verification method strength"""
    STANDARD = "standard"
    STRONG = "strong"


# Method strength mapping
METHOD_STRENGTHS = {
    VerificationMethod.EMAIL_CODE: MethodStrength.STANDARD,
    VerificationMethod.MAGIC_LINK: MethodStrength.STANDARD,
    VerificationMethod.TOTP: MethodStrength.STRONG,
    VerificationMethod.PASSKEY: MethodStrength.STRONG,
}


@dataclass
class Anomaly:
    """Represents a detected anomaly"""
    type: AnomalyType
    score: int
    message: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "score": self.score,
            "message": self.message,
        }


@dataclass
class RiskAssessment:
    """Result of risk assessment"""
    anomalies: List[Anomaly]
    risk_score: int
    risk_level: RiskLevel
    required_verifications: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "anomalies": [a.to_dict() for a in self.anomalies],
            "risk_score": self.risk_score,
            "risk_level": self.risk_level.value,
            "required_verifications": self.required_verifications,
        }


class RiskService:
    """Service for calculating login risk and determining verification requirements"""

    @staticmethod
    def calculate_risk_score(anomalies: List[Anomaly]) -> int:
        """Calculate total risk score from anomalies"""
        return sum(a.score for a in anomalies)

    @staticmethod
    def get_risk_level(score: int) -> RiskLevel:
        """Determine risk level based on score"""
        if score == 0:
            return RiskLevel.NONE
        elif score <= 2:
            return RiskLevel.LOW
        elif score <= 4:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.HIGH

    @staticmethod
    def get_required_verifications(risk_level: RiskLevel) -> int:
        """Get number of verifications required based on risk level"""
        if risk_level == RiskLevel.NONE:
            return 0
        elif risk_level == RiskLevel.LOW:
            return 1
        else:  # MEDIUM or HIGH
            return 2

    @staticmethod
    def is_known_city(db: Session, user_id: int, city: Optional[str]) -> bool:
        """Check if the user has logged in from this city before"""
        if not city:
            return False

        # Check login logs for this city
        existing = db.query(LoginLog).filter(
            LoginLog.user_id == user_id,
            LoginLog.city == city,
            LoginLog.success == True
        ).first()

        return existing is not None

    @staticmethod
    def is_known_device_token(db: Session, user_id: int, device_token: Optional[str]) -> bool:
        """Check if the device token is known for this user"""
        if not device_token:
            return False

        # Check sessions for this device token
        existing = db.query(UserSession).filter(
            UserSession.user_id == user_id,
            UserSession.device_token == device_token,
            UserSession.kicked_at == None
        ).first()

        return existing is not None

    @staticmethod
    def check_max_devices(db: Session, user: User) -> bool:
        """Check if user has reached maximum device limit"""
        active_sessions = db.query(UserSession).filter(
            UserSession.user_id == user.id,
            UserSession.kicked_at == None
        ).count()

        return active_sessions >= user.max_sessions

    @staticmethod
    def get_user_countries(db: Session, user_id: int) -> List[str]:
        """Get list of countries user has logged in from"""
        logs = db.query(LoginLog.country).filter(
            LoginLog.user_id == user_id,
            LoginLog.success == True,
            LoginLog.country != None
        ).distinct().all()

        return [log[0] for log in logs if log[0]]

    @staticmethod
    def assess_password_login_risk(
        db: Session,
        user: User,
        ip_address: Optional[str],
        city: Optional[str],
        country: Optional[str],
        device_token: Optional[str],
        existing_anomalies: Optional[List[Dict[str, Any]]] = None
    ) -> RiskAssessment:
        """
        Assess risk for password login.

        Args:
            db: Database session
            user: User attempting to log in
            ip_address: Client IP address
            city: City from GeoIP
            country: Country from GeoIP
            device_token: Device token from client
            existing_anomalies: Pre-calculated anomalies from anomaly detection service

        Returns:
            RiskAssessment with anomalies, score, level, and required verifications
        """
        anomalies = []

        # Convert existing anomalies to Anomaly objects
        if existing_anomalies:
            for ea in existing_anomalies:
                anomaly_type = ea.get("type")
                if anomaly_type and anomaly_type in [e.value for e in AnomalyType]:
                    at = AnomalyType(anomaly_type)
                    anomalies.append(Anomaly(
                        type=at,
                        score=ANOMALY_SCORES[at],
                        message=ea.get("message", ANOMALY_MESSAGES[at])
                    ))

        # Check for new device (if device_token provided)
        is_new_device = not RiskService.is_known_device_token(db, user.id, device_token)
        if is_new_device and not any(a.type == AnomalyType.NEW_DEVICE for a in anomalies):
            anomalies.append(Anomaly(
                type=AnomalyType.NEW_DEVICE,
                score=ANOMALY_SCORES[AnomalyType.NEW_DEVICE],
                message=ANOMALY_MESSAGES[AnomalyType.NEW_DEVICE]
            ))

        # Check for max devices
        if RiskService.check_max_devices(db, user) and not any(a.type == AnomalyType.MAX_DEVICES for a in anomalies):
            anomalies.append(Anomaly(
                type=AnomalyType.MAX_DEVICES,
                score=ANOMALY_SCORES[AnomalyType.MAX_DEVICES],
                message=ANOMALY_MESSAGES[AnomalyType.MAX_DEVICES]
            ))

        # Check for new country (only if it's a new device)
        if is_new_device and country:
            known_countries = RiskService.get_user_countries(db, user.id)
            if known_countries and country not in known_countries:
                if not any(a.type == AnomalyType.NEW_COUNTRY for a in anomalies):
                    anomalies.append(Anomaly(
                        type=AnomalyType.NEW_COUNTRY,
                        score=ANOMALY_SCORES[AnomalyType.NEW_COUNTRY],
                        message=ANOMALY_MESSAGES[AnomalyType.NEW_COUNTRY]
                    ))

        # Calculate risk
        risk_score = RiskService.calculate_risk_score(anomalies)
        risk_level = RiskService.get_risk_level(risk_score)
        required_verifications = RiskService.get_required_verifications(risk_level)

        return RiskAssessment(
            anomalies=anomalies,
            risk_score=risk_score,
            risk_level=risk_level,
            required_verifications=required_verifications
        )

    @staticmethod
    def assess_passkey_login_risk(
        db: Session,
        user: User,
        city: Optional[str],
        device_token: Optional[str]
    ) -> RiskAssessment:
        """
        Assess risk for passkey login.
        Passkey is already strong auth, but we still check for unknown IP/device.

        Returns:
            RiskAssessment (typically lower scores than password login)
        """
        anomalies = []

        # Check if city is known
        is_known_city = RiskService.is_known_city(db, user.id, city)
        is_known_device = RiskService.is_known_device_token(db, user.id, device_token)

        # Risk matrix for passkey:
        # Known IP + Known device = 0
        # Known IP + New device = 1
        # New IP + Known device = 2
        # New IP + New device = 3

        if not is_known_device:
            anomalies.append(Anomaly(
                type=AnomalyType.NEW_DEVICE,
                score=1,  # Lower score for passkey
                message=ANOMALY_MESSAGES[AnomalyType.NEW_DEVICE]
            ))

        if not is_known_city:
            anomalies.append(Anomaly(
                type=AnomalyType.IP_CHANGE,
                score=2,  # Score 2 for new city
                message="新城市登录"
            ))

        risk_score = RiskService.calculate_risk_score(anomalies)
        risk_level = RiskService.get_risk_level(risk_score)
        required_verifications = RiskService.get_required_verifications(risk_level)

        return RiskAssessment(
            anomalies=anomalies,
            risk_score=risk_score,
            risk_level=risk_level,
            required_verifications=required_verifications
        )

    @staticmethod
    def get_available_methods(
        user: User,
        risk_level: RiskLevel,
        completed_methods: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Get available verification methods based on risk level and user capabilities.

        Args:
            user: User object
            risk_level: Current risk level
            completed_methods: Methods already used (to exclude)

        Returns:
            List of available methods with their properties
        """
        completed = set(completed_methods or [])
        methods = []

        # Check if user has TOTP enabled
        has_totp = user.totp is not None and user.totp.is_enabled

        # Check if user has passkeys
        has_passkey = len(user.passkeys) > 0

        # High risk only allows strong methods
        is_high_risk = risk_level == RiskLevel.HIGH

        # Add standard methods (only if not high risk)
        if not is_high_risk:
            if VerificationMethod.EMAIL_CODE.value not in completed:
                methods.append({
                    "method": VerificationMethod.EMAIL_CODE.value,
                    "strength": MethodStrength.STANDARD.value,
                    "available": True,
                })
            if VerificationMethod.MAGIC_LINK.value not in completed:
                methods.append({
                    "method": VerificationMethod.MAGIC_LINK.value,
                    "strength": MethodStrength.STANDARD.value,
                    "available": True,
                })

        # Add TOTP if enabled
        if VerificationMethod.TOTP.value not in completed:
            methods.append({
                "method": VerificationMethod.TOTP.value,
                "strength": MethodStrength.STRONG.value,
                "available": has_totp,
            })

        # Add Passkey if available
        if VerificationMethod.PASSKEY.value not in completed:
            methods.append({
                "method": VerificationMethod.PASSKEY.value,
                "strength": MethodStrength.STRONG.value,
                "available": has_passkey,
            })

        return methods

    @staticmethod
    def mask_email(email: str) -> str:
        """Mask email for display (e.g., u***@example.com)"""
        if not email or "@" not in email:
            return "***@***.***"

        local, domain = email.split("@", 1)
        if len(local) <= 1:
            masked_local = "*"
        else:
            masked_local = local[0] + "***"

        return f"{masked_local}@{domain}"
