# LAAA 镜像 —— 三阶段构建
#
#   1. frontend-builder : 编译前端静态导出 (next build → /frontend/out)
#   2. deps            : 装好 Python 依赖 → /install(独立层,代码变更不重装)
#   3. runner          : 最终运行镜像,只 COPY 依赖层 + 必要脚本 + 前端产物 + GeoIP
#
# 后端应用代码 (backend/app) 不再 COPY 进镜像,而是在运行时由 docker-compose
# bind mount 挂载到 /app/app —— 改后端代码即时生效,无需重建镜像。
# 镜像里只固化"慢且少变"的东西:依赖、前端静态产物、GeoIP 库、entrypoint 脚本。
#
# 用法:
#   docker compose up -d --build       # 本地构建 + 挂载后端代码(reload)
#   docker compose -f docker-compose.prod.yml up -d   # 生产:用预构建镜像(可选)

# ───────────────────────── Stage 1: 前端静态导出 ─────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.js 里 output: 'export' → 产物在 /frontend/out
RUN npm run build

# ───────────────────────── Stage 2: Python 依赖(独立层) ─────────────────────────
FROM python:3.11-slim AS deps
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 依赖装到 /install,作为独立层被 runner COPY,代码变更不触发重装
COPY backend/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir --prefix=/install -r /app/requirements.lock

# ───────────────────────── Stage 3: 运行镜像 ─────────────────────────
FROM python:3.11-slim AS runner
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    # 前端静态产物位置(与下方 COPY 一致;compose 可挂载覆盖)
    STATIC_DIR=/app/frontend/out \
    # 默认监听 8000
    HOST=0.0.0.0 \
    PORT=8000

# 拷依赖(独立层,来自 deps 阶段)
COPY --from=deps /install /usr/local

# 运行时依赖的脚本与配置(后端 app/ 代码由 compose bind mount,不进镜像)
COPY backend/alembic.ini /app/alembic.ini
COPY backend/alembic /app/alembic
COPY backend/scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY backend/scripts/generate_jwt_keys.py /app/scripts/generate_jwt_keys.py
COPY backend/scripts/update_geoip.py /app/scripts/update_geoip.py
COPY backend/scripts/init_admin_permissions.py /app/scripts/init_admin_permissions.py
COPY backend/seed.py /app/seed.py

# 前端静态产物(Stage 1 编译出的 frontend/out)
COPY --from=frontend-builder /frontend/out /app/frontend/out

# GeoIP 数据库(CI 在构建前下载到 backend/data/;本地构建需文件存在)
# compose 可用 ./data:/app/data 覆盖为自有库
COPY backend/data /app/data

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

# ENTRYPOINT 跑迁移后 exec CMD;compose 可覆盖 command 加 --reload
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
