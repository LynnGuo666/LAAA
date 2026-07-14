"""
Login Anomaly Detection Service

This service detects suspicious login patterns to identify potential
account sharing or unauthorized access attempts.

Detection rules:
1. IP change detection - Different IP within time window
2. Geographic jump detection - Impossible travel (large distance in short time)
3. Login velocity - Too many login attempts in short time
4. New device detection - Login from never-seen-before device
"""

from datetime import timedelta
from math import atan2, cos, radians, sin, sqrt
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import LoginLog, User
from app.models import Session as SessionModel
from app.utils.time import utcnow

settings = get_settings()


class LoginAnomalyService:
    """Service for detecting login anomalies"""

    @staticmethod
    def check_anomalies(
        db: Session,
        user: User,
        ip_address: str,
        user_agent: str,
        geo_info: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Check for login anomalies.

        Args:
            db: Database session
            user: The user logging in
            ip_address: Current login IP
            user_agent: Current user agent
            geo_info: Geographic info from GeoIP service

        Returns:
            List of detected anomalies:
            [
                {
                    "type": "ip_change" | "geo_jump" | "high_velocity" | "new_device",
                    "message": "Human readable message",
                    "severity": "low" | "medium" | "high",
                    "data": {...}  # Additional context
                }
            ]
        """
        if not settings.enable_login_anomaly_detection:
            return []

        anomalies = []

        # 1. Check for IP address change
        ip_anomaly = LoginAnomalyService._check_ip_change(db, user, ip_address)
        if ip_anomaly:
            anomalies.append(ip_anomaly)

        # 2. Check for geographic jump (impossible travel)
        if geo_info and geo_info.get('latitude') and geo_info.get('longitude'):
            geo_anomaly = LoginAnomalyService._check_geo_jump(db, user, geo_info)
            if geo_anomaly:
                anomalies.append(geo_anomaly)

        # 3. Check login velocity (frequency)
        velocity_anomaly = LoginAnomalyService._check_login_velocity(db, user)
        if velocity_anomaly:
            anomalies.append(velocity_anomaly)

        # 4. Check for new device
        new_device = LoginAnomalyService._check_new_device(db, user, user_agent, ip_address)
        if new_device:
            anomalies.append(new_device)

        return anomalies

    @staticmethod
    def _check_ip_change(
        db: Session,
        user: User,
        current_ip: str
    ) -> Optional[Dict[str, Any]]:
        """Check if IP changed significantly within the time window"""
        time_window = utcnow() - timedelta(hours=settings.suspicious_ip_change_hours)

        # Get recent successful logins
        recent_logins = db.query(LoginLog).filter(
            LoginLog.user_id == user.id,
            LoginLog.success == True,
            LoginLog.created_at > time_window,
            LoginLog.ip_address.isnot(None)
        ).order_by(LoginLog.created_at.desc()).limit(5).all()

        if not recent_logins:
            return None

        # Check if current IP is different from all recent IPs
        recent_ips = {log.ip_address for log in recent_logins}

        if current_ip not in recent_ips and len(recent_ips) > 0:
            previous_ip = recent_logins[0].ip_address
            return {
                "type": "ip_change",
                "message": f"IP 地址变化：{previous_ip} → {current_ip}",
                "severity": "medium",
                "data": {
                    "previous_ip": previous_ip,
                    "current_ip": current_ip,
                    "recent_ips": list(recent_ips)
                }
            }

        return None

    @staticmethod
    def _check_geo_jump(
        db: Session,
        user: User,
        current_geo: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Check for impossible geographic travel"""
        time_window = utcnow() - timedelta(hours=settings.suspicious_ip_change_hours)

        # Get last login with location data
        last_login = db.query(LoginLog).filter(
            LoginLog.user_id == user.id,
            LoginLog.success == True,
            LoginLog.latitude.isnot(None),
            LoginLog.longitude.isnot(None),
            LoginLog.created_at > time_window
        ).order_by(LoginLog.created_at.desc()).first()

        if not last_login:
            return None

        try:
            # Calculate distance between locations
            distance = LoginAnomalyService._haversine_distance(
                float(last_login.latitude), float(last_login.longitude),
                float(current_geo['latitude']), float(current_geo['longitude'])
            )

            if distance > settings.suspicious_location_distance_km:
                return {
                    "type": "geo_jump",
                    "message": f"检测到地理位置跳跃：{last_login.city or '未知'} → {current_geo.get('city', '未知')}（{int(distance)} km）",
                    "severity": "high",
                    "data": {
                        "previous_location": {
                            "city": last_login.city,
                            "country": last_login.country,
                            "latitude": last_login.latitude,
                            "longitude": last_login.longitude
                        },
                        "current_location": current_geo,
                        "distance_km": int(distance)
                    }
                }
        except (ValueError, TypeError):
            pass

        return None

    @staticmethod
    def _check_login_velocity(
        db: Session,
        user: User
    ) -> Optional[Dict[str, Any]]:
        """Check for excessive login frequency"""
        time_window = utcnow() - timedelta(minutes=settings.suspicious_login_velocity_minutes)

        # Count recent login attempts (both success and failure)
        recent_attempts = db.query(LoginLog).filter(
            LoginLog.user_id == user.id,
            LoginLog.created_at > time_window
        ).count()

        if recent_attempts >= settings.suspicious_login_velocity_count:
            return {
                "type": "high_velocity",
                "message": f"登录频率异常：{recent_attempts} 次/{settings.suspicious_login_velocity_minutes}分钟",
                "severity": "medium",
                "data": {
                    "attempts": recent_attempts,
                    "window_minutes": settings.suspicious_login_velocity_minutes,
                    "threshold": settings.suspicious_login_velocity_count
                }
            }

        return None

    @staticmethod
    def _check_new_device(
        db: Session,
        user: User,
        user_agent: str,
        ip_address: str
    ) -> Optional[Dict[str, Any]]:
        """Check if this is a new device that has never logged in before"""
        # Check if there's any previous successful login with this user agent
        existing_login = db.query(LoginLog).filter(
            LoginLog.user_id == user.id,
            LoginLog.success == True,
            LoginLog.user_agent == user_agent
        ).first()

        if not existing_login:
            # Also check sessions for the same user agent pattern
            existing_session = db.query(SessionModel).filter(
                SessionModel.user_id == user.id,
                SessionModel.user_agent == user_agent
            ).first()

            if not existing_session:
                return {
                    "type": "new_device",
                    "message": "检测到新设备登录",
                    "severity": "low",
                    "data": {
                        "user_agent": user_agent,
                        "ip_address": ip_address
                    }
                }

        return None

    @staticmethod
    def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """
        Calculate the great-circle distance between two points on Earth.

        Uses the Haversine formula.

        Args:
            lat1, lon1: First point coordinates (degrees)
            lat2, lon2: Second point coordinates (degrees)

        Returns:
            Distance in kilometers
        """
        R = 6371  # Earth's radius in kilometers

        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
        c = 2 * atan2(sqrt(a), sqrt(1 - a))

        return R * c

    @staticmethod
    def is_suspicious(anomalies: List[Dict[str, Any]]) -> bool:
        """Check if any anomaly has medium or high severity"""
        return any(a["severity"] in ("medium", "high") for a in anomalies)
