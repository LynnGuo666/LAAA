#!/bin/sh
# LAAA 容器入口脚本
#
# 启动前:
#   1. 应用数据库迁移(alembic upgrade head;失败则拒绝启动——schema 错配比停机更危险)
#   2. 空库时运行 seed.py 创建默认角色/admin/内部 client(admin/admin123)
#   3. 若 JWT RS256 密钥缺失则自动生成(首次部署免手动跑 generate_jwt_keys.py)
# 然后把控制权交给 CMD / compose 的 command。
#
#   ENTRYPOINT ["/app/docker-entrypoint.sh"]
#   CMD        ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
#
# 本地开发(compose 覆盖 command 加 --reload):
#   command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/app
set -e

# --- 推导 SQLite 数据库文件路径(判断"库是否为空"用) ---
# DATABASE_URL 可能指向任意路径,不硬编码:sqlite:///./x → $PWD/x,
# sqlite:////abs/x → /abs/x;非 sqlite 方言 → 空串(跳过文件级判断)。
DB_FILE="$(python - <<'PY'
import os
url = os.environ.get("DATABASE_URL", "sqlite:///./oauth.db")
if not url.startswith("sqlite"):
    print("")
elif "///" in url:
    path = url.split("///", 1)[1].split("?")[0]
    print(path if path.startswith("/") else os.path.abspath(path))
else:
    print("")
PY
)"

DB_EMPTY=0
if [ -n "$DB_FILE" ] && [ ! -s "$DB_FILE" ]; then
  DB_EMPTY=1
  echo "(entrypoint) 数据库文件为空或不存在: $DB_FILE —— 按首次启动处理(迁移 + seed)"
elif [ -n "$DB_FILE" ]; then
  echo "(entrypoint) 数据库文件已存在: $DB_FILE"
fi

# --- 1. 数据库 schema ---
# 历史背景:初始迁移 upgrade() 为空(pass),整条迁移链是"空壳基线 + 增量"——
# 在全新空库上直接 alembic upgrade head 会在第 2 个迁移(ALTER clients)崩掉
# "no such table"。因此分两条路径:
#   - 空库:用应用自身的 create_all 建全量表结构,再 alembic stamp head
#     标记基线(后续增量迁移从 head 继续)
#   - 已有库:正常 alembic upgrade head 应用增量
# 两条路径失败都拒绝启动:带旧/错 schema 起服务比停机更危险。
if [ "$DB_EMPTY" -eq 1 ]; then
  echo "(entrypoint) 全新数据库 —— create_all 建表 + alembic stamp head..."
  if ! BOOTSTRAP_LOG="$(python - <<'PY'
from app.database import engine
from app.models import Base
Base.metadata.create_all(bind=engine)
PY
  )"; then
    echo "(entrypoint) ERROR: create_all 失败,拒绝启动。" >&2
    printf '%s\n' "$BOOTSTRAP_LOG" >&2
    exit 1
  fi
  if ! ALEMBIC_LOG="$(alembic stamp head 2>&1)"; then
    echo "(entrypoint) ERROR: alembic stamp head 失败,拒绝启动。" >&2
    printf '%s\n' "$ALEMBIC_LOG" >&2
    exit 1
  fi
  echo "(entrypoint) 空库初始化完成(表结构 = 当前模型,迁移基线 = head)"
else
  echo "(entrypoint) applying database migrations (alembic upgrade head)..."
  if ! ALEMBIC_LOG="$(alembic upgrade head 2>&1)"; then
    echo "(entrypoint) ERROR: alembic upgrade head 失败,拒绝启动。" >&2
    echo "(entrypoint)   已有数据的库迁移失败,继续启动会有 schema 错配风险。" >&2
    echo "(entrypoint)   建议先备份数据库文件,再根据下方输出排查。" >&2
    echo "(entrypoint) --- alembic output ---" >&2
    printf '%s\n' "$ALEMBIC_LOG" >&2
    exit 1
  fi
  if [ -n "$ALEMBIC_LOG" ]; then
    printf '%s\n' "$ALEMBIC_LOG" | sed 's/^/(alembic) /'
  fi
fi

# --- 2. 空库 seed(users 表不存在或无记录 → 跑 seed.py) ---
# 初始迁移不建表,所以 alembic 跑完后 users 表可能仍不存在——一并视为未初始化。
# 通过 SQLAlchemy 按 DATABASE_URL 查询,不硬编码路径/方言。
if ! USERS_SEEDED="$(python - <<'PY'
import os
from sqlalchemy import create_engine, inspect, text
engine = create_engine(os.environ.get("DATABASE_URL", "sqlite:///./oauth.db"))
if not inspect(engine).has_table("users"):
    print("no")
else:
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
    print("yes" if count else "no")
PY
)"; then
  echo "(entrypoint) ERROR: 无法查询数据库 users 表,拒绝启动(详见上方 Python 报错)。" >&2
  echo "(entrypoint)   常见原因:DATABASE_URL 指向的文件/目录不可写(挂载卷属主问题,见 DEPLOY.md)。" >&2
  exit 1
fi

if [ "$USERS_SEEDED" != "yes" ]; then
  echo "(entrypoint) users 表不存在或为空 —— 运行 seed.py 创建默认角色/admin/internal client"
  if ! python seed.py; then
    echo "(entrypoint) ERROR: seed.py 失败,拒绝启动(空库没有默认管理员,服务起来也无法登录)。" >&2
    echo "(entrypoint)   常见原因:挂载卷属主不是运行用户(uid/gid 1000),见 DEPLOY.md「非 root 用户与卷属主」。" >&2
    exit 1
  fi
  echo "(entrypoint) seed 完成。默认管理员: admin / admin123 —— 登录后立即改密码!"
else
  echo "(entrypoint) users 表已有数据,跳过 seed"
fi

# --- 3. JWT RS256 密钥对:缺失则自动生成 ---
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
