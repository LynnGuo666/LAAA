#!/bin/sh
# LAAA 容器入口脚本
#
# 启动前:
#   1. 应用数据库迁移(幂等)
#   2. 若 JWT RS256 密钥缺失则自动生成(首次部署免手动跑 generate_jwt_keys.py)
# 然后把控制权交给 CMD / compose 的 command。
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

# --- JWT RS256 密钥对:缺失则自动生成 ---
# 首次部署若挂载的 ./jwt_keys 为空,这里自动生成 RSA-2048 密钥对,免去手动跑
# generate_jwt_keys.py。已有密钥则跳过(脚本本身也防覆盖)。
# 路径取自 JWT_PRIVATE_KEY_PATH,未设置则用默认 jwt_keys/jwt_private.pem
# (容器 WORKDIR=/app,相对路径解析为 /app/jwt_keys/...,与 compose 挂载点一致)。
JWT_PRIV="${JWT_PRIVATE_KEY_PATH:-jwt_keys/jwt_private.pem}"
if [ ! -f "$JWT_PRIV" ]; then
  JWT_DIR="$(dirname "$JWT_PRIV")"
  echo "(entrypoint) JWT private key not found at $JWT_PRIV — generating a new RSA-2048 keypair"
  mkdir -p "$JWT_DIR"
  # 失败不阻断启动:用户可能用其他方式注入密钥;若确实缺失,签发 token 时会 fail-fast
  python /app/scripts/generate_jwt_keys.py --out-dir "$JWT_DIR" \
    || echo "(entrypoint) WARNING: JWT key generation failed; token signing will fail if keys are missing" >&2
else
  echo "(entrypoint) JWT keys present at $JWT_PRIV — skipping generation"
fi

exec "$@"
