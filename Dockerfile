FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1
# Static export is handled by Next via output: 'export' in next.config.js
RUN npm run build

FROM python:3.11-slim AS runner
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Match the COPY target below so backend/app/main.py serves the frontend
    # without relying on the dev-oriented relative path (../../frontend/out).
    STATIC_DIR=/app/frontend/out

COPY backend/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir -r /app/requirements.lock

COPY backend/app /app/app
COPY backend/main.py /app/main.py
COPY backend/scripts /app/scripts
COPY backend/alembic /app/alembic
COPY backend/alembic.ini /app/alembic.ini
COPY backend/seed.py /app/seed.py

# 启动前应用数据库迁移。
# 注意:初始迁移 upgrade() 为空(pass),表由应用 startup 的 init_db()/create_all 建立;
# 此处 alembic upgrade head 用于应用后续增量迁移(加列),并对已有库标记基线。
# 新库:create_all 建表 + alembic stamp head;已有库:迁移跳过已应用版本。
ENTRYPOINT ["sh", "-c", "alembic upgrade head 2>/dev/null || true; exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]

# Place exported frontend at /app/frontend/out to match STATIC_DIR above
COPY --from=frontend-builder /frontend/out /app/frontend/out

# GeoIP databases (downloaded by CI into backend/data/ before building).
# CI always seeds this dir; for local builds ensure the files exist locally.
COPY backend/data /app/data

EXPOSE 8000
# FastAPI app lives in backend/app/main.py
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
