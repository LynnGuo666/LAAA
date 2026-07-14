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

# Place exported frontend at /app/frontend/out to match STATIC_DIR above
COPY --from=frontend-builder /frontend/out /app/frontend/out

# GeoIP databases (downloaded by CI into backend/data/ before building).
# CI always seeds this dir; for local builds ensure the files exist locally.
COPY backend/data /app/data

EXPOSE 8000
# FastAPI app lives in backend/app/main.py
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
