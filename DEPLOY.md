# LAAA 部署指南

LAAA 是 FastAPI（后端）+ Next.js 静态导出（前端）的单体应用。提供两套 compose 编排：

- **`docker-compose.yml`** — 本地构建 + 后端代码 bind mount + `uvicorn --reload`。改后端代码即时生效,适合开发与本地预演。
- **`docker-compose.prod.yml`** — 拉取 CI 预构建镜像(`ghcr.io/lynnguo666/laaa`),镜像内置前端产物和三套 GeoIP 数据库,不挂载代码,适合服务器部署。

两种形态的后端都从 `/app/frontend/out` 提供前端静态文件,并内置 GeoIP 用于登录地理位置/异常检测。

本文档面向**部署方**（在服务器上运行镜像的人）。若你只是想本地跑起来开发,用仓库根目录的 `./start.sh dev|prod` 一键脚本(无 Docker)即可,详见 [README.md](README.md)。

---

## 前置条件

- Docker 20+ 与 Docker Compose v2（`docker compose` 子命令）
- 生产部署:一台能访问 ghcr.io 的服务器（拉取镜像）
- 生产部署:一个反向代理（Nginx / Caddy / Traefik 等）做 HTTPS 终止——除非你只在本地试用

---

## 一、最快上手（本地试用：本地构建 + 代码挂载）

```bash
# 1. 克隆
git clone https://github.com/LynnGuo666/LAAA.git
cd LAAA

# 2. 准备环境变量文件
cp backend/.env.example ./env
# 编辑 ./env，至少改：
#   SECRET_KEY=<≥32 字符随机串>         ← 必改，占位串会被启动校验拒绝
#   JWT_PRIVATE_KEY_PATH=jwt_keys/jwt_private.pem   ← RS256 签名密钥(下方生成)
#   JWT_PUBLIC_KEY_PATH=jwt_keys/jwt_public.pem
#   ALLOWED_ORIGINS=http://localhost:8000
#   FRONTEND_URL=http://localhost:8000
#   WEBAUTHN_RP_ID=localhost
#   WEBAUTHN_RP_ORIGIN=http://localhost:8000

# 3. 生成 RS256 签名密钥对(只生成一次,随卷持久化)
#    用本地构建的镜像跑脚本(免本地装依赖),需挂载 backend/app 让脚本能 import:
mkdir jwt_keys
docker compose run --rm --no-deps \
  -v "$PWD/jwt_keys:/jwt_keys" \
  -v "$PWD/backend/app:/app/app" \
  laaa python scripts/generate_jwt_keys.py --out-dir /jwt_keys

# 4. 构建并启动(首次或前端改动后加 --build)
docker compose up -d --build

# 5. 访问
open http://localhost:8000        # 首页
curl http://localhost:8000/api/health   # 应返回 {"status":"ok"}
```

日常只改后端代码:`docker compose up -d`(不带 `--build`,镜像层缓存命中,秒起 + reload)。
看日志 / 停止:`docker compose logs -f laaa` / `docker compose down`。

> ⚠️ **必须生成 RS256 密钥对**。access token / id token 用 RS256 非对称签名,未配置密钥时登录与 OAuth 签发 token 会失败。`jwt_keys/` 已由 compose 挂载到容器 `/app/jwt_keys`,私钥不入镜像、不进 git。


首次启动会自动初始化数据库并创建默认管理员（用户名 `admin` / 密码 `admin123`，**登录后立即改密码**）。

---

## 二、生产部署

生产用 `docker-compose.prod.yml`,拉取 CI 预构建镜像(内置前端 + GeoIP,不挂载后端代码,`DEBUG=False`)。

### 1. 准备配置

把 `backend/.env.example` 复制为部署目录下的 `./env`，按生产环境修改：

| 变量 | 说明 | 生产示例 |
|---|---|---|
| `SECRET_KEY` | refresh token 签名密钥，**必改**(≥32 字符) | `openssl rand -hex 32` 生成 |
| `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` | RS256 密钥对(access/id token),**必配** | `jwt_keys/jwt_private.pem` 等(见上方生成步骤) |
| `OIDC_ISSUER` | OIDC issuer，反代后**必须显式设**避免 http/内网地址 | `https://laaa.example.com` |
| `DATABASE_URL` | SQLite 路径，保持默认即可 | `sqlite:///./oauth.db` |
| `DEBUG` | 生产置 `False`(prod compose 已强制) | `False` |
| `ALLOWED_ORIGINS` | 前端来源（逗号分隔） | `https://laaa.example.com` |
| `FRONTEND_URL` | 邮件魔法链接里的前端地址 | `https://laaa.example.com` |
| `WEBAUTHN_RP_ID` | Passkey 依赖方 ID = 域名 | `laaa.example.com` |
| `WEBAUTHN_RP_ORIGIN` | Passkey 来源 | `https://laaa.example.com` |
| `ALLOW_OPEN_REGISTRATION` | 是否开放注册 | `false` |
| `SMTP_*` | 邮件（验证码/魔法链接），见 `.env.example` 注释 | 按服务商填 |

