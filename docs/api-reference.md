# LAAA API 端点参考

LAAA 后端所有 HTTP 端点,按模块分组。鉴权要求含义:

- **public** — 无需登录
- **user** — 须带有效 access token(`Authorization: Bearer <token>`),且账户未停用
- **admin:admin.xxx** — 须 user 鉴权 + 拥有对应权限(如 `admin.users` / `admin.clients` / `admin.groups` / `admin.roles`);`admin.*` 通配所有 admin 权限
- **admin** — 须 user 鉴权 + admin 角色或 `admin.*` 权限

> 除下列端点外,交互式文档 `/api/docs`(Swagger)、`/api/redoc`(ReDoc)、`/api/openapi.json` 需 **admin** 鉴权。
>
> 所有非 `/api` 路径由前端 SPA 接管(见 [页面路由](#页面路由))。

---

## 目录

- [Authentication(认证)](#authentication认证)
- [OAuth 2.0](#oauth-20)
- [OpenID Connect](#openid-connect)
- [User Management(用户)](#user-management用户)
- [Client Management(应用管理)](#client-management应用管理)
- [Passkeys(通行密钥)](#passkeys通行密钥)
- [TOTP](#totp)
- [Site(站点)](#site站点)
- [Groups(用户组)](#groups用户组)
- [Admin(管理)](#admin管理)
- [Invites(邀请码)](#invites邀请码)
- [System(系统)](#system系统)
- [页面路由](#页面路由)
- [配置项参考](#配置项参考)

---

## Authentication(认证)

前缀 `/api/auth`。登录 / 注册 / token 刷新 / 邮箱验证 / 风控二次验证 / 魔法链接。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | public | 注册新用户(可选邀请码),并发送邮箱验证邮件 |
| POST | `/api/auth/login` | public | 用户名密码登录;风控触发时返回 202 二次验证要求 |
| POST | `/api/auth/refresh` | public | 用 refresh token 刷新 access token |
| POST | `/api/auth/logout` | user | 登出并吊销 refresh token |
| GET | `/api/auth/me` | user | 获取当前登录用户信息(含权限 / 角色 / 受限状态) |
| GET | `/api/auth/verify/status/{session_token}` | public | 查询风控验证会话的当前状态 |
| POST | `/api/auth/verify/email-code/send` | public | 发送邮箱验证码(用于风控二次验证) |
| POST | `/api/auth/verify/email-code` | public | 校验邮箱验证码并推进验证流程,完成则签发 token |
| POST | `/api/auth/verify/totp` | public | 校验 TOTP 动态码并推进验证流程 |
| POST | `/api/auth/verify/backup-code` | public | 校验 TOTP 备用码并推进验证流程 |
| POST | `/api/auth/verify/magic-link/send` | public | 发送魔法链接(用于风控二次验证) |
| GET | `/api/auth/verify/magic-link/{token}` | public | 校验魔法链接 token 完成风控验证 |
| POST | `/api/auth/magic-link/login` | public | 请求独立魔法链接登录(免密码) |
| GET | `/api/auth/magic-link/login/{token}` | public | 校验魔法链接完成独立登录(高风险会被拒) |
| POST | `/api/auth/verify/passkey/start` | public | 发起通行密钥风控验证,返回认证选项 |
| POST | `/api/auth/verify/passkey/complete` | public | 完成通行密钥风控验证 |
| POST | `/api/auth/send-verification-email` | user | 向当前用户邮箱发送验证链接(含频控) |
| GET | `/api/auth/verify-email/{token}` | public | 通过邮件 token 验证邮箱(或确认邮箱变更) |
| POST | `/api/auth/verify/skip` | public | 跳过风控验证,以受限模式登录 |
| POST | `/api/auth/change-email` | user | 发起邮箱变更(需确认当前密码,发验证链接到新邮箱) |

---

## OAuth 2.0

前缀 `/api/oauth`。第三方应用接入详见 [oauth-integration.md](oauth-integration.md)。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/oauth/client/{client_id}` | public | 根据 client_id 获取应用公开信息 |
| GET | `/api/oauth/authorize` | public | OAuth 授权端点(GET);已登录且已授权则直接下发 code,否则重定向登录 |
| POST | `/api/oauth/authorize` | public | OAuth 授权端点(POST),处理用户同意 / 拒绝并下发 code |
| POST | `/api/oauth/token` | public | token 端点,支持 `authorization_code` / `refresh_token` / `password` 三种授权(含 PKCE) |
| POST | `/api/oauth/introspect` | public* | RFC 7662 token 内省;资源服务器凭 client 凭据查询 token 有效性(*需 client 认证) |
| POST | `/api/oauth/revoke` | public* | RFC 7009 token 吊销(主要清 refresh token,始终返回 200;*需 client 认证) |
| GET | `/api/oauth/userinfo` | public* | OIDC userinfo;凭 Bearer access token 按 scope 返回 claims(*需有效 token) |

> `introspect` / `revoke` 虽然路径上无 user 鉴权,但都要求 client 凭据认证(client_secret 或 PKCE),未通过则 401 `invalid_client`。

---

## OpenID Connect

无前缀(根路径)。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/.well-known/openid-configuration` | public | OIDC 发现端点;返回 issuer / 端点 / 支持的 grant_type / scope / claims / 签名算法等 |
| GET | `/.well-known/jwks.json` | public | JWKS 端点;暴露 RS256 签名公钥(kid 索引) |

---

## User Management(用户)

前缀 `/api/user`。当前用户自助管理:资料、会话、授权、安全设置、改密。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/user/me` | user | 获取当前用户资料(含角色 / 权限 / 分组 / 是否管理员) |
| PUT | `/api/user/me` | user | 更新当前用户资料(邮箱 / 头像) |
| GET | `/api/user/authorizations` | user | 获取当前用户已授权的应用列表 |
| DELETE | `/api/user/authorizations/{auth_id}` | user | 撤销对某应用的授权及相关 token |
| GET | `/api/user/sessions` | user | 获取当前用户的活跃会话(设备)列表,标记当前设备 |
| DELETE | `/api/user/sessions/{session_id}` | user | 注销指定会话(忘记设备) |
| GET | `/api/user/apps` | user | 获取当前用户可访问的应用列表(基于权限) |
| GET | `/api/user/login-history` | user | 获取当前用户的登录历史(分页) |
| GET | `/api/user/security-settings` | user | 获取用户安全设置(最大会话数 / 新登录通知) |
| PUT | `/api/user/security-settings` | user | 更新用户安全设置(最大会话数仅管理员可改) |
| POST | `/api/user/sessions/{session_id}/trust` | user | 将指定会话标记为受信任设备 |
| DELETE | `/api/user/sessions/{session_id}/trust` | user | 取消指定会话的受信任标记 |
| POST | `/api/user/sessions/revoke-others` | user | 注销除当前会话外的所有其他会话 |
| PUT | `/api/user/password` | user | 修改当前用户密码并吊销其他设备的 token / 会话(`token_version+1`) |

---

## Client Management(应用管理)

前缀 `/api/clients`。OAuth 应用 CRUD,需 `admin.clients` 权限。创建应用还要求当前管理员邮箱已验证(否则 403)。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/clients` | admin:admin.clients | 创建新的 OAuth 应用(返回一次性明文 secret;要求邮箱已验证) |
| GET | `/api/clients` | admin:admin.clients | 获取所有 OAuth 应用列表 |
| GET | `/api/clients/{client_id}` | admin:admin.clients | 获取单个 OAuth 应用详情 |
| PUT | `/api/clients/{client_id}` | admin:admin.clients | 更新 OAuth 应用信息 |
| DELETE | `/api/clients/{client_id}` | admin:admin.clients | 删除 OAuth 应用 |
| POST | `/api/clients/{client_id}/secret` | admin:admin.clients | 重置 OAuth 应用 secret |
| PUT | `/api/clients/{client_id}/access-control` | admin:admin.clients | 更新应用的用户组访问控制(白 / 黑名单) |
| GET | `/api/clients/{client_id}/access-control` | admin:admin.clients | 获取应用的用户组访问控制 |

---

## Passkeys(通行密钥)

前缀 `/api/passkeys`。WebAuthn 注册 / 认证 / 管理。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/passkeys/register/options` | user | 生成 WebAuthn 注册选项(需已验证邮箱) |
| POST | `/api/passkeys/register/verify` | user | 校验注册响应并存储通行密钥 |
| POST | `/api/passkeys/authenticate/options` | public | 生成 WebAuthn 认证选项(免密登录,无需登录) |
| POST | `/api/passkeys/authenticate/verify` | public | 校验认证响应并签发 token(风控可能触发二次验证) |
| GET | `/api/passkeys/` | user | 列出当前用户的所有通行密钥 |
| GET | `/api/passkeys/check/{username}` | public | 检查某用户是否已绑定通行密钥 |
| PUT | `/api/passkeys/{passkey_id}` | user | 重命名通行密钥 |
| DELETE | `/api/passkeys/{passkey_id}` | user | 删除通行密钥 |

---

## TOTP

前缀 `/api/totp`。基于时间的一次性密码 2FA。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/totp/status` | user | 获取当前用户的 TOTP 状态 |
| POST | `/api/totp/setup` | user | 开始 TOTP 设置,返回密钥 / provisioning URI / 二维码 |
| POST | `/api/totp/verify-setup` | user | 校验动态码并启用 TOTP,返回备用码 |
| DELETE | `/api/totp` | user | 禁用 TOTP(需密码确认) |
| POST | `/api/totp/backup-codes` | user | 重新生成 TOTP 备用码(需密码确认) |

---

## Site(站点)

前缀 `/api/site`。站点级公开配置。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/site` | public | 获取站点公开配置(站点名) |
| PUT | `/api/site` | admin:admin.users | 更新站点配置(站点名) |

---

## Groups(用户组)

前缀 `/api/groups`。用户组管理与组级应用权限,需 `admin.groups` 权限。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/groups/` | admin:admin.groups | 创建用户组 |
| GET | `/api/groups/` | admin:admin.groups | 获取用户组列表(分页,含成员数) |
| GET | `/api/groups/{group_id}` | admin:admin.groups | 获取用户组详情 |
| PUT | `/api/groups/{group_id}` | admin:admin.groups | 更新用户组 |
| DELETE | `/api/groups/{group_id}` | admin:admin.groups | 删除用户组 |
| POST | `/api/groups/{group_id}/members` | admin:admin.groups | 添加用户组成员 |
| DELETE | `/api/groups/{group_id}/members` | admin:admin.groups | 移除用户组成员 |
| PUT | `/api/groups/{group_id}/members` | admin:admin.groups | 覆盖式设置用户组成员 |
| GET | `/api/groups/{group_id}/app-permissions` | admin:admin.groups | 获取用户组的应用权限(允许 / 拒绝列表) |
| PUT | `/api/groups/{group_id}/app-permissions` | admin:admin.groups | 更新用户组的应用权限 |

---

## Admin(管理)

前缀 `/api/admin`。用户与权限管理后台。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/admin/users` | admin:admin.users | 获取所有用户列表(分页 + 搜索) |
| GET | `/api/admin/users/{user_id}` | admin:admin.users | 获取单个用户详情 |
| POST | `/api/admin/users` | admin:admin.users | 创建新用户 |
| PUT | `/api/admin/users/{user_id}` | admin:admin.users | 更新用户信息(含重置密码时吊销其 token) |
| DELETE | `/api/admin/users/{user_id}` | admin:admin.users | 删除用户(不可删除自己) |
| PUT | `/api/admin/users/{user_id}/groups` | admin:admin.users | 更新用户所属用户组 |
| PUT | `/api/admin/users/{user_id}/roles` | admin:admin.roles | 更新用户的角色 |
| GET | `/api/admin/roles` | admin:admin.roles | 获取所有角色列表 |
| GET | `/api/admin/users/{user_id}/app-permissions` | admin:admin.users | 获取用户的应用权限(允许 / 拒绝列表) |
| PUT | `/api/admin/users/{user_id}/app-permissions` | admin:admin.users | 更新用户的应用权限 |
| GET | `/api/admin/users/{user_id}/app-permissions/computed` | admin:admin.users | 获取用户计算后的应用权限(分页,含权限来源) |
| PUT | `/api/admin/users/{user_id}/app-permissions/single` | admin:admin.users | 更新用户对单个应用的权限(allowed / denied / 清除) |
| GET | `/api/admin/users/{user_id}/login-logs` | admin:admin.users | 获取用户的登录日志(分页) |
| GET | `/api/admin/users/{user_id}/sessions` | admin:admin.users | 获取用户的活跃会话 |
| DELETE | `/api/admin/users/{user_id}/sessions/{session_id}` | admin:admin.users | 强制登出用户的单个会话 |
| DELETE | `/api/admin/users/{user_id}/sessions` | admin:admin.users | 强制登出用户的所有会话 |
| GET | `/api/admin/users/{user_id}/passkeys` | admin:admin.users | 获取用户的通行密钥 |
| GET | `/api/admin/users/{user_id}/authorizations` | admin:admin.users | 获取用户的应用授权记录 |
| GET | `/api/admin/users/{user_id}/security-methods` | admin:admin.users | 获取用户的安全验证方式(TOTP / Passkey / 邮箱状态) |

---

## Invites(邀请码)

前缀 `/api/admin/invites`。邀请码管理,需 `admin.users` 权限。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/admin/invites/` | admin:admin.users | 获取邀请码列表(支持 active 过滤 / 分页) |
| POST | `/api/admin/invites/` | admin:admin.users | 创建邀请码(可指定分组 / 过期 / 最大次数) |
| PUT | `/api/admin/invites/{invite_id}` | admin:admin.users | 更新邀请码(达上限自动停用) |

---

## System(系统)

无前缀(根路径 `/api`)。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | public | 存活探针 liveness,进程能响应即 ok |
| GET | `/api/ready` | public | 就绪探针 readiness,深度检查 DB 可读,失败返回 503 |
| GET | `/api/openapi.json` | admin | 获取 OpenAPI schema(JSON) |
| GET | `/api/docs` | admin | Swagger UI 交互式 API 文档 |
| GET | `/api/redoc` | admin | ReDoc API 文档 |

---

## 页面路由

非 `/api` 路径由 Next.js SPA 接管。主要页面:

### 公开页面(未登录可访问)

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | 首页 | 分屏式首页:左侧 GSAP 动画角色群主视觉 + 品牌标语,右侧按登录状态展示控制台 / 登录 / 注册入口 |
| `/login` | 登录 | 用户名密码 + 通行密钥登录,可记住我 30 天;OAuth 授权页跳来时展示应用信息,风险登录触发二次验证 |
| `/login/magic-link` | Magic Link 登录验证 | 解析 token / session,完成独立 Magic Link 登录或验证流程中的 Magic Link 步骤 |
| `/login/verify` | 安全验证 | 风控触发的二次验证(step-up):邮件验证码 / TOTP / 通行密钥,完成所需次数后签发 token,亦可跳过进受限模式 |
| `/register` | 注册 | 邀请码注册,支持 URL 参数带入邀请码 |
| `/verify-email` | 邮箱验证 | 邮件链接回调,展示验证中 / 成功 / 失败 / 缺少令牌 |
| `/oauth/authorize` | OAuth 授权确认 | Consent 页:校验参数、展示授权范围、允许 / 拒绝 / 切换账号 |

### 用户面板(`/dashboard/*`)

| 路径 | 页面 | 说明 |
|---|---|---|
| `/dashboard` | 控制台 | 入口,自动重定向到 `/dashboard/my-apps` |
| `/dashboard/my-apps` | 我的应用 | 可访问的 OAuth 应用卡片;管理员视角显示全部应用 |
| `/dashboard/sessions` | 会话(重定向) | 兼容旧路径 → `/dashboard/security#sessions` |
| `/dashboard/passkeys` | 通行密钥(重定向) | 兼容旧路径 → `/dashboard/security#passkeys` |
| `/dashboard/security` | 安全设置 | 聚合页:验证方式 / 设备会话 / 密码修改 / 登录记录 / 通行密钥,URL hash 定位标签 |
| `/dashboard/security/totp` | 身份验证器 | TOTP 绑定(扫码 / 手动)、备用码、禁用与重生成 |
| `/dashboard/authorizations` | 授权管理 | 已授权应用 / 范围 / 时间,可撤回 |
| `/dashboard/profile` | 个人资料 | 编辑邮箱与头像,侧栏账号信息 |

### 管理后台(`/admin/*`)

| 路径 | 页面 | 说明 |
|---|---|---|
| `/admin` | 管理控制台 | 统计卡片 + 四个快捷入口,非管理员重定向到用户面板 |
| `/admin/users` | 用户管理 | 分页搜索、创建 / 编辑、管理用户组与角色、跳转详情与权限、删除 |
| `/admin/users/detail` | 用户详情 | 基本信息 / 登录日志 / 会话 / 通行密钥 / 应用授权五个标签,可强制登出 |
| `/admin/users/permissions` | 用户应用权限 | 单用户对每应用的最终访问结果与权限来源,可逐应用设置 |
| `/admin/groups` | 用户组 | 选组后编辑信息、管理成员、配置组级应用权限 |
| `/admin/apps` | 应用管理 | 创建应用(一次性显示 ID/Secret)、编辑、重置密钥、访问控制、删除 |
| `/admin/apps/edit` | 编辑应用 | 修改名称 / 描述 / Logo / 官网 / 回调 / 范围 / 信任 / 默认访问 |
| `/admin/invites` | 邀请码 | 按组生成(可设过期 / 次数 / 备注),列表展示状态与使用情况 |
| `/admin/settings` | 站点设置 | 修改站点名,右侧实时预览 |

---

## 配置项参考

所有配置通过环境变量注入(见 [`backend/.env.example`](../backend/.env.example))。`必填` 列指无默认值且须显式设置的项。

### 应用基础

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `APP_NAME` | Personal OAuth Server | | 应用显示名称 |
| `DEBUG` | False | | 调试模式开关 |
| `HOST` | 0.0.0.0 | | 服务监听地址 |
| `PORT` | 8000 | | 服务监听端口 |
| `ALLOWED_ORIGINS` | http://localhost:3000,http://localhost:8000 | | CORS 允许来源(逗号分隔) |
| `FRONTEND_URL` | http://localhost:8000 | | 前端地址,用于魔法链接等邮件链接 |
| `STATIC_DIR` | None | | 前端静态导出目录覆盖,留空用 `frontend/out` |
| `OIDC_ISSUER` | None | | OIDC issuer 覆盖,留空则自动从请求推导;反代后建议显式设 `https://<域名>` |

### 数据库

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 无 | ✅ | 数据库连接字符串(示例 `sqlite:///./oauth.db`) |

### JWT 签名

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `SECRET_KEY` | 无 | ✅ | refresh token 对称签名密钥,**≥32 字符随机串**;占位 / 弱密钥会被启动校验拒绝 |
| `ALGORITHM` | HS256 | | refresh token 对称签名算法 |
| `JWT_ALGORITHM` | RS256 | | access/id token 非对称签名算法 |
| `JWT_PRIVATE_KEY_PATH` | (空) | ✅† | RSA 私钥路径,签发 access/id token;用 `scripts/generate_jwt_keys.py` 生成 |
| `JWT_PUBLIC_KEY_PATH` | (空) | ✅† | RSA 公钥路径,经 JWKS 对外暴露 |
| `JWT_KEY_ID` | (空) | | JWT kid,可选,留空则用公钥 DER 的 sha256[:16] |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 15 | | access token 有效期(分钟) |
| `REFRESH_TOKEN_EXPIRE_DAYS` | 7 | | refresh token 有效期(天) |
| `REFRESH_TOKEN_REMEMBER_ME_DAYS` | 30 | | 记住我时 refresh token 有效期(天,仅平台登录,OAuth 流不用) |

> † `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` 启动时不强制(未配置仅 `WARNING`),但**签发 access/id token 时必需**——即登录与 OAuth 流程会在此时 fail。生产务必配置。

### 注册控制

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `ALLOW_OPEN_REGISTRATION` | false | | 是否开放公开注册(默认关闭,新用户需邀请码) |
| `BOOTSTRAP_ALLOW_FIRST_USER` | true | | 首个用户是否可自注册(用于初始化管理员) |

### WebAuthn

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `WEBAUTHN_RP_ID` | localhost | | WebAuthn RP ID,生产用实际域名 |
| `WEBAUTHN_RP_NAME` | LAAA OAuth Server | | WebAuthn RP 显示名称 |
| `WEBAUTHN_RP_ORIGIN` | http://localhost:8000 | | WebAuthn RP origin,生产用 https 实际地址 |
| `WEBAUTHN_CHALLENGE_TIMEOUT_SECONDS` | 300 | | WebAuthn challenge 有效期(秒) |

### 会话与异常

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `DEFAULT_MAX_SESSIONS` | 3 | | 每用户最大并发会话数 |
| `ENABLE_LOGIN_ANOMALY_DETECTION` | true | | 是否启用登录异常检测 |
| `SUSPICIOUS_IP_CHANGE_HOURS` | 1 | | IP 变更检测时间窗(小时) |
| `SUSPICIOUS_LOCATION_DISTANCE_KM` | 500 | | 地理跳跃距离阈值(公里) |
| `SUSPICIOUS_LOGIN_VELOCITY_MINUTES` | 5 | | 登录频率检测时间窗(分钟) |
| `SUSPICIOUS_LOGIN_VELOCITY_COUNT` | 5 | | 时间窗内允许的最大登录次数 |

### GeoIP

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `GEOIP_ENABLED` | true | | 是否启用 MaxMind GeoIP 定位 |
| `GEOIP_DATABASE_PATH` | data/GeoLite2-City.mmdb | | MaxMind GeoLite2 城市数据库路径 |
| `IP2REGION_ENABLED` | true | | 是否启用 ip2region(中国 IP 省份精确查询) |
| `IP2REGION_DATABASE_PATH` | data/ip2region.xdb | | ip2region 数据库路径 |

### SMTP

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `SMTP_ENABLED` | false | | 是否启用邮件发送功能 |
| `SMTP_HOST` | (空) | SMTP 启用时 ✅ | SMTP 服务器地址 |
| `SMTP_PORT` | 587 | | SMTP 端口 |
| `SMTP_USERNAME` | (空) | SMTP 启用时 ✅ | SMTP 登录用户名 |
| `SMTP_PASSWORD` | (空) | SMTP 启用时 ✅ | SMTP 密码 / 授权码 |
| `SMTP_FROM_EMAIL` | (空) | SMTP 启用时 ✅ | 发件人邮箱地址 |
| `SMTP_FROM_NAME` | LAAA OAuth Server | | 发件人显示名称 |
| `SMTP_USE_TLS` | true | | 是否启用 STARTTLS(端口 587) |
| `SMTP_USE_SSL` | false | | 是否启用 SSL/TLS(端口 465) |

### 风险与验证

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `RISK_SCORE_MEDIUM` | 3 | | 中等风险分数阈值(触发步骤验证) |
| `RISK_SCORE_HIGH` | 5 | | 高风险分数阈值 |
| `BLOCK_SUSPICIOUS_LOGIN` | true | | 是否直接阻断可疑登录 |
| `VERIFICATION_CODE_EXPIRE_MINUTES` | 5 | | 验证码有效期(分钟) |
| `VERIFICATION_CODE_MAX_ATTEMPTS` | 5 | | 验证码最大尝试次数 |
| `VERIFICATION_CODE_COOLDOWN_SECONDS` | 60 | | 验证码发送冷却时间(秒) |
| `MAGIC_LINK_EXPIRE_MINUTES` | 15 | | 魔法链接有效期(分钟) |
| `VERIFICATION_SESSION_EXPIRE_MINUTES` | 30 | | 验证会话有效期(分钟) |

### TOTP

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `TOTP_ISSUER` | LAAA OAuth Server | | TOTP 2FA 发行者名称 |

### 速率限制

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `RATELIMIT_STORAGE_URI` | (空) | | 速率限制存储 URI(slowapi);单实例留空用内存,多 worker 设 `redis://...` |

### 可观测性

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `LOG_FORMAT` | (空) | | 日志格式,留空 = 人类可读,`json` = 结构化 JSON |
| `SENTRY_DSN` | (空) | | Sentry DSN,留空不上报错误 |
| `SENTRY_ENVIRONMENT` | production | | Sentry 上报环境标签 |

---

## 鉴权说明

### access token

平台自身登录会话的 access token 是 JWT(RS256),通过 `Authorization: Bearer <token>` 传递。`get_current_user` 依赖解出用户并校验:

- token 签名有效(JWKS 公钥)
- token 未过期
- token 中的 `tv`(`token_version`)== 用户当前 `token_version`(改密 / 管理员重置密码后 `tv+1`,旧 access token 立即失效;封禁用户靠 `status` 检查,效果等同吊销)
- 用户 `status` 仍为 `active`

### 权限系统

权限用点号 + 通配:

- `admin.*` 授予所有 admin 权限
- 具体:`admin.users` `admin.roles` `admin.groups` `admin.clients`
- 路由用 `@require_permission('admin.users')` 守卫;代码内用 `User.has_permission('admin.users')` 检查
- 角色用 `User.has_role('admin')` 检查

种子数据(`seed.py`)定义了 `admin` / `user` / `guest` 三个角色及上述权限,`init_db()` 启动时幂等补齐。
