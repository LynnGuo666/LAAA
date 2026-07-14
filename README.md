# LAAA

> 个人 OAuth 2.0 / OIDC 授权服务器与统一身份平台。

LAAA 是一个用 **FastAPI**(后端)+ **Next.js**(前端)自建的身份平台。它从一个基础 OAuth 服务器起步,已经长成一个完整的统一身份中心:支持密码 / 通行密钥 / TOTP / 邮箱验证码 / 魔法链接等多种登录方式,内置风控与异常检测、GeoIP 定位、用户组与 RBAC、邀请码注册,并提供完整的 OAuth 2.0 / OIDC 端点供第三方应用接入。

后端同时托管 Next.js 静态导出产物,因此**只需运行一个后端进程**即可同时提供 API 与前端页面。

---

## ✨ 特性

### 认证与登录

- **OAuth 2.0**:授权码流(Authorization Code)、密码流(Password Grant,仅受信任客户端)、刷新令牌流(Refresh Token)
- **OIDC**:`/.well-known/openid-configuration`、`/.well-known/jwks.json`、`userinfo`、`id_token`(含 `nonce` / `at_hash`)
- **PKCE**(RFC 7636):支持 `S256` / `plain`,公开客户端强制使用
- **令牌吊销 / 内省**(RFC 7009 / RFC 7662):`/revoke`、`/introspect`
- **通行密钥 / WebAuthn**:无密码登录 + 2FA 级凭证
- **TOTP 2FA**:扫码绑定,带备用码
- **邮箱验证 + 魔法链接**:异步 SMTP 发送验证码与登录链接
- **邀请码注册**:默认关闭开放注册,新用户凭邀请码加入并落到指定用户组

### 安全

- **RS256 非对称签名**:access / id token 用 RSA 私钥签发,公钥经 JWKS 暴露;refresh token 用对称密钥(不对外暴露)
- **令牌即时吊销**:`token_version` 机制——改密 / 重置密码时用户 `tv+1`,旧 access token 立即失效;封禁用户(`status=suspended`)在鉴权时被拒,效果等同吊销
- **风险评分登录**:`risk_service` 对登录打分,超阈值触发步骤验证(step-up),可配置直接阻断可疑登录
- **登录异常检测**:地理跳跃、IP 变更窗口、登录频率(velocity)
- **会话限制**:每用户最大并发会话数,旧会话可撤销;设备级信任标记
- **时序侧信道加固**:登录失败走 dummy hash 保持常量时间;secret / 验证码 / TOTP 备用码比较用 `hmac.compare_digest`
- **分层速率限制**(slowapi):登录 / 注册 / token / 验证码 / 魔法链接等敏感端点独立限流
- **SQLite WAL**:并发读写更稳

### 管理与访问控制

- **多应用 / 用户组 / RBAC**:每个 OAuth 应用可配白名单 / 黑名单用户组;`User.can_access_client()` 在授权前强制校验
- **细粒度应用权限**:per-user 与 per-group 的允许 / 拒绝应用列表(个人覆盖 > 组 > 默认)
- **审计与登录日志**:全量登录记录(成功 / 失败 / 可疑),含地理位置与设备
- **站点级设置**:站点名等对外配置

### 可观测性与运维

- **结构化日志**:`LOG_FORMAT=json` 启用 structlog JSON 行;`SENTRY_DSN` 启用错误上报(均默认关闭)
- **请求追踪**:`X-Request-ID` 中间件贯穿日志
- **健康探针**:`/api/health`(liveness)+ `/api/ready`(readiness,深度检查 DB)
- **GeoIP**:MaxMind GeoLite2(国际)+ ip2region(中国 IP 省份)+ GeoIP2-CN(中国国家级),数据库镜像内置,**无需 MaxMind license**
- **CI 质量门**:ruff + pytest + bandit + pip-audit + ESLint + tsc

---

## 🏗 架构

```
┌─────────────────────────────────────────────────────────┐
│                      FastAPI 后端                        │
│  app/main.py  ──  lifespan / 中间件 / 路由 / SPA 托管    │
│     ├── routes/   auth oauth oidc user client passkey …  │
│     ├── services/  auth oauth passkey totp risk geoip …  │
│     ├── middleware/  auth(jwt) ratelimit observability   │
│     └── utils/  security(RS256 keystore) time device     │
│                                                          │
│   SQLite (WAL)  ←  SQLAlchemy  ←  Alembic 迁移           │
│                                                          │
│   托管 Next.js 静态导出 (frontend/out/)                  │
└─────────────────────────────────────────────────────────┘
        ▲                                ▲
        │ 浏览器(/login /dashboard …)    │ 第三方应用(OAuth/OIDC)
        └────────────────────────────────┘
```

