# 统一身份认证系统设计文档

## 项目概述
构建一个基于OAuth2.0的统一身份认证系统，支持多应用接入和细粒度权限管理。

### 技术栈
- **后端**: Python FastAPI + SQLAlchemy + PostgreSQL/MySQL
- **前端**: Next.js + React + TypeScript
- **认证协议**: OAuth2.0 + OpenID Connect
- **部署**: Docker + Docker Compose

## 系统架构

### 后端架构 (FastAPI)
```
├── app/
│   ├── main.py                 # FastAPI应用入口
│   ├── core/
│   │   ├── config.py          # 配置管理
│   │   ├── security.py        # 安全相关工具
│   │   └── database.py        # 数据库连接
│   ├── models/
│   │   ├── user.py            # 用户模型
│   │   ├── application.py     # 应用模型
│   │   ├── permission.py      # 权限模型
│   │   └── oauth.py           # OAuth相关模型
│   ├── schemas/
│   │   ├── user.py            # 用户Pydantic模型
│   │   ├── application.py     # 应用Pydantic模型
│   │   └── oauth.py           # OAuth Pydantic模型
│   ├── api/
│   │   ├── v1/
│   │   │   ├── auth.py        # 认证相关API
│   │   │   ├── users.py       # 用户管理API
│   │   │   ├── applications.py # 应用管理API
│   │   │   └── oauth.py       # OAuth2.0 API
│   ├── services/
│   │   ├── auth_service.py    # 认证服务
│   │   ├── oauth_service.py   # OAuth服务
│   │   └── permission_service.py # 权限服务
│   └── utils/
│       ├── jwt.py             # JWT工具
│       └── validators.py      # 验证工具
```

### 前端架构 (Next.js)
```
├── frontend/
│   ├── src/
│   │   ├── app/               # Next.js 13+ App Router
│   │   │   ├── layout.tsx     # 根布局
│   │   │   ├── page.tsx       # 首页
│   │   │   ├── auth/          # 认证相关页面
│   │   │   ├── dashboard/     # 管理面板
│   │   │   └── applications/  # 应用管理
│   │   ├── components/
│   │   │   ├── ui/            # UI组件
│   │   │   ├── auth/          # 认证组件
│   │   │   └── forms/         # 表单组件
│   │   ├── lib/
│   │   │   ├── api.ts         # API客户端
│   │   │   ├── auth.ts        # 认证工具
│   │   │   └── utils.ts       # 通用工具
│   │   └── types/
│   │       └── auth.ts        # 类型定义
│   ├── public/                # 静态资源
│   ├── package.json
│   └── next.config.js
```

## 数据库设计

### 核心表结构

#### users 表
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    security_level INTEGER DEFAULT 1, -- 1:低级, 2:中级, 3:高级, 4:管理员级
    totp_secret VARCHAR(255), -- TOTP密钥
    totp_enabled BOOLEAN DEFAULT FALSE,
    email_verified BOOLEAN DEFAULT FALSE,
    phone VARCHAR(20),
    phone_verified BOOLEAN DEFAULT FALSE,
    backup_codes TEXT[], -- 备用验证码
    is_active BOOLEAN DEFAULT TRUE,
    is_superuser BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(id), -- 创建者(邀请者)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP
);
```

#### invitation_codes 表
```sql
CREATE TABLE invitation_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) UNIQUE NOT NULL,
    created_by UUID REFERENCES users(id) NOT NULL,
    used_by UUID REFERENCES users(id),
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    security_level INTEGER DEFAULT 1, -- 被邀请用户的最大安全等级
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP
);
```

#### user_devices 表
```sql
CREATE TABLE user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL, -- 设备唯一标识
    device_name VARCHAR(100),
    device_type VARCHAR(50), -- web, mobile, desktop
    device_fingerprint TEXT, -- 设备指纹
    is_trusted BOOLEAN DEFAULT FALSE,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, device_id)
);
```

#### security_verifications 表
```sql
CREATE TABLE security_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    verification_type VARCHAR(20) NOT NULL, -- totp, email, sms
    verification_code VARCHAR(10),
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### applications 表
```sql
CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    client_id VARCHAR(255) UNIQUE NOT NULL,
    client_secret VARCHAR(255) NOT NULL,
    redirect_uris TEXT[], -- JSON数组存储多个回调URL
    allowed_scopes TEXT[] DEFAULT '{"read"}',
    required_security_level INTEGER DEFAULT 1, -- 访问应用所需的最低安全等级
    require_mfa BOOLEAN DEFAULT FALSE, -- 是否强制MFA验证
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### application_device_permissions 表
```sql
CREATE TABLE application_device_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    device_id UUID REFERENCES user_devices(id) ON DELETE CASCADE,
    granted_permissions TEXT[], -- 在该设备上对该应用的权限
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, application_id, device_id)
);
```

#### permissions 表
```sql
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    resource VARCHAR(100) NOT NULL, -- 资源名称
    action VARCHAR(50) NOT NULL,    -- 操作类型 (read, write, delete等)
    required_security_level INTEGER DEFAULT 1, -- 执行该权限所需的最低安全等级
    require_additional_verification BOOLEAN DEFAULT FALSE, -- 是否需要额外验证
    UNIQUE(resource, action)
);
```

#### user_permissions 表 (用户权限关联)
```sql
CREATE TABLE user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, permission_id, application_id)
);
```

#### oauth_tokens 表
```sql
CREATE TABLE oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    access_token VARCHAR(500) NOT NULL,
    refresh_token VARCHAR(500),
    token_type VARCHAR(20) DEFAULT 'Bearer',
    expires_at TIMESTAMP NOT NULL,
    scopes TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## OAuth2.0 流程设计

