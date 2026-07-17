#!/usr/bin/env bash
# LAAA 本地一键启动脚本(dev)
#
# 做的事(幂等,可重复跑):
#   1. 确认在 backend/ 目录,激活 .venv
#   2. 装/更新依赖(requirements.txt)
#   3. 确保 .env 存在(缺则从 .env.example 拷一份并提示改 SECRET_KEY)
#   4. 确保 RS256 密钥对存在(缺则调 generate_jwt_keys.py 生成到 jwt_keys/)
#   5. 应用 alembic 迁移 + 跑 seed.py(首次)
#   6. 起 uvicorn(reload 随 DEBUG)
#
# 用法:
#   ./start.sh           # 起后端
#   ./start.sh --no-deps # 跳过装依赖(快)
#   ./start.sh --frontend # 起后端前先 build 前端 STATIC_DIR
#   ./start.sh --prepare-only # 只做 1~5 准备,不起服务(供顶层 start.sh 复用)
#
# 若前端没构建,后端仍能起(API + 已存在的静态文件);如需前端页面,先
# cd ../frontend && npm run build,或加 --frontend 让脚本代劳。
set -euo pipefail

cd "$(dirname "$0")"

# 颜色
g() { printf '\033[32m%s\033[0m\n' "$1"; }
y() { printf '\033[33m%s\033[0m\n' "$1"; }
r() { printf '\033[31m%s\033[0m\n' "$1"; }

NO_DEPS=0
BUILD_FRONTEND=0
PREPARE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-deps) NO_DEPS=1 ;;
    --frontend) BUILD_FRONTEND=1 ;;
    --prepare-only) PREPARE_ONLY=1 ;;
    *) ;;
  esac
done

# --- 1. venv ---
if [ ! -d .venv ]; then
  g "→ 创建虚拟环境 .venv"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

# venv 可能没带 pip(某些发行版/精简构建会这样),用 ensurepip 引导一下
if ! python -m pip --version >/dev/null 2>&1; then
  y "→ venv 缺 pip,用 ensurepip 引导"
  python -m ensurepip --upgrade || { r "✗ 无法安装 pip"; exit 1; }
  python -m pip install --upgrade pip -q
fi

# --- 2. 依赖 ---
if [ "$NO_DEPS" -eq 0 ]; then
  g "→ 安装/更新依赖"
  python -m pip install --upgrade pip -q
  pip install -r requirements.txt -q
fi

# --- 3. .env ---
if [ ! -f .env ]; then
  y "→ 未发现 .env,从 .env.example 拷贝"
  cp .env.example .env
  # 注入强 SECRET_KEY + JWT 密钥路径,省得启动被占位串校验拦下
  SK="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"
  # 替换占位 SECRET_KEY
  python - "$SK" <<'PYEOF'
import re, sys
sk = sys.argv[1]
with open('.env', 'r') as f:
    s = f.read()
s = re.sub(r'^SECRET_KEY=.*$', f'SECRET_KEY={sk}', s, flags=re.M)
# 确保密钥路径指向 jwt_keys/
if 'JWT_PRIVATE_KEY_PATH' in s:
    s = re.sub(r'^JWT_PRIVATE_KEY_PATH=.*$', 'JWT_PRIVATE_KEY_PATH=jwt_keys/jwt_private.pem', s, flags=re.M)
    s = re.sub(r'^JWT_PUBLIC_KEY_PATH=.*$', 'JWT_PUBLIC_KEY_PATH=jwt_keys/jwt_public.pem', s, flags=re.M)
else:
    s += '\nJWT_PRIVATE_KEY_PATH=jwt_keys/jwt_private.pem\nJWT_PUBLIC_KEY_PATH=jwt_keys/jwt_public.pem\n'
with open('.env', 'w') as f:
    f.write(s)
PYEOF
  g "✓ 已生成 .env(含随机 SECRET_KEY),请按需编辑域名/SMTP 等项"
else
  g "✓ .env 已存在"
fi

# 校验 SECRET_KEY 非占位串(否则启动会 fail-fast)
# 用 python 解析,正确处理引号、值中的 = 号、CRLF
SK_VAL="$(python - <<'PYEOF'
import os, re
# 优先用真实环境变量(若已 export)
sk = os.getenv("SECRET_KEY", "")
if not sk:
    # 回退读 .env,剥离注释/引号/空白
    try:
        for line in open(".env", encoding="utf-8"):
            line = line.strip()
            if line.startswith("SECRET_KEY="):
                sk = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    except FileNotFoundError:
        pass
print(sk)
PYEOF
)"
if [ -z "$SK_VAL" ] || [ "$SK_VAL" = "your-secret-key-change-this-in-production" ]; then
  r "✗ SECRET_KEY 仍是占位/空值,请在 .env 改成 ≥32 字符随机串后再启动"
  exit 1
fi

# --- 4. RS256 密钥对 ---
if [ ! -f jwt_keys/jwt_private.pem ] || [ ! -f jwt_keys/jwt_public.pem ]; then
  g "→ 生成 RS256 签名密钥对(access/id token 用)"
  python scripts/generate_jwt_keys.py --out-dir ./jwt_keys
else
  g "✓ RS256 密钥对已存在(jwt_keys/)"
fi

# --- 5. 数据库迁移 + 种子 ---
g "→ 应用数据库迁移"
alembic upgrade head 2>/dev/null || y "  (alembic 跳过:初始迁移为空,表由应用 startup create_all 建立)"

if [ ! -f oauth.db ] || [ "$(python -c 'import sqlite3;print(sqlite3.connect("oauth.db").execute("select count(*) from users").fetchone()[0])' 2>/dev/null || echo 0)" -eq 0 ]; then
  g "→ 首次启动,运行 seed.py 创建默认角色/admin/内部 client"
  python seed.py || y "  seed 跳过(可能已部分存在)"
else
  g "✓ 数据库已有数据,跳过 seed"
fi

# --- 6. 前端(可选) ---
if [ "$BUILD_FRONTEND" -eq 1 ]; then
  g "→ 构建前端静态导出(frontend/out/)"
  if [ -d ../frontend ]; then
    ( cd ../frontend && npm install -q && npm run build )
  else
    y "  未找到 ../frontend,跳过"
  fi
fi

# 仅准备:迁移/依赖/密钥弄好就退,不起服务(供顶层 start.sh 复用)
if [ "$PREPARE_ONLY" -eq 1 ]; then
  g "✓ 准备完成(--prepare-only,不起服务)"
  exit 0
fi

# --- 起 ---
# 用 python 读 .env 解析 PORT/HOST(避开 shell 手搓 grep 的引号/CRLF 坑)
PORT="$(python - <<'PY'
for line in open(".env", encoding="utf-8"):
    line=line.strip()
    if line.startswith("PORT="):
        print(line.split("=",1)[1].strip().strip('"').strip("'")); break
PY
)"
HOST="$(python - <<'PY'
for line in open(".env", encoding="utf-8"):
    line=line.strip()
    if line.startswith("HOST="):
        print(line.split("=",1)[1].strip().strip('"').strip("'")); break
PY
)"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

echo
g "🚀 启动 LAAA —— http://localhost:${PORT}"
echo "   API 文档(admin): http://localhost:${PORT}/api/docs"
echo "   健康检查:        http://localhost:${PORT}/api/health"
echo "   按 CTRL+C 停止"
echo

exec python -m app.main