后端入口 `app/main.py` 挂载 `/_next/` 静态资源,并提供 catch-all 把所有非 `/api` 路径回落到 `index.html`(SPA 路由)。`STATIC_DIR` 可覆盖静态目录位置(镜像内设为 `/app/frontend/out`)。

**技术栈:**

| 层 | 技术 |
|---|---|
| 后端 | Python 3.11+ · FastAPI · SQLAlchemy 2 · SQLite(WAL) · Alembic · slowapi · structlog / sentry-sdk |
| 前端 | Next.js 15(App Router,静态导出) · React 19 · TypeScript · Tailwind v4 · HeroUI v3 · Zustand · GSAP |
| 签名 | access/id token:RS256(RSA-2048) · refresh token:HS256 |
| 认证 | WebAuthn / Passkey · TOTP · 邮箱验证码 / 魔法链接 · JWT |

---

## 🚀 快速开始

### 方式一:Docker(最快)

```bash
# 1. 准备配置
cp backend/.env.example ./env
# 编辑 ./env,至少设置:
#   SECRET_KEY=<≥32 字符随机串,必改>
#   WEBAUTHN_RP_ID / WEBAUTHN_RP_ORIGIN / FRONTEND_URL / ALLOWED_ORIGINS

# 2. 生成 RS256 签名密钥对(access/id token 用)
docker run --rm -v "$PWD/jwt_keys:/jwt_keys" \
  ghcr.io/lynnguo666/laaa:latest \
  python scripts/generate_jwt_keys.py --out-dir /jwt_keys
# 在 ./env 补充:
#   JWT_PRIVATE_KEY_PATH=/app/jwt_keys/jwt_private.pem
#   JWT_PUBLIC_KEY_PATH=/app/jwt_keys/jwt_public.pem
# 并在 docker-compose.yml 挂载: - ./jwt_keys:/app/jwt_keys

# 3. 拉起
docker compose pull
docker compose up -d

# 4. 访问
open http://localhost:8000
curl http://localhost:8000/api/health   # {"status":"ok"}
```

> 镜像由 GitHub Actions 自动构建并推送到 `ghcr.io/lynnguo666/laaa`,**内置前端产物与三套 GeoIP 数据库**,开箱即用。完整部署(反代 / HTTPS / 升级 / 故障排查)见 [DEPLOY.md](DEPLOY.md)。

首次启动自动初始化数据库并创建默认管理员(`admin` / `admin123`,**登录后立即改密码**)。

### 方式二:本地开发

```bash
# 后端
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 生成 RS256 密钥对(开发用)
python scripts/generate_jwt_keys.py --out-dir ./jwt_keys

# 配置环境变量
cp .env.example .env
# 编辑 .env:SECRET_KEY / DATABASE_URL / JWT_PRIVATE_KEY_PATH=jwt_keys/jwt_private.pem / JWT_PUBLIC_KEY_PATH=jwt_keys/jwt_public.pem

# 初始化数据库 + 种子数据
alembic upgrade head   # 应用迁移(初始迁移为空,表由 init_db 建立)
python seed.py         # 创建默认角色/权限/admin 用户/内部 client

# 启动后端
python -m app.main     # 或 uvicorn app.main:app --reload

# 前端(另一个终端)
cd frontend
npm install
npm run dev            # 开发模式;生产用 npm run build 生成 frontend/out/
```

访问 http://localhost:8000。开发时前端可单独跑在 3000 端口(`npm run dev`),通过 `NEXT_PUBLIC_API_URL` 指向后端。

---

## 🔑 核心概念

### Token 生命周期

| 令牌 | 算法 | 有效期 | 说明 |
|---|---|---|---|
| access token | RS256 | 15 分钟 | JWT,无状态,经 JWKS 公钥验证;`token_version` 变更即时吊销 |
| refresh token | HS256 | 7 天(OAuth 流)/ 30 天(平台登录 + 记住我) | DB 存 hash,刷新时轮换 |
| authorization code | — | 10 分钟 | 单次使用,绑定 redirect_uri / PKCE / nonce |
| id token | RS256 | 15 分钟 | OIDC,含 `sub`/`aud`/`iss`/`nonce`/`at_hash` |

### 应用访问控制(优先级从高到低)

1. 用户级拒绝(`user_denied_apps`)→ **拒绝**
2. 用户级允许(`user_allowed_apps`)→ 允许
3. 组级拒绝(`group_denied_apps`)→ **拒绝**
4. 组级允许(`group_allowed_apps`)→ 允许
5. 回落到 `client.default_access`(True=开放 / False=需显式授权)

此外,客户端可配 `allowed_groups`(白名单)/ `denied_groups`(黑名单,黑名单优先)。账户须同时满足**邮箱已验证**且**已启用 TOTP 或绑定通行密钥**才能完成 OAuth 授权(否则进入受限模式)。

---

## 📚 文档

