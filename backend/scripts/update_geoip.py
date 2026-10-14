#!/usr/bin/env python3
"""
回填历史记录的 GeoIP 地理位置信息(不是下载 GeoIP 数据库的脚本!)

用途:当 GeoIP 数据库更新/新增后,重算**已存在**的 Sessions / LoginLogs 记录
的 country/city 字段。新登录/新会话在写入时就会定位,无需跑本脚本。

下载/更新 GeoIP 数据库本身:
    Docker 镜像由 CI 构建时下载(见 .github/workflows/docker-publish.yml);
    自有部署可把库文件放进 backend/data/ 覆盖(见 DEPLOY.md「GeoIP 说明」)。

使用方法:
    cd backend
    python -m scripts.update_geoip

内存说明:原来的 `.all()` 会把整张表一次性载入内存,LoginLog 是只增不减的
日志表,百万行级别会直接打爆内存。这里改为**主键 keyset 分批**:每批按
`WHERE id > :last_id ORDER BY id LIMIT 500` 取一批、处理完立即 commit,
既控制内存,也避免一个超大事务长时间持 SQLite 写锁(也避免了在迭代游标
未关闭时 commit 的兼容问题)。

处理规则:
    - 更新 Sessions 表中的 country/city 字段
    - 更新 LoginLogs 表中的 country/city 字段
    - 跳过内网 IP (127.0.0.1, 192.168.x.x 等,GeoIP 查不到内网地址)
"""

import sys
import os

# 添加项目根目录到 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import Session, LoginLog
from app.services.geoip_service import GeoIPService

BATCH_SIZE = 500


def backfill_geo(model, label: str) -> tuple[int, int]:
    """按主键 keyset 分批回填一张表的 country/city。

    model 需有自增整型主键 id 及 ip_address / country / city 字段。
    每批一个事务,处理完立即 commit。返回 (总行数, 更新行数)。
    """
    id_col = model.id
    db = SessionLocal()
    total = 0
    updated = 0
    last_id = 0

    try:
        while True:
            batch = (
                db.query(model)
                .filter(model.ip_address != None, id_col > last_id)  # noqa: E711
                .order_by(id_col)
                .limit(BATCH_SIZE)
                .all()
            )
            if not batch:
                break

            batch_updated = 0
            for row in batch:
                total += 1
                last_id = row.id
                geo = GeoIPService.get_location(row.ip_address)
                if geo:
                    old_city = row.city
                    row.country = geo.get('country')
                    row.city = geo.get('city')
                    if row.city != old_city:
                        updated += 1
                        batch_updated += 1

            db.commit()

            if batch_updated:
                print(f"  ... {label}: 已处理到 id={last_id}(累计 {total} 行 / {updated} 行更新)")

        return total, updated

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


def main():
    print("=" * 50)
    print("历史记录 GeoIP 信息回填脚本")
    print("=" * 50)

    # 检查 GeoIP 服务状态
    print("\n检查 GeoIP 服务状态...")
    print(f"  GeoIP (GeoLite2-City): {'可用' if GeoIPService.is_available() else '不可用'}")
    print(f"  ip2region: {'可用' if GeoIPService.is_ip2region_available() else '不可用'}")

    if not GeoIPService.is_available():
        print("\n错误: GeoIP 服务不可用，请检查数据库文件")
        return 1

    print("\n更新 Sessions 表...")
    sessions_total, sessions_updated = backfill_geo(Session, "Sessions")
    print(f"  总数: {sessions_total}, 更新: {sessions_updated}")

    print("\n更新 LoginLogs 表...")
    logs_total, logs_updated = backfill_geo(LoginLog, "LoginLogs")
    print(f"  总数: {logs_total}, 更新: {logs_updated}")

    print("\n" + "=" * 50)
    print("更新完成!")
    print(f"  Sessions: {sessions_updated}/{sessions_total} 条记录已更新")
    print(f"  LoginLogs: {logs_updated}/{logs_total} 条记录已更新")
    print("=" * 50)

    GeoIPService.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
