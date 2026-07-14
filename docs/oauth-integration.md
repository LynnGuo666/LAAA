# 接入 LAAA:OAuth 2.0 / OIDC 集成指南

本文档面向**第三方应用(Relying Party, RP)开发者**,说明如何把 LAAA 作为身份提供方接入你的应用。涵盖 OIDC 发现、三种授权流程、PKCE、token 校验、用户信息获取、令牌吊销 / 内省,以及完整错误码参考。

> 假设你的 LAAA 实例部署在 `https://laaa.example.com`(下文记作 `{issuer}`)。本地开发时替换为 `http://localhost:8000`。

---

## 目录

- [1. 注册你的应用](#1-注册你的应用)
- [2. OIDC 发现](#2-oidc-发现)
- [3. 授权码流(推荐)](#3-授权码流推荐)
- [4. PKCE](#4-pkce)
- [5. 刷新令牌](#5-刷新令牌)
- [6. 密码流(仅受信任客户端)](#6-密码流仅受信任客户端)
- [7. 获取用户信息(UserInfo)](#7-获取用户信息userinfo)
- [8. 校验 id_token](#8-校验-id_token)
- [9. 令牌吊销与内省](#9-令牌吊销与内省)
- [10. 访问控制与受限模式](#10-访问控制与受限模式)
- [11. Scope 与 Claims](#11-scope-与-claims)
- [12. Token 生命周期](#12-token-生命周期)
- [13. 错误码参考](#13-错误码参考)
- [14. 完整示例](#14-完整示例)

---

## 1. 注册你的应用

在 LAAA 管理后台(`https://laaa.example.com/admin/apps`)创建一个 OAuth 应用,获得:

- **Client ID**:应用唯一标识
- **Client Secret**:机密客户端的密钥(**仅创建/重置时显示一次**,务必保存;公开客户端如 SPA / 移动端无需 secret,改用 PKCE)
- **Redirect URIs**:回调地址白名单(授权时必须精确匹配)

可配置项:

| 项 | 说明 |
|---|---|
| `client_type` | `confidential`(有 secret,服务端应用)或 `public`(无 secret,SPA / 移动端,**强制 PKCE**) |
| `trusted` | 受信任客户端跳过用户同意页,且是使用密码流的前提 |
| `default_access` | 用户未显式授权时的默认行为(`true`=默认允许,`false`=需显式授权) |
| `allowed_groups` / `denied_groups` | 用户组白 / 黑名单(黑名单优先) |
| `allowed_scopes` | 该应用可请求的 scope 子集 |

---

## 2. OIDC 发现

LAAA 实现标准 OIDC Discovery,所有端点与能力声明都在一个文档里:

```http
GET {issuer}/.well-known/openid-configuration
```

返回示例:

```json
{
  "issuer": "https://laaa.example.com",
  "authorization_endpoint": "https://laaa.example.com/api/oauth/authorize",
  "token_endpoint": "https://laaa.example.com/api/oauth/token",
  "userinfo_endpoint": "https://laaa.example.com/api/oauth/userinfo",
  "jwks_uri": "https://laaa.example.com/.well-known/jwks.json",
  "revocation_endpoint": "https://laaa.example.com/api/oauth/revoke",
  "introspection_endpoint": "https://laaa.example.com/api/oauth/introspect",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token", "password"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "scopes_supported": ["openid", "profile", "email"],
  "claims_supported": ["sub","username","email","avatar","nonce","at_hash","aud","iss","iat","exp"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
  "code_challenge_methods_supported": ["S256", "plain"]
}
```

**RP 应始终从 discovery 文档动态读取端点 URL**,而不是硬编码——这样 LAAA 升级或迁移时无需改你的代码。

`issuer` 取自 `OIDC_ISSUER` 环境变量;未设置时回退到请求的 `base_url`。**生产部署在反向代理后时,务必显式设置 `OIDC_ISSUER=https://<域名>`**,否则 issuer 可能带 `http://` 或内网地址,导致 RP 的 iss 校验失败。

签名公钥(JWKS)单独端点:

```http
GET {issuer}/.well-known/jwks.json
```

```json
{
  "keys": [
    {
      "kty": "RSA", "use": "sig", "alg": "RS256",
      "kid": "a1b2c3d4e5f6a7b8",
      "n": "...", "e": "AQAB"
    }
  ]
}
```

access / id token 的 JOSE 头带 `kid`,RP 据此从 JWKS 取公钥验签。LAAA 支持多代密钥(kid 索引),便于轮换。

---

## 3. 授权码流(推荐)

最标准、最安全的流程(RFC 6749 §4.1),所有客户端类型都适用。**LAAA 仅暴露 `response_type=code`**(无隐式 / 混合流)。

### 流程图

```
用户浏览器          你的应用(RP)              LAAA
    │                   │                        │
    │  1. 点击「用 LAAA 登录」                  │
    │ ─────────────────▶│                        │
    │                   │  2. 302 重定向到 authorize
    │ ──────────────────────────────────────────▶│
    │                   │                        │ 3. 校验 client/redirect/scope
    │                   │                        │   未登录 → 跳登录页
    │                   │                        │   风控 / 访问控制校验
    │                   │                        │ 4. 展示同意页(或 trusted 自动通过)
    │ ◀─────────────────────────────────────────│
    │  5. 用户同意                              │
    │ ──────────────────────────────────────────▶│
    │                   │                        │ 6. 302 回调带 code
    │ ◀─────────────────────────────────────────│
    │  7. 浏览器带 code 访问你的回调 URL         │
    │ ─────────────────▶│                        │
    │                   │  8. POST /token(code+secret/PKCE)
    │                   │ ───────────────────────▶│
    │                   │                        │ 9. 校验 code,签发 token
    │                   │ ◀───────────────────────│
    │                   │  10. access/refresh/id_token
    │                   │  11. 调 userinfo 取用户信息
    │                   │ ───────────────────────▶│
    │                   │ ◀───────────────────────│
```

### 步骤

#### ① 构造授权请求,重定向浏览器

```
GET {issuer}/api/oauth/authorize?
    response_type=code
    &client_id={你的 client_id}
    &redirect_uri={你的回调 URL,须在白名单内}
    &scope=openid profile email
    &state={随机串,防 CSRF}
    &nonce={随机串,OIDC 防重放,scope 含 openid 时必传}
    &code_challenge={PKCE challenge,见第 4 节}
    &code_challenge_method=S256
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `response_type` | ✅ | 固定 `code` |
| `client_id` | ✅ | 你的 Client ID |
| `redirect_uri` | ✅ | 必须与注册时**精确匹配** |
| `scope` | | 空格分隔,可选 `openid` `profile` `email`;须是应用 `allowed_scopes` 子集 |
| `state` | ✅ | 随机串,防 CSRF;LAAA 原样回传,RP 须校验 |
| `nonce` | OIDC 时 ✅ | 随机串,会回填进 id_token,防重放 |
| `code_challenge` | 公开客户端 ✅ / 机密可选 | PKCE challenge(公开客户端在 token 兑换时强制校验) |
| `code_challenge_method` | 有 challenge 时 ✅ | `S256`(推荐)或 `plain`;**必须显式传**,LAAA 不替你默认(见第 4 节) |

#### ② LAAA 处理(对 RP 透明)

- 校验 `client_id` / `redirect_uri` / `scope` / `code_challenge_method`;非法 → 直接错误页(不重定向)
- 用户未登录 → 302 跳 `/login?redirect={编码后的 authorize URL}`,登录后回到授权页
- **访问控制**:`User.can_access_client()` 校验用户组 / 应用权限;**受限模式**校验(须邮箱已验证 + 已开 TOTP 或 Passkey);不通过 → 403
- `client.trusted=true` 或请求 scope ⊆ 已授权 scope → 自动签发 code(跳过同意页);否则展示前端同意页 `/oauth/authorize`
- 用户**同意** → 302 到 `{redirect_uri}?code={code}&state={state}`
- 用户**拒绝** → 302 到 `{redirect_uri}?error=access_denied&state={state}`

#### ③ 用 code 换 token(服务端,不经过浏览器)

```http
POST {issuer}/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={上一步拿到的 code}
&redirect_uri={必须与 ① 完全一致}
&client_id={你的 client_id}
&client_secret={机密客户端的 secret}
```

> **公开客户端**(无 secret):把 `client_secret` 换成 `code_verifier={PKCE 原值,见第 4 节}`。
>
> client 凭据也可用 HTTP Basic 头(`Authorization: Basic base64(client_id:client_secret)`),token 端点同时支持 `client_secret_post` 与 `client_secret_basic`。body 也接受 `application/json`。

#### ④ 成功响应

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 900,
  "id_token": "eyJhbGciOiJSUzI1NiIs..."
}
```

- `id_token` **仅当 `scope` 含 `openid`** 时返回
- `expires_in` 单位秒,= 900(15 分钟)
- 授权码**单次使用**,兑换后立即失效

#### ⑤ 失败响应

```json
{ "error": "invalid_grant", "error_description": "invalid authorization code" }
```

错误码见[第 13 节](#13-错误码参考)。

---

## 4. PKCE

**RFC 7636**。公开客户端(SPA / 移动端,无 client_secret)**必须**使用 PKCE;机密客户端可选。

### 流程

```python
import secrets, hashlib, base64

# 1. 本地生成 code_verifier(43-128 字符的随机 URL 安全串)
code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode()

# 2. 算 code_challenge(S256)
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode()).digest()
).rstrip(b'=').decode()

# 3. authorize 请求带上 challenge
#    code_challenge={code_challenge}&code_challenge_method=S256

# 4. token 兑换带上 verifier(原值,不哈希)
#    code_verifier={code_verifier}
```

LAAA 校验:

- `S256`:`computed = base64url(sha256(code_verifier))`,`hmac.compare_digest(computed, stored_challenge)`
- `plain`:`hmac.compare_digest(code_verifier, stored_challenge)`

| 场景 | 结果 |
|---|---|
| 公开客户端缺 `code_verifier` | `invalid_grant` |
| 公开客户端的 code 无 `code_challenge` | `invalid_grant` |
| PKCE 校验失败 | `invalid_grant` |
| `code_challenge_method` 非 `S256`/`plain`(且非空) | authorize 端点 400 `Unsupported code_challenge_method` |

> **务必显式传 `code_challenge_method`**。带 `code_challenge` 时 LAAA 不替你默认 method——若省略,存储的 method 为空,token 兑换时 PKCE 校验会失败(`invalid_grant`)。建议始终用 `S256`。

---

## 5. 刷新令牌

access token 过期(15 分钟)后,用 refresh token 换新的,无需用户重新登录。

```http
POST {issuer}/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={旧的 refresh_token}
&client_id={你的 client_id}
&client_secret={机密客户端的 secret}
```

成功响应与授权码流相同。**注意:refresh token 每次刷新轮换**——旧 token 在原 DB 记录上被覆盖失效,RP 必须用返回的新 `refresh_token` 替换存储的旧值。

> OAuth `/token` 端点签发的 refresh token **固定 7 天**有效期;「记住我 30 天」仅适用于 LAAA 平台自身的登录会话,不影响 OAuth 流程。

刷新失败(`invalid_grant`)时,RP 应清掉本地 token,重新走授权码流让用户登录。

---

## 6. 密码流(仅受信任客户端)

**RFC 6749 §4.3**。仅限 `client.trusted=true` 的机密客户端——用户把账密直接交给 RP 换 token,**无浏览器跳转**。仅用于你完全信任的第一方应用。

```http
POST {issuer}/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password
&username={用户名}
&password={密码}
&client_id={你的 client_id}
&client_secret={你的 client_secret}
&scope=profile
```

LAAA 校验:client 存在 + secret 正确 + `trusted=true` + 用户名密码正确 + scope 合法。任一失败 → `invalid_grant`。

> 生产环境的新应用**不建议**用此流,优先用授权码流 + PKCE。

---

## 7. 获取用户信息(UserInfo)

用 access token 调 userinfo,返回的 claims **按 token 内 scope 过滤**:

```http
GET {issuer}/api/oauth/userinfo
Authorization: Bearer {access_token}
```

| token 的 scope | 返回的 claims |
|---|---|
| `openid` | `sub` |
| `profile` | `sub`, `username`, `avatar` |
| `email` | `sub`, `email` |
| `openid profile email` | `sub`, `username`, `avatar`, `email` |

响应示例:

```json
{
  "sub": "1",
  "username": "lynn",
  "avatar": "https://...",
  "email": "lynn@example.com"
}
```

缺 / 错 Authorization 头,或 token 无效 / 过期 / 用户已停用 → 401。

---

## 8. 校验 id_token

`id_token` 是 JWT(RS256)。RP 拿到后**必须**本地校验,不要直接信任:

1. **取公钥**:从 JOSE 头读 `kid`,到 `{issuer}/.well-known/jwks.json` 取对应公钥(缓存,定期刷新)
2. **验签**:用 RS256 公钥验证签名
3. **校验 `iss`**:必须等于 discovery 文档的 `issuer`
4. **校验 `aud`**:必须等于你的 `client_id`
5. **校验 `exp` / `iat`**:未过期
6. **校验 `nonce`**:必须等于你在 authorize 请求里发的 `nonce`(防重放)
7. **校验 `at_hash`**(可选但推荐):`base64url(sha256(access_token)[0:16])` 应等于 id_token 里的 `at_hash`(确认 id_token 与 access_token 配对)

### id_token claims

| claim | 说明 |
|---|---|
| `sub` | 用户 ID(字符串形式的 `User.id`),稳定主体标识 |
| `aud` | 受众 = `client_id`,RP 须校验 |
| `iss` | 签发方 = issuer,RP 须校验 |
| `exp` | 过期时间(Unix 时间戳),与 access token 同 TTL = 15 分钟 |
| `iat` | 签发时间 |
| `nonce` | 仅当 RP 在 authorize 带 nonce 时回填;须校验一致防重放 |
| `at_hash` | access_token 绑定哈希,用于配对校验 |
| `username` | 用户名(id_token 始终含,不按 scope 过滤) |
| `email` | 邮箱(id_token 始终含) |
| `avatar` | 头像 URL |
| `(header) kid / alg` | JOSE 头:`alg=RS256`,`kid` 指向 JWKS 公钥 |

---

## 9. 令牌吊销与内省

### 吊销(RFC 7009)

用于用户登出 / 撤销授权时,主动让 refresh token 失效:

```http
POST {issuer}/api/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token={refresh_token}
&token_type_hint=refresh_token
&client_id={你的 client_id}
&client_secret={你的 client_secret}
```

- 必须通过 client 认证,否则 401 `invalid_client`
- 仅删除匹配该 client 的 refresh token DB 记录
- access token 是无状态 JWT,revoke 不直接处理它——它依赖 15 分钟 TTL + `token_version` 机制即时吊销(改密 / 重置密码时 `tv+1`;封禁靠 `status` 检查)
- **按 RFC 7009 §2.2,无论 token 是否存在 / 有效,始终返回 200 + 空 `{}`**(不泄露信息)

### 内省(RFC 7662)

资源服务器(RS)在线校验 access token 有效性:

```http
POST {issuer}/api/oauth/introspect
Content-Type: application/x-www-form-urlencoded

token={access_token}
&client_id={你的 client_id}
&client_secret={你的 client_secret}
```

有效且未过期:

```json
{
  "active": true,
  "scope": "openid profile email",
  "client_id": "your_client_id",
  "sub": "1",
  "token_type": "Bearer",
  "exp": 1784049000
}
```

无效 / 过期 / 已吊销 / 非 access 类型:`{"active": false}`(不暴露具体原因)。必须通过 client 认证。

> 两个端点速率限制均为 30/min。

---

## 10. 访问控制与受限模式

LAAA 在授权前做两层校验,**不通过则 403**(用户不会进入同意页):

### 应用访问控制(优先级从高到低)

1. 用户级拒绝(`user_denied_apps`)→ **拒绝**
2. 用户级允许(`user_allowed_apps`)→ 允许
3. 组级拒绝(`group_denied_apps`)→ **拒绝**
4. 组级允许(`group_allowed_apps`)→ 允许
5. 回落 `client.default_access`(`true`=允许 / `false`=需显式授权)

外加客户端级 `allowed_groups`(白名单)/ `denied_groups`(黑名单,优先)。

### 受限模式

账户必须**同时满足**:邮箱已验证 + 已启用 TOTP 或绑定 ≥1 个 Passkey,才能完成 OAuth 授权。否则 403,提示先完成邮箱验证与二次验证设置。用户也可在风控触发时选择「跳过」以受限模式登录(功能受限)。

### 同意再提示

仅当请求 scope ⊆ 已授权 scope 时才跳过同意页;请求**新增 scope 会强制再次同意**(防止静默 scope 升级)。已授权 scope 取并集存储。

---

## 11. Scope 与 Claims

| scope | userinfo 返回 | 触发签发 id_token |
|---|---|---|
| `openid` | `sub` | ✅(OIDC 核心标识) |
| `profile` | `sub`, `username`, `avatar` | — |
| `email` | `sub`, `email` | — |

`id_token` 中的 `username` / `email` / `avatar` **始终包含**(不按 scope 过滤);userinfo 则严格按 scope 过滤。

---

## 12. Token 生命周期

| 令牌 | 算法 | 有效期 | 特性 |
|---|---|---|---|
| access token | RS256 | 15 分钟(`expires_in=900`) | 无状态 JWT,header 带 `kid`;`token_version` 变更即时吊销 |
| refresh token | HS256 | 7 天(OAuth 流) | DB 存 hash;每次刷新**轮换** |
| authorization code | — | 10 分钟 | **单次使用**,绑定 redirect_uri / PKCE / nonce |
| id token | RS256 | 15 分钟 | OIDC,含 `nonce` / `at_hash` |

**即时吊销机制**:用户改密 / 管理员重置密码时,`token_version + 1`,所有旧 access token 立即失效(下次请求 401)。封禁用户(`status=suspended`)则在 `get_current_user` 鉴权时直接拒绝,效果等同吊销。这使得无状态 access token 也具备即时吊销能力。

---

## 13. 错误码参考

### Token 端点(`/api/oauth/token`)

| error | HTTP | 触发条件 |
|---|---|---|
| `invalid_request` | 400 | 缺 `grant_type`;authorization_code 缺 `code`/`redirect_uri`;refresh_token 缺 `refresh_token`;password 缺 `username`/`password`;body 格式非法 |
| `invalid_client` | 401 | `client_id` 缺失 / 未知,或机密客户端 `client_secret` 错误(响应带 `WWW-Authenticate: Basic realm="oauth"`) |
| `invalid_grant` | 400 | 授权码无效 / 过期 / 已用 / redirect_uri 不匹配 / PKCE 失败;refresh token 无效 / 过期;password 凭据错误或客户端非 trusted |
| `unsupported_grant_type` | 400 | `grant_type` 不是 `authorization_code` / `refresh_token` / `password` |

错误响应体:`{"error": "...", "error_description": "..."}`

### Authorize 端点(`/api/oauth/authorize`)

| error | HTTP | 触发条件 |
|---|---|---|
| `access_denied` | 302 redirect | 用户在同意页点拒绝 → 重定向 `{redirect_uri}?error=access_denied&state={state}` |
| `Invalid client_id` | 400 | client_id 不存在 |
| `Invalid redirect_uri` | 400 | redirect_uri 不在白名单(须精确匹配) |
| `Invalid scope` | 400 | 请求 scope 不是 `allowed_scopes` 子集 |
| `Unsupported code_challenge_method` | 400 | method 非 `S256`/`plain` |
| `Forbidden (no app access)` | 403 | `can_access_client` 返回 False |
| `Forbidden (restricted mode)` | 403 | 账户受限(未邮箱验证 / 未开 2FA) |
| `Unauthorized` | 401 | POST authorize 时无登录会话 |

### UserInfo 端点(`/api/oauth/userinfo`)

| error | HTTP | 触发条件 |
|---|---|---|
| `Unauthorized` | 401 | 缺 Authorization 头 / 非 Bearer;token 无效 / 过期 / 用户已停用 |

### Revoke / Introspect 端点

| error | HTTP | 触发条件 |
|---|---|---|
| `invalid_client` | 401 | 未通过 client 认证 |

> revoke 始终返回 200 `{}`;introspect 对无效 token 返回 `{"active": false}`。

---

## 14. 完整示例

### Python(授权码流 + PKCE)

```python
import secrets, hashlib, base64, requests

ISSUER = "https://laaa.example.com"
CLIENT_ID = "your_client_id"
# 公开客户端无 secret,靠 PKCE;机密客户端另加 CLIENT_SECRET
REDIRECT_URI = "https://yourapp.com/callback"

# 1. 读 discovery
disc = requests.get(f"{ISSUER}/.well-known/openid-configuration").json()

# 2. 生成 PKCE
code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode()).digest()
).rstrip(b"=").decode()
state = secrets.token_urlsafe(16)
nonce = secrets.token_urlsafe(16)

# 存 code_verifier/state/nonce 到 session,回调时取回
session["pkce_verifier"] = code_verifier
session["oauth_state"] = state
session["oauth_nonce"] = nonce

# 3. 重定向浏览器到 authorize
auth_url = disc["authorization_endpoint"] + "?" + urlencode({
    "response_type": "code",
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "scope": "openid profile email",
    "state": state,
    "nonce": nonce,
    "code_challenge": code_challenge,
    "code_challenge_method": "S256",
})
# return redirect(auth_url)

# 4. 回调处理(伪代码:从 query 取 code,校验 state)
# code = request.args["code"]
# assert request.args["state"] == session.pop("oauth_state")

# 5. 换 token
resp = requests.post(disc["token_endpoint"], data={
    "grant_type": "authorization_code",
    "code": code,
    "redirect_uri": REDIRECT_URI,
    "client_id": CLIENT_ID,
    "code_verifier": session.pop("pkce_verifier"),
    # "client_secret": CLIENT_SECRET,  # 机密客户端用这个代替 code_verifier
})
tokens = resp.json()
# tokens = {"access_token":..., "refresh_token":..., "id_token":..., "expires_in":900}

# 6. 校验 id_token(用 JWKS 公钥 RS256 验签,校验 iss/aud/nonce/at_hash)
jwks = requests.get(disc["jwks_uri"]).json()
# ... 用 jose / PyJWT / jwt 库验签,略

# 7. 取用户信息
userinfo = requests.get(
    disc["userinfo_endpoint"],
    headers={"Authorization": f"Bearer {tokens['access_token']}"},
).json()
# userinfo = {"sub":"1","username":"lynn","email":"lynn@example.com","avatar":"..."}
```

### 刷新 token

```python
resp = requests.post(disc["token_endpoint"], data={
    "grant_type": "refresh_token",
    "refresh_token": stored_refresh_token,   # 旧值
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,           # 公开客户端用 PKCE 流程,刷新时仍需 client_id
})
new_tokens = resp.json()
# 用 new_tokens["refresh_token"] 替换存储的旧 refresh_token(轮换)
```

### 吊销(登出)

```python
requests.post(disc["revocation_endpoint"], data={
    "token": stored_refresh_token,
    "token_type_hint": "refresh_token",
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
})
# 始终返回 200 {}
```

---

## 参考

- [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) — OAuth 2.0 Framework
- [RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750) — Bearer Token Usage
- [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) — PKCE
- [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) — Token Revocation
- [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) — Token Introspection
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)