> `docker-compose.prod.yml` 已把 `HOST`/`PORT`/`STATIC_DIR`/`DATABASE_URL`/`DEBUG` 设为容器内默认，`./env` 不填也行；但 `SECRET_KEY`、`JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH`、`OIDC_ISSUER` 和域名相关项**必须**显式设置。

### 2. 数据持久化

`docker-compose.prod.yml`(及本地版)挂了三个卷，**不要删**：

- `./oauth.db:/app/oauth.db` — SQLite 数据库。容器升级/重建后用户、会话、应用配置全靠它保留。
- `./jwt_keys:/app/jwt_keys` — RS256 JWT 签名密钥对。私钥用于签发 access/id token，**不入镜像、不进 git**，随卷持久化（密钥丢了所有已签发 token 立即失效，用户需重新登录；可重新生成但 RP 侧 JWKS 缓存会过期自动刷新）。
- `./data:/app/data` — 可选。若想用**自有** GeoIP 数据库覆盖镜像内置的，把 `ip2region.xdb` / `GeoIP2-CN.mmdb` / `GeoLite2-City.mmdb` 放进 `./data/` 即可；不放则用镜像自带的。

> 本地构建版还多挂一个 `./backend/app:/app/app` —— 后端代码 bind mount,配合 `--reload` 热重载。生产版不挂此项,代码已在镜像内。

> 首次 `up` 前无需手动创建 `oauth.db`/`data`，compose 会自动建空目录/空文件。SQLite 会在首次启动时由应用自动建表。`jwt_keys/` 须先按上方步骤生成密钥对再 up。

### 3. 拉起与升级

```bash
# 生产
docker compose -f docker-compose.prod.yml pull          # 拉取最新镜像
docker compose -f docker-compose.prod.yml up -d         # 后台启动/重建
docker compose -f docker-compose.prod.yml logs -f laaa  # 看日志
docker compose -f docker-compose.prod.yml down          # 停止（保留数据）
```

**升级**：`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`，`oauth.db` 会保留。

---

## 三、反向代理 / HTTPS

生产应在前置 Nginx/Caddy 做 HTTPS 终止，再反代到容器的 8000 端口。

### 域名一致性（重要）

以下三个变量**必须指向同一个域名**，否则 Passkey 注册/登录会失败、邮件链接会 404：

```env
ALLOWED_ORIGINS=https://laaa.example.com
FRONTEND_URL=https://laaa.example.com
WEBAUTHN_RP_ID=laaa.example.com
WEBAUTHN_RP_ORIGIN=https://laaa.example.com
```

### Nginx 示例

```nginx
server {
    listen 443 ssl http2;
    server_name laaa.example.com;

    ssl_certificate     /etc/letsencrypt/live/laaa.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/laaa.example.com/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;   # WebSocket（如未来用）
        proxy_set_header Connection "upgrade";
    }
}
```

> 反向代理须把真实客户端 IP 透传（`X-Forwarded-For`），GeoIP 才能定位到正确地理位置。否则应用只能看到反代 IP。

---

## 四、GeoIP（地理位置）说明

镜像已内置三个 GeoIP 数据库（由 CI 构建时从公开源下载）：

| 库 | 作用 | 来源 |
|---|---|---|
| `ip2region.xdb` | 中国 IP 省市定位 | `lionsoul2014/ip2region` |
| `GeoIP2-CN.mmdb` | 中国 IP 国家级 | `Hackl0us/GeoIP2-CN` |
| `GeoLite2-City.mmdb` | 国际 IP 定位 | `P3TERX/GeoLite.mmdb` |

**无需 MaxMind license key**——三个库都是公开 GitHub 资源。GeoIP 数据库每日由上游自动更新，CI 构建时取最新版并按天缓存。

如果想禁用（例如降级到不记录位置）：

```env
GEOIP_ENABLED=false
IP2REGION_ENABLED=false
```

