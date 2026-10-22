# LAAA 镜像 —— 三阶段构建
#
#   1. frontend-builder : 编译前端静态导出 (next build → /frontend/out)
#   2. deps            : 装好 Python 依赖 → /install(独立层,代码变更不重装)
#   3. runner          : 最终运行镜像,含依赖层 + 后端应用代码 + 脚本 + 前端产物 + GeoIP
#
# 后端应用代码 (backend/app) 会 COPY 进镜像 —— 生产用 docker-compose.prod.yml
# 不挂载代码,靠镜像里的这份跑;开发用 docker-compose.yml 的 bind mount
# (./backend/app:/app/app) 会覆盖 /app/app 配合 --reload 热重载,两种形态互不冲突。
# 镜像里固化"慢且少变"的东西:依赖、后端代码、前端静态产物、GeoIP 库、entrypoint 脚本。
#
# 用法:
#   docker compose up -d --build       # 本地构建 + 挂载后端代码(reload)
#   docker compose -f docker-compose.prod.yml up -d   # 生产:用预构建镜像(可选)

# ───────────────────────── Stage 1: 前端静态导出 ─────────────────────────
FROM node:22.23.4-alpine AS frontend-builder
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

# FORWARDED_ALLOW_IPS:uvicorn 自动读取该环境变量,只信任这些来源(IP/CIDR,逗号分隔)
# 的 X-Forwarded-* 头。放在反向代理后时,这决定了应用拿到的客户端 IP 是否真实
# (GeoIP / 登录日志 / 风控 / 限流都依赖它)。反代不在这些网段时,在 compose 的
# environment 里覆盖。
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    # 前端静态产物位置(与下方 COPY 一致;compose 可挂载覆盖)
    STATIC_DIR=/app/frontend/out \
    # 默认监听 8000
    HOST=0.0.0.0 \
    PORT=8000 \
    FORWARDED_ALLOW_IPS=127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16

# 非 root 运行:专用用户 uid/gid 1000(对齐常见宿主机首个普通用户,方便挂载卷
# 对齐属主)。挂载卷的属主要求见 DEPLOY.md「非 root 用户与卷属主」一节。
RUN useradd --uid 1000 --create-home appuser

# 拷依赖(独立层,来自 deps 阶段)
COPY --from=deps /install /usr/local

# 后端应用代码 + 迁移 + 脚本 + seed:
# 生产 compose 不挂载代码,靠这里的 COPY 提供完整应用;
# 开发 compose 的 bind mount (./backend/app:/app/app) 会覆盖 /app/app 实现热重载。
COPY --chown=appuser:appuser backend/app /app/app
COPY --chown=appuser:appuser backend/alembic.ini /app/alembic.ini
COPY --chown=appuser:appuser backend/alembic /app/alembic
COPY --chown=appuser:appuser backend/scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --chown=appuser:appuser backend/scripts/generate_jwt_keys.py /app/scripts/generate_jwt_keys.py
COPY --chown=appuser:appuser backend/scripts/update_geoip.py /app/scripts/update_geoip.py
COPY --chown=appuser:appuser backend/scripts/init_admin_permissions.py /app/scripts/init_admin_permissions.py
COPY --chown=appuser:appuser backend/seed.py /app/seed.py

# 前端静态产物(Stage 1 编译出的 frontend/out)
COPY --from=frontend-builder --chown=appuser:appuser /frontend/out /app/frontend/out

# GeoIP 数据库(CI 在构建前下载到 backend/data/;本地构建需文件存在)
# compose 可用 ./data:/app/data 覆盖为自有库
COPY --chown=appuser:appuser backend/data /app/data

RUN chmod +x /app/docker-entrypoint.sh

# 以非 root 用户运行(挂载卷需对齐属主 1000:1000,见 DEPLOY.md)
USER appuser

EXPOSE 8000

# --proxy-headers:让 uvicorn 采纳受信任来源的 X-Forwarded-* 头,应用才能拿到
# 真实客户端 IP;信任范围由上方 FORWARDED_ALLOW_IPS 控制。
# ENTRYPOINT 跑迁移 + 空库 seed 后 exec CMD;compose 可覆盖 command 加 --reload
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
