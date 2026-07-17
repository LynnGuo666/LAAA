# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LAAA is a personal **OAuth 2.0 / OIDC authorization server and unified identity platform** built with FastAPI (backend) and Next.js (frontend). It has grown well beyond a basic OAuth server into a full identity platform with:

- OAuth 2.0 flows (authorization code, password grant, refresh token) + **OIDC** (`/.well-known/openid-configuration`, `/.well-known/jwks.json`, `userinfo`)
- **Passwordless login** via WebAuthn / Passkey
- **Two-factor authentication** via TOTP (with QR code enrollment)
- **Email verification** + **magic link** login (async SMTP)
- **Invite-code registration** (open registration is off by default)
- **Risk-based login anomaly detection** (geo-jump, IP change, login velocity) and **session limits**
- **GeoIP** lookups (MaxMind GeoLite2 for international + ip2region for Chinese IPs)
- Multiple applications, **user groups** (whitelist/blacklist access control), **RBAC**, audit & login logs
- Per-user/per-group **app access permissions**, site-wide settings

The backend serves the Next.js static export from `frontend/out/`, so after building the frontend only the backend needs to run.

## Development Commands

### One-shot launcher (recommended)

The top-level `./start.sh` wraps the whole local workflow (venv / deps / `.env` / RS256 keys / migrations / seed) and offers two run modes:

```bash
./start.sh            # interactive menu
./start.sh dev        # dev:  frontend next dev @ :3000 + backend uvicorn @ :8000 (reload)
./start.sh prod       # prod: build frontend static export, single backend process serves it @ :8000 (DEBUG=False)
./start.sh build      # only build the frontend (next build → frontend/out/)
./start.sh stop       # stop processes started by this script (reads .run/*.pid)
```

- `dev` runs frontend and backend as separate processes (hot reload); `prod` matches the Docker image form (single process serves API + static files).
- On first run it auto-creates `backend/.env` (injects a random `SECRET_KEY`), generates the RS256 keypair into `backend/jwt_keys/`, applies migrations and runs `seed.py` — all idempotent.
- Process PIDs are written to `.run/` (gitignored). Both `CTRL+C` and `./start.sh stop` tear down the full process tree (incl. npm/next children).
- Internally it delegates backend prep to `backend/start.sh --prepare-only`.

### Backend (Python + FastAPI)

```bash
# Activate virtual environment
source .venv/bin/activate

# Install dependencies
cd backend
pip install -r requirements.txt

# Run development server (recommended)
cd backend
python -m app.main

# Alternative: run the top-level launcher (adds backend/ to sys.path)
.venv/bin/python backend/main.py

# Run with uvicorn directly
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Database Migrations (Alembic)

Schema changes are managed with **Alembic** (do NOT hand-edit/delete the DB in normal development):

```bash
cd backend
alembic upgrade head          # apply all migrations
alembic revision --autogenerate -m "describe change"   # create a new migration
alembic upgrade head          # apply it
```

`seed.py` populates default roles/permissions/admin/groups/internal client on top of the migrated schema. Run it once for a fresh setup:

```bash
cd backend
python seed.py
```

> For a truly clean slate in development you can delete `backend/oauth.db`, run `alembic upgrade head`, then `python seed.py`. Prefer migrations for any real schema change.

### Frontend (Next.js + TypeScript)

```bash
cd frontend
npm install
npm run dev        # development mode
npm run build      # production static export → frontend/out/
```

The build outputs to `frontend/out/`, which FastAPI serves at runtime.

### Full Stack Startup

```bash
# 1. Build frontend
cd frontend && npm run build

