#!/usr/bin/env bash
# LAAA 顶层一键启动脚本
#
# 提供两种运行模式:
#   1) dev    — 前后端分开跑,热重载(前端 next dev @ :3000,后端 uvicorn @ :8000)
#   2) prod   — 编译前端静态导出,由后端单进程托管(:8000,贴近生产形态)
#
# 用法:
#   ./start.sh                # 交互式选模式(同 ./start.sh --menu)
#   ./start.sh dev            # 直接 dev 模式
#   ./start.sh prod           # 直接 prod 模式
#   ./start.sh build          # 只编译前端(next build → frontend/out/),不起服务
#   ./start.sh --menu         # 强制走交互菜单
#   ./start.sh stop           # 停掉本脚本拉起的前/后端进程(按 PID 文件)
#
# 两种模式都先调 backend/start.sh --prepare-only 把 venv/依赖/.env/密钥/迁移/seed
# 弄到位(幂等可重复跑),再决定怎么起服务。停掉用 CTRL+C 或 ./start.sh stop。
set -euo pipefail

cd "$(dirname "$0")"

# ---------- 颜色 ----------
g() { printf '\033[32m%s\033[0m\n' "$1"; }
y() { printf '\033[33m%s\033[0m\n' "$1"; }
r() { printf '\033[31m%s\033[0m\n' "$1"; }
b() { printf '\033[36m%s\033[0m\n' "$1"; }

# ---------- 路径 ----------
ROOT_DIR="$(pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_PY="$BACKEND_DIR/.venv/bin/python"
PID_DIR="$ROOT_DIR/.run"
mkdir -p "$PID_DIR"

# ---------- 用 backend/.env 读端口(与 backend/start.sh 同款解析,避坑引号/CRLF) ----------
read_env() {
  local key="$1" fallback="${2:-}"
  local val
  val="$("$VENV_PY" - "$key" "$BACKEND_DIR/.env" <<'PY' 2>/dev/null || true
import sys
key, path = sys.argv[1], sys.argv[2]
try:
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line.startswith(key + "="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            print(v); break
except FileNotFoundError:
    pass
PY
)"
  echo "${val:-$fallback}"
}

# ---------- 工具检查 ----------
require() {
  command -v "$1" >/dev/null 2>&1 || { r "✗ 找不到 $1,请先安装"; exit 1; }
}
require python3
require npm

# ---------- 后端准备:复用 backend/start.sh(幂等) ----------
# backend/start.sh 对占位 SECRET_KEY 会 fail-fast。这里在调它之前兜底:
# 若 SECRET_KEY 仍是占位/空,就注入一个随机强密钥,免得阻塞首次准备。
prepare_backend() {
  b "▶ 后端准备(venv/依赖/.env/密钥/迁移/seed)——复用 backend/start.sh"
  # venv 还没建?backend/start.sh 会建,但下面读 .env 要用 .venv 的 python,
  # 这里先确保 venv 存在(轻量,已有则秒过)。
  if [ ! -x "$VENV_PY" ]; then
    b "  → 先建 backend/.venv"
    python3 -m venv "$BACKEND_DIR/.venv"
    "$VENV_PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
    "$VENV_PY" -m pip install --upgrade pip -q >/dev/null 2>&1 || true
  fi
  # 校验/修复占位 SECRET_KEY(只在 .env 不存在或为占位时改)
  if [ ! -f "$BACKEND_DIR/.env" ]; then
    y "→ 未发现 backend/.env,从 .env.example 拷贝"
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  fi
  local sk
  sk="$("$VENV_PY" - "$BACKEND_DIR/.env" <<'PY' 2>/dev/null || echo ""
import sys
try:
    for line in open(sys.argv[1], encoding="utf-8"):
        line = line.strip()
        if line.startswith("SECRET_KEY="):
            print(line.split("=",1)[1].strip().strip('"').strip("'"))
            break
except FileNotFoundError:
    pass
PY
)"
  if [ -z "$sk" ] || [ "$sk" = "your-secret-key-change-this-in-production" ]; then
    y "→ SECRET_KEY 为占位/空,注入随机强密钥"
    local new_sk
    new_sk="$("$VENV_PY" -c 'import secrets;print(secrets.token_urlsafe(48))')"
    "$VENV_PY" - "$BACKEND_DIR/.env" "$new_sk" <<'PY'
import sys, re
path, new = sys.argv[1], sys.argv[2]
s = open(path, encoding="utf-8").read()
if re.search(r'^SECRET_KEY=.*$', s, flags=re.M):
    s = re.sub(r'^SECRET_KEY=.*$', f'SECRET_KEY={new}', s, flags=re.M)
else:
    s += f'\nSECRET_KEY={new}\n'
open(path, "w", encoding="utf-8").write(s)
PY
    g "✓ 已写入随机 SECRET_KEY(生产请务必在 backend/.env 改成固定值)"
  fi
  bash "$BACKEND_DIR/start.sh" --prepare-only
}

# ---------- 端口占用检查 ----------
port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# ---------- 启动后端(后台,记 PID) ----------
# $1=host $2=port $3=mode(dev|prod);prod 模式强制关 reload(不依赖 .env 的 DEBUG)
start_backend() {
  local host="${1:-0.0.0.0}"
  local port="${2:-8000}"
  local mode="${3:-dev}"
  if port_busy "$port"; then
    r "✗ 端口 $port 已被占用,先释放或改 backend/.env 的 PORT"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN | sed 's/^/    /'
    exit 1
  fi
  b "▶ 启动后端 uvicorn → http://${host}:${port}  (${mode}, PID 写入 .run/backend.pid)"
  (
    cd "$BACKEND_DIR"
    source .venv/bin/activate
    # prod 模式不 reload:环境变量覆盖 .env 的 DEBUG(pydantic Settings 中 env 优先)
    if [ "$mode" = "prod" ]; then export DEBUG=False; fi
    exec python -m app.main
  ) &
  echo $! > "$PID_DIR/backend.pid"
}

