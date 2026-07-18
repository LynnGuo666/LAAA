#!/bin/sh
# LAAA 容器入口脚本
#
# 启动前应用数据库迁移(幂等),然后把控制权交给 CMD / compose 的 command。
#
#   ENTRYPOINT ["/app/docker-entrypoint.sh"]
#   CMD        ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
#
# 本地开发(compose 覆盖 command 加 --reload):
#   command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/app
set -e

# 应用 Alembic 迁移。
# 初始迁移 upgrade() 为空(pass),表由应用 startup 的 init_db()/create_all 建立;
# 这里用于后续增量迁移(加列),并对已有库标记基线。失败不阻断启动(首次/空迁移场景)。
if command -v alembic >/dev/null 2>&1; then
  alembic upgrade head 2>/dev/null || echo "(entrypoint) alembic 跳过:初始迁移为空或库已就绪"
fi

exec "$@"