- **[DEPLOY.md](DEPLOY.md)** — 部署指南(本地试用 / 生产 / 反向代理 / GeoIP / CI / 验证清单 / 故障排查)
- **[docs/oauth-integration.md](docs/oauth-integration.md)** — 第三方应用接入 LAAA 的完整 OAuth 2.0 / OIDC 集成指南(discovery、三种 grant、PKCE、token 校验、错误码)
- **[docs/api-reference.md](docs/api-reference.md)** — 全量 API 端点参考(按模块分组,含鉴权要求)
- **[CLAUDE.md](CLAUDE.md)** — 给 AI 助手的开发指南(架构 / 命令 / 常见开发任务)

交互式 API 文档(仅管理员可访问):启动后访问 `/api/docs`(Swagger)、`/api/redoc`(ReDoc)。

---

## ⚙️ 配置

所有配置通过环境变量注入,见 [`backend/.env.example`](backend/.env.example)。关键项:

| 变量 | 必填 | 说明 |
|---|---|---|
| `SECRET_KEY` | ✅ | ≥32 字符随机串,用于 refresh token 签名;占位串会被启动校验拒绝 |
| `DATABASE_URL` | ✅ | SQLite 路径,默认 `sqlite:///./oauth.db` |
| `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` | ✅ | RS256 密钥对路径,用 `scripts/generate_jwt_keys.py` 生成 |
| `ALLOWED_ORIGINS` | | CORS 允许来源(逗号分隔) |
| `FRONTEND_URL` | | 邮件魔法链接里的前端地址 |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_ORIGIN` | | Passkey 依赖方(生产用实际域名) |
| `OIDC_ISSUER` | | OIDC issuer 覆盖;反代后建议显式设为 `https://<域名>` 避免 http/https 不一致 |
| `ALLOW_OPEN_REGISTRATION` | | 默认 `false`,新用户需邀请码 |
| `SMTP_*` | | 邮件配置(.env.example 含 163/QQ/Gmail/阿里云预设) |
| `LOG_FORMAT` / `SENTRY_DSN` | | 可观测性开关,默认关闭 |

完整配置项清单见 [docs/api-reference.md](docs/api-reference.md) 末尾「配置项参考」。

---

## 🧪 测试与质量

```bash
cd backend
ruff check app/ tests/          # lint
pytest tests/ -v                # 单元 + 集成测试(51 个)
bandit -r app -ll               # 安全扫描
pip-audit -r requirements.lock  # 依赖 CVE 扫描
```

```bash
cd frontend
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
```

CI(`.github/workflows/quality.yml`)在 push / PR 到 `main` / `dev` 时自动跑上述全部检查。

---

## 📂 项目结构

```
LAAA/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口、lifespan、中间件、SPA 托管
│   │   ├── config.py            # Pydantic settings(含 SECRET_KEY / JWT 校验)
│   │   ├── database.py          # engine、WAL、init_db
│   │   ├── models/              # SQLAlchemy 模型(User/Client/Token/Session/…)
│   │   ├── routes/              # auth oauth oidc user client passkey totp site
│   │   ├── api/                 # admin groups invites
│   │   ├── services/            # 业务逻辑(auth/oauth/risk/geoip/…)
│   │   ├── middleware/          # auth ratelimit observability
│   │   └── utils/               # security(RS256 keystore) time device
│   ├── alembic/                 # 数据库迁移
│   ├── scripts/                 # generate_jwt_keys / update_geoip / init_admin_permissions
│   ├── tests/                   # pytest
│   ├── seed.py                  # 种子数据
│   ├── requirements.txt / .lock
│   └── .env.example
├── frontend/
│   ├── app/                     # Next.js App Router 页面
│   ├── lib/                     # api.ts store.ts webauthn.ts …
│   └── components/              # ui admin security animated-characters
├── docs/                        # oauth-integration.md api-reference.md
├── Dockerfile                   # 多阶段:前端构建 + 后端运行
├── docker-compose.yml
└── DEPLOY.md
```

---

## 🔒 安全说明

- 密码用 bcrypt(≥4.0,无 passlib 依赖,兼容 Python 3.13)哈希;**密码策略**:≥12 字符且至少包含大写 / 小写 / 数字 / 特殊中的 3 类
- client secret 存为 hash token;JWT 用 RS256(access/id)/ HS256(refresh)
- 授权码单次使用;设备指纹用于会话管理
- API 文档端点(`/api/docs` 等)需管理员鉴权
- **生产部署务必**:改 `SECRET_KEY`、生成并挂载 RS256 密钥、`DEBUG=False`、前置 HTTPS 反代、对齐 `WEBAUTHN_RP_*` / `OIDC_ISSUER` 域名

> ⚠️ 这是个人项目,安全实现尽力而为但未经第三方审计。生产用于高敏感场景前建议自行复核。

---

## 📄 License

MIT