# ---------- dev:前端 next dev(后台,记 PID) ----------
start_frontend_dev() {
  local port="${1:-3000}"
  if port_busy "$port"; then
    r "✗ 端口 $port 已被占用(前端 dev)"
    exit 1
  fi
  # 确保前端 .env.local 指向后端
  if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
    y "→ 未发现 frontend/.env.local,写入 NEXT_PUBLIC_API_URL=http://localhost:${2:-8000}"
    printf 'NEXT_PUBLIC_API_URL=http://localhost:%s\n' "${2:-8000}" > "$FRONTEND_DIR/.env.local"
  fi
  b "▶ 启动前端 next dev → http://localhost:${port}  (PID 写入 .run/frontend.pid)"
  ( cd "$FRONTEND_DIR" && exec npm run dev ) &
  echo $! > "$PID_DIR/frontend.pid"
}

# ---------- prod:编译前端并由后端托管 ----------
build_frontend() {
  b "▶ 编译前端静态导出(frontend/out/)——由后端在 :8000 托管"
  if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
    printf 'NEXT_PUBLIC_API_URL=http://localhost:8000\n' > "$FRONTEND_DIR/.env.local"
  fi
  ( cd "$FRONTEND_DIR" && npm install -q && npm run build )
}

# ---------- 优雅停止 ----------
cleanup() {
  echo
  y "↩ 收到退出信号,停止后台进程…"
  for f in frontend.pid backend.pid; do
    if [ -f "$PID_DIR/$f" ]; then
      pid="$(cat "$PID_DIR/$f")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        y "  已停 $f (pid=$pid)"
      fi
      rm -f "$PID_DIR/$f"
    fi
  done
  # 兜底:按端口清残留(dev 模式子进程树)
  pkill -P "$(cat "$PID_DIR/backend.pid" 2>/dev/null || echo 0)" 2>/dev/null || true
  exit 0
}

# ---------- 模式:dev ----------
run_dev() {
  prepare_backend
  local host port fe_port
  host="$(read_env HOST 0.0.0.0)"
  port="$(read_env PORT 8000)"
  fe_port=3000
  start_backend "$host" "$port" dev
  start_frontend_dev "$fe_port" "$port"
  trap cleanup INT TERM
  echo
  g "🚀 dev 模式已启动"
  b "   前端(热重载): http://localhost:${fe_port}"
  b "   后端 API:      http://localhost:${port}"
  echo "   API 文档(admin): http://localhost:${port}/api/docs"
  echo "   停止: CTRL+C 或 ./start.sh stop"
  echo
  wait
}

# ---------- 模式:prod ----------
run_prod() {
  prepare_backend
  build_frontend
  local host port
  host="$(read_env HOST 0.0.0.0)"
  port="$(read_env PORT 8000)"
  start_backend "$host" "$port" prod
  trap cleanup INT TERM
  echo
  g "🚀 prod 模式已启动(单进程托管前端+API)"
  b "   访问:        http://localhost:${port}"
  echo "   API 文档(admin): http://localhost:${port}/api/docs"
  echo "   停止: CTRL+C 或 ./start.sh stop"
  echo
  wait
}

# ---------- 模式:stop ----------
run_stop() {
  y "↩ 停止本脚本拉起的进程…"
  for f in frontend.pid backend.pid; do
    if [ -f "$PID_DIR/$f" ]; then
      pid="$(cat "$PID_DIR/$f")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && y "  已停 $f (pid=$pid)"
        # 杀掉子进程树(npm/next/uvicorn reload 常派生子进程)
        pkill -P "$pid" 2>/dev/null || true
      fi
      rm -f "$PID_DIR/$f"
    fi
  done
  g "✓ 完成"
  exit 0
}

# ---------- 模式:menu ----------
run_menu() {
  echo
  b "LAAA 启动模式选择"
  echo "  1) dev    前后端分开跑 + 热重载(前端 :3000 / 后端 :8000)"
  echo "  2) prod   编译前端静态导出,后端单进程托管(:8000)"
  echo "  3) build  只编译前端(next build),不起服务"
  echo "  q) 退出"
  echo
  printf "请选择 [1/2/3/q](默认 1): "
  read -r choice || choice=""
  case "${choice:-1}" in
    1|dev)  run_dev ;;
    2|prod) run_prod ;;
    3|build) prepare_backend && build_frontend && g "✓ 前端已编译到 frontend/out/" ;;
    q|Q)    exit 0 ;;
    *) r "无效选择"; exit 1 ;;
  esac
}

# ---------- 入口 ----------
case "${1:-menu}" in
  dev)         run_dev ;;
  prod)        run_prod ;;
  build)       prepare_backend && build_frontend && g "✓ 前端已编译到 frontend/out/" ;;
  stop)        run_stop ;;
  menu|--menu) run_menu ;;
  -h|--help)
    sed -n '2,18p' "$0"
    exit 0 ;;
  *) r "未知参数: $1  (用 -h 查看帮助)"; exit 1 ;;
esac