### 授权码流程 (Authorization Code Flow)
1. **授权请求**: 客户端重定向用户到授权服务器
   ```
   GET /oauth/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}&state={state}
   ```

2. **用户授权**: 用户登录并确认授权

3. **授权码返回**: 重定向到客户端并携带授权码
   ```
   GET {redirect_uri}?code={authorization_code}&state={state}
   ```

4. **令牌交换**: 客户端使用授权码换取访问令牌
   ```
   POST /oauth/token
   Content-Type: application/x-www-form-urlencoded
   
   grant_type=authorization_code&code={code}&redirect_uri={redirect_uri}&client_id={client_id}&client_secret={client_secret}
   ```

### 支持的授权类型
- `authorization_code`: 授权码模式
- `refresh_token`: 刷新令牌模式
- `client_credentials`: 客户端凭证模式

## API 设计

### 认证相关 API
```python
# 用户登录
POST /api/v1/auth/login
{
    "username": "user@example.com",
    "password": "password"
}

# 用户注册
POST /api/v1/auth/register
{
    "username": "newuser",
    "email": "user@example.com",
    "password": "password"
}

# 获取用户信息
GET /api/v1/auth/me
Authorization: Bearer {access_token}
```

### OAuth2.0 API
```python
# 授权端点
GET /oauth/authorize?response_type=code&client_id={id}&redirect_uri={uri}&scope={scope}

# 令牌端点
POST /oauth/token
{
    "grant_type": "authorization_code",
    "code": "auth_code",
    "redirect_uri": "callback_url",
    "client_id": "client_id",
    "client_secret": "client_secret"
}

# 用户信息端点
GET /oauth/userinfo
Authorization: Bearer {access_token}
```

### 应用管理 API
```python
# 创建应用
POST /api/v1/applications
{
    "name": "My App",
    "description": "Application description",
    "redirect_uris": ["https://myapp.com/callback"]
}

# 获取应用列表
GET /api/v1/applications

# 更新应用
PUT /api/v1/applications/{id}

# 删除应用
DELETE /api/v1/applications/{id}
```

## 权限管理设计

### 权限模型
- **基于资源-操作**: 每个权限定义为对特定资源的特定操作
- **应用级隔离**: 权限在应用范围内生效
- **角色聚合**: 支持将多个权限组合成角色

### 权限检查流程
1. 解析JWT令牌获取用户ID和应用ID
2. 查询用户在该应用下的权限
3. 验证请求的资源和操作是否被授权

## 部署方案

### 项目结构
```
LAAA/
├── docker-compose.yml        # Docker编排文件
├── backend/                  # FastAPI后端
├── frontend/                 # Next.js前端
├── nginx/                   # Nginx配置
└── scripts/
    ├── start.sh             # 启动脚本
    └── build.sh             # 构建脚本
```

### Docker配置
```yaml
# docker-compose.yml
version: '3.8'
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: laaa
      POSTGRES_USER: laaa
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://laaa:password@db:5432/laaa
    depends_on:
      - db
    ports:
      - "8000:8000"

  frontend:
    build: ./frontend
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
    ports:
      - "3000:3000"

volumes:
  postgres_data:
```

### 启动流程
1. **构建前端**: `cd frontend && npm run build`
2. **启动服务**: `docker-compose up -d`
3. **数据库迁移**: `docker-compose exec backend alembic upgrade head`

## 安全考虑

### JWT安全
- 使用RS256算法签名
- 设置合理的过期时间 (access_token: 15分钟, refresh_token: 30天)
- 支持令牌撤销

### OAuth2.0安全
- PKCE支持防止授权码拦截
- State参数防CSRF攻击
- 严格的重定向URI验证

### 传输安全
- 强制HTTPS
- CORS配置
- 请求频率限制

## 开发计划

### Phase 1: 核心功能
- [ ] 用户认证系统
- [ ] OAuth2.0基础流程
- [ ] 应用管理
- [ ] 基础权限控制

### Phase 2: 高级功能
- [ ] 角色管理
- [ ] 审计日志
- [ ] 多因素认证
- [ ] 单点登录(SSO)

### Phase 3: 运维功能
- [ ] 监控面板
- [ ] 性能优化
- [ ] 集群部署
- [ ] 备份恢复