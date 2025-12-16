"""
GeoIP Service - IP geolocation using MaxMind GeoLite2 database

This service provides IP-to-location lookup functionality using a local
MaxMind GeoLite2-City database for fast, unlimited queries.

For Chinese IPs, it can optionally use GeoIP2-CN database for better
province-level accuracy.

Requirements:
- pip install geoip2
- Download GeoLite2-City.mmdb from https://www.maxmind.com (free registration required)
- (Optional) Download GeoIP2-CN Country.mmdb from https://github.com/Hackl0us/GeoIP2-CN
"""

from typing import Optional, Dict, Any
from app.config import get_settings
import os

settings = get_settings()

# Lazy-loaded geoip2 readers
_geoip_reader = None
_geoip_cn_reader = None


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


def _get_cn_reader():
    """Get or create the GeoIP2-CN database reader for Chinese IPs"""
    global _geoip_cn_reader

    if _geoip_cn_reader is not None:
        return _geoip_cn_reader

    if not settings.geoip_enabled:
        return None

    # Try to find GeoIP2-CN database
    cn_db_path = getattr(settings, 'geoip_cn_database_path', None)
    if not cn_db_path:
        # Default path
        base_dir = os.path.dirname(settings.geoip_database_path)
        cn_db_path = os.path.join(base_dir, 'GeoIP2-CN.mmdb')

    if not os.path.exists(cn_db_path):
        return None

    try:
        import geoip2.database
        _geoip_cn_reader = geoip2.database.Reader(cn_db_path)
        print(f"GeoIP2-CN database loaded from {cn_db_path}")
        return _geoip_cn_reader
    except Exception as e:
        print(f"Failed to load GeoIP2-CN database: {e}")
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
                "city": "北京",  # For CN IPs, this may be province from GeoIP2-CN
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
            country_code = None
            city = None

            if response.country.names:
                country = response.country.names.get('zh-CN') or response.country.names.get('en') or response.country.name
            country_code = response.country.iso_code

            # For Chinese IPs, prefer GeoIP2-CN database for better province accuracy
            if country_code == 'CN':
                cn_reader = _get_cn_reader()
                if cn_reader:
                    try:
                        cn_response = cn_reader.country(ip_address)
                        # GeoIP2-CN stores province in city.names
                        if hasattr(cn_response, 'city') and cn_response.city.names:
                            city = cn_response.city.names.get('zh-CN') or cn_response.city.names.get('en')
                        # Some versions store it differently, try subdivisions
                        if not city and hasattr(cn_response, 'subdivisions') and cn_response.subdivisions:
                            city = cn_response.subdivisions.most_specific.names.get('zh-CN')
                    except Exception:
                        pass

            # Fall back to main database for city info
            if not city and response.city.names:
                city = response.city.names.get('zh-CN') or response.city.names.get('en') or response.city.name

            # Still no city? Try subdivisions from main database
            if not city and response.subdivisions:
                city = response.subdivisions.most_specific.names.get('zh-CN') if response.subdivisions.most_specific.names else None

            return {
                "country": country,
                "country_code": country_code,
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
    def is_cn_available() -> bool:
        """Check if GeoIP2-CN database is available"""
        return _get_cn_reader() is not None

    @staticmethod
    def close():
        """Close the GeoIP database readers"""
        global _geoip_reader, _geoip_cn_reader
        if _geoip_reader is not None:
            _geoip_reader.close()
            _geoip_reader = None
        if _geoip_cn_reader is not None:
            _geoip_cn_reader.close()
            _geoip_cn_reader = None