# 2. Start backend (serves both API and frontend)
cd ../backend
python -m app.main
```

Access at: http://localhost:8000

## Architecture

### Backend Structure

**Entry point:** `app/main.py` — FastAPI app, CORS, router registration, exception handlers, `/api/health`, and SPA static-file serving for the Next.js export. API docs (`/api/docs`, `/api/redoc`, `/api/openapi.json`) are gated behind admin auth.

**Config:** `app/config.py` — Pydantic settings. Lots of tunable knobs (token TTL, WebAuthn RP, SMTP, GeoIP, risk thresholds, session limits, verification). `database.py` runs `init_db()` on startup to ensure the admin role/permissions exist.

**Data Models** (`app/models/__init__.py`):
- `User`, `Client`, `Token`, `Session`, `Role`, `Permission`, `Group`, `UserAuthorization`, `AuditLog`
- Invite system: `InviteCode`, `InviteRedemption`
- Security: `Passkey`, `WebAuthnChallenge`, `UserTOTP`, `VerificationSession`, `VerificationCode`, `LoginLog`
- `SystemSetting` (site-wide config)
- Many-to-many: `user_roles`, `role_permissions`, `user_groups`, `client_allowed_groups`, `client_denied_groups`, `user_allowed_apps`, `user_denied_apps`
- Key methods: `User.has_permission()`, `User.has_role()`, `User.in_group()`, `User.can_access_client()`

**Routes** (API endpoints):
- `app/routes/auth.py` — `/api/auth/*` — login, register, logout, token refresh, magic-link login/verify
- `app/routes/oauth.py` — `/api/oauth/*` — authorize (GET client info / POST consent), token, userinfo
- `app/routes/oidc.py` — `/.well-known/openid-configuration`, `/.well-known/jwks.json`
- `app/routes/user.py` — `/api/user/*` — profile, sessions, authorizations, login history, security settings
- `app/routes/client.py` — `/api/clients/*` — OAuth client/app management
- `app/routes/passkey.py` — `/api/passkeys/*` — WebAuthn registration & authentication
- `app/routes/totp.py` — `/api/totp/*` — TOTP setup/verify/disable
- `app/routes/site.py` — `/api/site/*` — public site settings
- `app/api/groups.py` — `/api/groups/*` — user group management (admin)
- `app/api/admin.py` — `/api/admin/*` — users, roles, clients, login logs, app permissions
- `app/api/invites.py` — `/api/admin/invites/*` — invite code management

**Services** (business logic in `app/services/`):
- `auth_service.py` — authentication, JWT issue/validate, session management
- `oauth_service.py` — OAuth 2.0 / OIDC flows
- `passkey_service.py` — WebAuthn credential lifecycle
- `totp_service.py` — TOTP 2FA
- `verification_service.py` — email verification codes & magic links
- `invite_service.py` — invite code creation/redemption/limits
- `risk_service.py` + `login_anomaly_service.py` — risk scoring & anomaly detection
- `session_limit_service.py` — concurrent session enforcement
- `geoip_service.py` — IP geolocation (MaxMind + ip2region + a CN-country reader)
- `email_service.py` — async SMTP via aiosmtplib
- `group_service.py` — user group management
- `site_service.py` — site settings

**Middleware:**
- `app/middleware/auth.py` — JWT auth, provides `get_current_user` dependency
- `app/middleware/permission.py` — `require_permission` decorator (RBAC)

**Utilities:**
- `app/utils/security.py` — bcrypt password hashing, token generation, JWT ops
- `app/utils/device.py` — device identification from User-Agent + IP

**Scripts** (`backend/scripts/`): `init_admin_permissions.py`, `update_geoip.py` (refresh GeoIP databases).

### Frontend Structure

**Stack:** Next.js 15 (App Router, static export `output: 'export'`) · React 19 · TypeScript · Tailwind CSS v4 · **HeroUI v3** (`@heroui/react` 3.x) · Zustand · GSAP (animated home page) · Axios.

**Key files:**
- `lib/api.ts` — Axios client with automatic refresh-token-on-401 interceptor. API groups: `authApi`, `siteApi`, `userApi`, `clientApi`, `groupApi`, `adminApi`, `groupAppApi`, `passkeyApi`, `verificationApi`, `totpApi`.
- `lib/store.ts` — Zustand global state
- `lib/authz.ts`, `lib/webauthn.ts`, `lib/device.ts`, `lib/date.ts`, `lib/admin-utils.tsx` — helpers
- `app/` — App Router pages (see below)
- `components/` — `ui/`, `admin/`, `security/`, `animated-characters/` (GSAP mascot group on the home page), plus `ThemeToggle`, `SidePanel`, `RestrictedModeOverlay`

**Pages:**
- Public: `page.tsx` (home, split-screen with animated characters), `login/` (+ `login/magic-link`, `login/verify`), `register/`, `verify-email/`, `oauth/authorize/` (consent)
- User dashboard: `dashboard/` (`my-apps`, `sessions`, `passkeys`, `security/` + `security/totp`, `authorizations`, `profile`)
- Admin: `admin/` (`users/` + `users/detail` + `users/permissions`, `groups`, `apps/` + `apps/edit`, `invites`, `settings`)

**API client pattern:** the Axios interceptor catches 401, tries a refresh-token request, and retries the original call; on refresh failure it redirects to login.

## Authentication & Security Features

- **Registration control:** `ALLOW_OPEN_REGISTRATION` defaults to **false** — new users join via invite codes. `BOOTSTRAP_ALLOW_FIRST_USER` allows the very first user to self-register.
- **Passkey / WebAuthn:** passwordless login + 2FA-grade credentials. RP config via `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_RP_ORIGIN`.
- **TOTP:** per-user 2FA with QR enrollment (`TOTP_ISSUER`).
- **Email verification & magic links:** codes (`VERIFICATION_CODE_*`) and magic links (`MAGIC_LINK_EXPIRE_MINUTES`) via async SMTP.
- **Risk-based verification:** `risk_service` scores logins; above `RISK_SCORE_MEDIUM`/`RISK_SCORE_HIGH` triggers step-up verification. `BLOCK_SUSPICIOUS_LOGIN` can block outright.
- **Login anomaly detection:** geo-jump (`SUSPICIOUS_LOCATION_DISTANCE_KM`), IP change window (`SUSPICIOUS_IP_CHANGE_HOURS`), velocity (`SUSPICIOUS_LOGIN_VELOCITY_*`). Toggle via `ENABLE_LOGIN_ANOMALY_DETECTION`.
- **Session limits:** `DEFAULT_MAX_SESSIONS` caps concurrent sessions per user; old sessions can be revoked.
- **GeoIP:** `GEOIP_ENABLED` + `IP2REGION_ENABLED` resolve login locations; databases live in `backend/data/` and are **baked into the Docker image** by CI.

## OAuth 2.0 / OIDC Implementation

**Supported flows:**
1. Authorization Code Grant — standard flow with user consent
2. Password Grant — trusted clients only
3. Refresh Token — token renewal without re-authentication

**Access control:**
- Clients have `allowed_groups` (whitelist) and `denied_groups` (blacklist); blacklist wins.
- `User.can_access_client()` enforces group-based access before the consent page.
- Per-user/per-group app permissions (`user_allowed_apps` / `user_denied_apps`, `groupAppApi`) provide finer control.

**Token lifecycle:**
- Access tokens: 15 min (JWT, HS256)
- Refresh tokens: 7 days default, 30 days with "remember me"
- Authorization codes: single-use, short-lived
- Sessions: tracked with `device_id`, individually revocable

**Important path distinction:**
- The **frontend consent page** is served at `/oauth/authorize` (browser URL — handled by SPA fallback).
- The **backend OAuth API** lives under `/api/oauth/*` (`/api/oauth/authorize`, `/api/oauth/token`, `/api/oauth/userinfo`, `/api/oauth/client/{client_id}`). OIDC discovery is at the root: `/.well-known/openid-configuration`, `/.well-known/jwks.json`.

## Database Schema

**Key tables:** `users`, `clients`, `tokens`, `sessions`, `roles`/`permissions`, `groups`, `user_authorizations`, `audit_logs`, `invite_codes`/`invite_redemptions`, `passkeys`/`webauthn_challenges`, `user_totp`, `verification_sessions`/`verification_codes`, `login_logs`, `system_settings`.

Schema is managed by Alembic — see the migration files under `backend/alembic/versions/`.

**Default seed data** (`seed.py`):
- Roles: `admin`, `user`, `guest` (with permissions `admin.*`, `admin.users`, `admin.roles`, `admin.groups`, `admin.clients`)
- Admin user: `admin` / `admin123`
- Internal OAuth client: `client_id=internal`, `client_secret=internal_secret_change_this`
- Default groups: "所有用户" (default), "开发者", "测试用户"

`init_db()` in `database.py` also bootstraps admin permissions on startup if missing.

## Configuration

### Backend (`backend/.env`)

Copy `backend/.env.example` and edit. Critical/interesting vars:

```env
SECRET_KEY=...                      # MUST change in production (token forgery otherwise)
DATABASE_URL=sqlite:///./oauth.db
DEBUG=True
HOST=0.0.0.0
PORT=8000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000
FRONTEND_URL=http://localhost:8000  # for email magic links
STATIC_DIR=                         # optional override for frontend/out

# Registration
ALLOW_OPEN_REGISTRATION=false
BOOTSTRAP_ALLOW_FIRST_USER=true

# WebAuthn / Passkey
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=LAAA OAuth Server
WEBAUTHN_RP_ORIGIN=http://localhost:8000

# Session security & risk
DEFAULT_MAX_SESSIONS=3
ENABLE_LOGIN_ANOMALY_DETECTION=true
RISK_SCORE_MEDIUM=3
RISK_SCORE_HIGH=5
BLOCK_SUSPICIOUS_LOGIN=true

# GeoIP
GEOIP_ENABLED=true
IP2REGION_ENABLED=true

# SMTP (see .env.example for 163/QQ/Gmail/Aliyun presets)
SMTP_ENABLED=false
SMTP_HOST=...
SMTP_PORT=465
SMTP_USE_SSL=true
```

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Deployment

Containerized with a one-shot Docker Compose; images are built and published by GitHub Actions.

- **CI:** `.github/workflows/docker-publish.yml` builds on push to `main`/`dev` and tags `v*`, pushes to `ghcr.io/lynnguo666/laaa:latest`. The image **bundles the built frontend and all three GeoIP databases** (downloaded at build time, cached per day) — no external MaxMind license needed.
- **Compose:** `docker-compose.yml` — `cp backend/.env.example ./env`, edit (at least `SECRET_KEY`), then `docker compose pull && docker compose up -d`. Persists `./oauth.db` and optionally `./data` (to override the bundled GeoIP DBs). Health check hits `/api/health`.
- **Docs:** see `DEPLOY.md` for the full deployment guide (reverse proxy / HTTPS termination, env overrides, etc.).

## Testing OAuth Flows

### Quick test setup

1. Log in with the default admin: `admin` / `admin123`
2. Create a test app in Dashboard → My Apps; note its Client ID + Secret
3. Visit the authorize URL in a browser (frontend consent page):
   ```
   http://localhost:8000/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3000/callback&scope=profile%20email
   ```

### Exchange code for token (note the `/api/oauth` prefix)

```bash
curl -X POST http://localhost:8000/api/oauth/token \
  -d "grant_type=authorization_code" \
  -d "code=YOUR_CODE" \
  -d "redirect_uri=http://localhost:3000/callback" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET"
```

### Access user info

```bash
curl http://localhost:8000/api/oauth/userinfo \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Important Implementation Details

### Static file serving

`app/main.py` mounts `/_next/` and provides a catch-all `serve_frontend` that handles:
- API routes (prefixed `api/`) → 404 JSON, never served as static
- Exact files, `dir/index.html`, `path.html`, trailing-slash variants
- Final fallback to `index.html` for client-side routing (so `/oauth/authorize`, `/dashboard/...` resolve to the SPA)

`STATIC_DIR` env var overrides the default `frontend/out/` location (used by the Docker image, which sets `STATIC_DIR=/app/frontend/out`).

### Permission system

Permissions use dot notation with wildcard support:
- `admin.*` grants all admin permissions
- Specific: `admin.users`, `admin.roles`, `admin.groups`, `admin.clients`
- Check with `User.has_permission('admin.users')` or `@require_permission('admin.users')`

### Security considerations

- Passwords hashed with bcrypt (4.0+, no passlib — for Python 3.13 compatibility)
- Client secrets stored as hashed tokens
- JWTs signed with HS256
- Authorization codes are single-use
- Device identification for session management
- CORS via `ALLOWED_ORIGINS`
- API docs (`/api/docs`, `/api/redoc`) require admin auth

## API Documentation

Interactive docs (admin-only):
- Swagger UI: http://localhost:8000/api/docs
- ReDoc: http://localhost:8000/api/redoc
- OpenAPI JSON: http://localhost:8000/api/openapi.json

## Common Development Tasks

### Adding a new API endpoint

1. Define Pydantic schemas in `app/schemas/` (or inline in the route)
2. Implement business logic in `app/services/`
3. Create the route handler in `app/routes/` (or `app/api/`) with the right `APIRouter(prefix=...)`
4. Include the router in `app/main.py`
5. Add the corresponding method to `frontend/lib/api.ts`

### Adding a new permission

1. Add the permission to `permissions_data` in `seed.py`
2. Assign it to the appropriate role(s) in `roles_data`
3. Re-run `python seed.py` (or insert manually); `init_db()` also backfills admin permissions on startup
4. Guard routes with `@require_permission('permission.code')`

### Modifying the database schema

1. Update models in `app/models/__init__.py`
2. Generate a migration: `cd backend && alembic revision --autogenerate -m "describe change"`
3. Review the generated migration, then `alembic upgrade head`
4. (Development-only clean reset: delete `oauth.db` → `alembic upgrade head` → `python seed.py`)

### Adding frontend pages

1. Create the page under `app/` following App Router conventions
2. Add API calls via methods in `lib/api.ts`
3. `npm run build` to regenerate the static export
4. Restart the backend to serve the new static files