代码对数据库缺失有 `os.path.exists` 容错，缺库时优雅降级（print 警告、跳过定位），不影响登录主流程。

---

## 五、镜像 tag 与 CI

GitHub Actions（`.github/workflows/docker-publish.yml`）在以下情况自动构建并推送：

- push 到 `main` 或 `dev` 分支
- 推送 `v*` tag（如 `v1.0.0`）
- 手动 `workflow_dispatch`

镜像 tag 策略：

- `ghcr.io/lynnguo666/laaa:latest` — 最新
- `ghcr.io/lynnguo666/laaa:<分支名或tag名>` — 如 `dev`、`main`、`v1.0.0`
- `ghcr.io/lynnguo666/laaa:<commit sha>` — 精确版本

> owner 取自仓库所有者小写形式。如果你 fork 了本仓库，把 `docker-compose.prod.yml` 里的镜像名改为 `ghcr.io/<你的小写owner>/laaa`。

---

## 六、验证清单

部署完成后逐项确认：

- [ ] `curl https://<域名>/api/health` 返回 `{"status":"ok"}`
- [ ] `curl https://<域名>/.well-known/openid-configuration` 返回 JSON，`issuer` 是 `https://<域名>`（验证 `OIDC_ISSUER` 已设）
- [ ] `curl https://<域名>/.well-known/jwks.json` 返回含 `kid`/`n`/`e` 的公钥（验证 RS256 密钥已挂载）
- [ ] 浏览器访问首页正常渲染（非 404 JSON）—— 验证前端静态文件 `STATIC_DIR` 生效
- [ ] `/login` 能打开登录页并能成功登录（验证 RS256 签发正常）
- [ ] 登录后「会话列表」的「位置」字段有值（验证 GeoIP 生效）
- [ ] 容器日志无 `database not found` / `JWT RS256 keys not configured` 警告：`docker compose logs laaa | grep -iE "not found|not configured"`
- [ ] `docker compose down && docker compose up -d` 后，用户/会话数据仍在（验证 `oauth.db` 持久化）
- [ ] Passkey 注册+登录成功（验证 `WEBAUTHN_RP_*` 域名对齐）

---

## 七、故障排查

| 现象 | 排查 |
|---|---|
| 首页返回 `{"error":"Not found"}` JSON | 前端静态文件未生效。进容器 `docker exec -it laaa ls /app/frontend/out/index.html` 应存在；检查 `STATIC_DIR=/app/frontend/out` |
| 登录失败 / OAuth 签发 token 报错 | RS256 密钥未挂载。`docker exec -it laaa ls /app/jwt_keys/` 应见 `jwt_private.pem`/`jwt_public.pem`；检查 `.env` 的 `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` 与 compose 挂载 |
| `/.well-known/jwks.json` 返回 `{"keys":[]}` | 公钥路径未配置或文件不存在；同上排查 `jwt_keys` |
| 第三方应用校验 id_token 失败 `iss` 不匹配 | 反代后未设 `OIDC_ISSUER`，issuer 带了 `http://` 或内网地址；在 `./env` 显式设 `OIDC_ISSUER=https://<域名>` |
| 登录后位置为空 | GeoIP 库缺失或 `GEOIP_ENABLED=false`。`docker exec -it laaa ls /app/data/` 应见三个库文件 |
| Passkey 注册失败 | `WEBAUTHN_RP_ID` 必须等于访问域名，`WEBAUTHN_RP_ORIGIN` 必须是 `https://<域名>` |
| 邮件链接 404 | `FRONTEND_URL` 未对齐实际访问地址 |
| 升级后数据丢失 | `./oauth.db` 没正确挂载，检查 `docker compose config` 里 volumes |
| 升级后所有用户被踢下线 | `./jwt_keys` 未持久化或被重新生成，密钥变了旧 token 全部失效（预期行为）；保留好 `jwt_keys` 卷即可避免 |
| 拉不到镜像 | ghcr.io 镜像默认是 private；到 GitHub 包设置页改 public，或用 `docker login ghcr.io` 拉取 |
| 本地构建版改后端代码不生效 | 确认 `docker-compose.yml` 挂了 `./backend/app:/app/app`,且 `command` 带 `--reload --reload-dir /app/app`;`docker compose up -d` 不带 `--build` 即可(代码是挂载的,无需重建) |
| 本地构建版前端改动不生效 | 前端静态产物烘焙在镜像里,改前端后必须 `docker compose up -d --build` 重建镜像 |
