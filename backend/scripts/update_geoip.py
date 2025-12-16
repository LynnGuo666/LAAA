#!/usr/bin/env python3
"""
批量更新数据库中旧 IP 记录的地理位置信息

使用方法:
    cd backend
    python -m scripts.update_geoip

功能:
    - 更新 Sessions 表中的 country/city 字段
    - 更新 LoginLogs 表中的 country/city 字段
    - 跳过内网 IP (127.0.0.1, 192.168.x.x 等)
"""

import sys
import os

# 添加项目根目录到 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import Session, LoginLog
from app.services.geoip_service import GeoIPService


def update_sessions(db) -> tuple[int, int]:
    """更新 Sessions 表的地理位置信息"""
    sessions = db.query(Session).filter(Session.ip_address != None).all()
    total = len(sessions)
    updated = 0

    for s in sessions:
        if not s.ip_address:
            continue
        geo = GeoIPService.get_location(s.ip_address)
        if geo:
            old_city = s.city
            s.country = geo.get('country')
            s.city = geo.get('city')
            if s.city != old_city:
                updated += 1
                print(f"  Session {s.id}: {s.ip_address} -> {s.country}, {s.city}")

    return total, updated


def update_login_logs(db) -> tuple[int, int]:
    """更新 LoginLogs 表的地理位置信息"""
    logs = db.query(LoginLog).filter(LoginLog.ip_address != None).all()
    total = len(logs)
    updated = 0

    for l in logs:
        if not l.ip_address:
            continue
        geo = GeoIPService.get_location(l.ip_address)
        if geo:
            old_city = l.city
            l.country = geo.get('country')
            l.city = geo.get('city')
            if l.city != old_city:
                updated += 1

    return total, updated


def main():
    print("=" * 50)
    print("GeoIP 数据批量更新脚本")
    print("=" * 50)

    # 检查 GeoIP 服务状态
    print("\n检查 GeoIP 服务状态...")
    print(f"  GeoIP (GeoLite2-City): {'可用' if GeoIPService.is_available() else '不可用'}")
    print(f"  ip2region: {'可用' if GeoIPService.is_ip2region_available() else '不可用'}")

    if not GeoIPService.is_available():
        print("\n错误: GeoIP 服务不可用，请检查数据库文件")
        return 1

    db = SessionLocal()

    try:
        # 更新 Sessions
        print("\n更新 Sessions 表...")
        sessions_total, sessions_updated = update_sessions(db)
        print(f"  总数: {sessions_total}, 更新: {sessions_updated}")

        # 更新 LoginLogs
        print("\n更新 LoginLogs 表...")
        logs_total, logs_updated = update_login_logs(db)
        print(f"  总数: {logs_total}, 更新: {logs_updated}")

        # 提交更改
        db.commit()

        print("\n" + "=" * 50)
        print("更新完成!")
        print(f"  Sessions: {sessions_updated}/{sessions_total} 条记录已更新")
        print(f"  LoginLogs: {logs_updated}/{logs_total} 条记录已更新")
        print("=" * 50)

        return 0

    except Exception as e:
        db.rollback()
        print(f"\n错误: {e}")
        return 1

    finally:
        db.close()
        GeoIPService.close()


if __name__ == "__main__":
    sys.exit(main())
