"""
GeoIP Service - IP geolocation using MaxMind GeoLite2 database

This service provides IP-to-location lookup functionality using a local
MaxMind GeoLite2-City database for fast, unlimited queries.

Requirements:
- pip install geoip2
- Download GeoLite2-City.mmdb from https://www.maxmind.com (free registration required)
"""

from typing import Optional, Dict, Any
from app.config import get_settings
import os

settings = get_settings()

# Lazy-loaded geoip2 reader
_geoip_reader = None


def _get_reader():
    """Get or create the GeoIP database reader (lazy initialization)"""
    global _geoip_reader

    if _geoip_reader is not None:
        return _geoip_reader

    if not settings.geoip_enabled:
        return None

    db_path = settings.geoip_database_path
    if not os.path.exists(db_path):
        print(f"GeoIP database not found at {db_path}")
        return None

    try:
        import geoip2.database
        _geoip_reader = geoip2.database.Reader(db_path)
        return _geoip_reader
    except ImportError:
        print("geoip2 library not installed. Run: pip install geoip2")
        return None
    except Exception as e:
        print(f"Failed to load GeoIP database: {e}")
        return None


class GeoIPService:
    """Service for IP geolocation lookups"""

    @staticmethod
    def get_location(ip_address: str) -> Optional[Dict[str, Any]]:
        """
        Get geographic location for an IP address.

        Args:
            ip_address: The IP address to look up

        Returns:
            Dictionary with location info, or None if lookup fails:
            {
                "country": "中国",
                "city": "杭州",
                "latitude": "30.2936",
                "longitude": "120.1614"
            }
        """
        if not ip_address:
            return None

        # Skip private/local IP addresses
        if ip_address in ('127.0.0.1', 'localhost', '::1') or ip_address.startswith('192.168.') or ip_address.startswith('10.') or ip_address.startswith('172.'):
            return None

        reader = _get_reader()
        if reader is None:
            return None

        try:
            response = reader.city(ip_address)

            # Try to get Chinese names first, fall back to English
            country = None
            city = None

            if response.country.names:
                country = response.country.names.get('zh-CN') or response.country.names.get('en') or response.country.name

            if response.city.names:
                city = response.city.names.get('zh-CN') or response.city.names.get('en') or response.city.name

            return {
                "country": country,
                "city": city,
                "latitude": str(response.location.latitude) if response.location.latitude else None,
                "longitude": str(response.location.longitude) if response.location.longitude else None,
            }
        except Exception:
            # IP not found in database or other error
            return None

    @staticmethod
    def is_available() -> bool:
        """Check if GeoIP service is available and properly configured"""
        return _get_reader() is not None

    @staticmethod
    def close():
        """Close the GeoIP database reader"""
        global _geoip_reader
        if _geoip_reader is not None:
            _geoip_reader.close()
            _geoip_reader = None
