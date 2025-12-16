"""
GeoIP Service - IP geolocation using MaxMind GeoLite2 database and ip2region

This service provides IP-to-location lookup functionality using:
1. MaxMind GeoLite2-City database for international IPs
2. ip2region database for accurate Chinese IP province/city lookup

Requirements:
- pip install geoip2 xdbSearcher
- Download GeoLite2-City.mmdb from https://www.maxmind.com (free registration required)
- Download ip2region.xdb from https://github.com/lionsoul2014/ip2region
"""

from typing import Optional, Dict, Any
from app.config import get_settings
import os

settings = get_settings()

# Lazy-loaded readers
_geoip_reader = None
_geoip_cn_reader = None
_ip2region_searcher = None


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


def _get_ip2region_searcher():
    """Get or create the ip2region searcher for Chinese IPs"""
    global _ip2region_searcher

    if _ip2region_searcher is not None:
        return _ip2region_searcher

    if not settings.ip2region_enabled:
        return None

    db_path = settings.ip2region_database_path
    if not os.path.exists(db_path):
        print(f"ip2region database not found at {db_path}")
        return None

    try:
        import ip2region.util as util
        import ip2region.searcher as xdb

        # Load entire xdb to memory for best performance and thread safety
        c_buffer = util.load_content_from_file(db_path)
        _ip2region_searcher = xdb.new_with_buffer(util.IPv4, c_buffer)
        print(f"ip2region database loaded from {db_path}")
        return _ip2region_searcher
    except ImportError:
        print("py-ip2region library not installed. Run: pip install py-ip2region")
        return None
    except Exception as e:
        print(f"Failed to load ip2region database: {e}")
        return None


class GeoIPService:
    """Service for IP geolocation lookups"""

    @staticmethod
    def _parse_ip2region_result(result: str) -> tuple:
        """
        Parse ip2region result string.
        Format: 国家|省份|城市|ISP
        Example: 中国|吉林省|长春市|电信
        Returns: (province, city)
        """
        if not result:
            return None, None
        parts = result.split("|")
        if len(parts) < 3:
            return None, None
        province = parts[1] if parts[1] and parts[1] != "0" else None
        city = parts[2] if parts[2] and parts[2] != "0" else None
        return province, city

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
                "city": "河南省",  # For CN IPs, province from ip2region
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

            # For Chinese IPs, use ip2region for accurate province/city
            if country_code == 'CN':
                searcher = _get_ip2region_searcher()
                if searcher:
                    try:
                        result = searcher.search(ip_address)
                        province, ip2region_city = GeoIPService._parse_ip2region_result(result)
                        # Combine province and city, avoid redundancy for municipalities
                        if province and ip2region_city:
                            # For municipalities (北京/上海/天津/重庆), province has no 省 suffix
                            # e.g. "北京" + "北京市" -> "北京市"
                            # But "吉林省" + "吉林市" -> "吉林省吉林市" (keep both)
                            if not province.endswith('省') and ip2region_city.startswith(province):
                                city = ip2region_city
                            else:
                                city = f"{province}{ip2region_city}"
                        else:
                            city = province or ip2region_city
                    except Exception:
                        pass

            # Fall back to GeoLite2 city info if ip2region didn't provide data
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
    def is_ip2region_available() -> bool:
        """Check if ip2region database is available"""
        return _get_ip2region_searcher() is not None

    @staticmethod
    def close():
        """Close the GeoIP database readers"""
        global _geoip_reader, _geoip_cn_reader, _ip2region_searcher
        if _geoip_reader is not None:
            _geoip_reader.close()
            _geoip_reader = None
        if _geoip_cn_reader is not None:
            _geoip_cn_reader.close()
            _geoip_cn_reader = None
        if _ip2region_searcher is not None:
            _ip2region_searcher.close()
            _ip2region_searcher = None
