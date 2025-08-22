# LAAA - 统一身份认证系统

基于 OAuth2.0 的企业级统一身份认证系统，支持多因子认证、设备管理、邀请制注册等高级安全特性。

## 🌟 核心特性

### 安全认证
- **四级安全等级**: 低级(1) → 中级(2) → 高级(3) → 管理员级(4)
- **多因子认证**: 支持 TOTP、邮箱验证、备用验证码
- **设备管理**: 设备信任、设备指纹识别
- **邀请制注册**: 基于邀请码的用户注册机制

### OAuth2.0 支持
- **标准流程**: Authorization Code Flow、Client Credentials Flow
- **令牌管理**: Access Token、Refresh Token 自动刷新
- **作用域控制**: 细粒度的权限作用域管理
- **应用隔离**: 按应用维度的权限管理

### 权限系统
- **基于资源-操作**: 细粒度的权限控制模型
- **设备级权限**: 支持按设备分配应用权限
- **敏感操作验证**: 高危操作需要额外身份验证
- **动态权限检查**: 实时权限验证和过期控制

### 管理功能
- **用户管理**: 用户创建、安全等级调整、状态管理
- **应用管理**: OAuth 应用注册、配置、权限要求设置
- **邀请码管理**: 批量生成、使用限制、过期控制
- **系统监控**: 实时统计、审计日志、安全报告

## 🏗️ 技术架构

### 后端技术栈
- **Python 3.11** + **FastAPI** - 高性能异步API框架
- **SQLAlchemy 2.0** + **PostgreSQL** - 现代ORM和关系数据库
- **Redis** - 缓存和会话存储
- **PyOTP** - TOTP双因子认证
- **Jose** - JWT令牌处理
- **Pydantic** - 数据验证和序列化

### 前端技术栈
- **Next.js 14** + **React 18** - 现代前端框架
- **TypeScript** - 类型安全的JavaScript
- **Tailwind CSS** - 原子化CSS框架
- **React Hook Form** + **Zod** - 表单处理和验证
- **Axios** - HTTP客户端

### 部署架构
- **Docker** + **Docker Compose** - 容器化部署
- **Nginx** - 前端静态文件服务
- **PostgreSQL 15** - 主数据库
- **Redis 7** - 缓存服务

## 🚀 快速开始

### 前置要求
- Docker 20.10+
- Docker Compose 2.0+
- Git

### 一键部署

```bash
# 克隆项目
git clone <repository-url>
cd LAAA

# 构建并启动
./scripts/start.sh
```

### 访问系统

- **前端界面**: http://localhost:3000
- **API文档**: http://localhost:8000/docs
- **管理面板**: http://localhost:3000/dashboard

### 默认账户

- **管理员用户名**: `admin`
- **管理员密码**: `admin123`
- **默认邀请码**: `CODE123456`

⚠️ **重要**: 首次部署后请立即修改默认密码和配置！

## 📋 详细配置

### 环境变量配置

编辑 `.env` 文件：

```bash
# 数据库配置
DB_PASSWORD=your_secure_database_password

# JWT密钥 (请使用强密钥)
SECRET_KEY=your_jwt_secret_key_at_least_32_chars

# 邮件配置 (SendGrid)
SENDGRID_API_KEY=your_sendgrid_api_key
FROM_EMAIL=noreply@yourdomain.com

# API地址
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 数据库初始化

系统首次启动时会自动：
- 创建所有数据表
- 插入基础权限数据
- 创建默认管理员账户
- 生成初始邀请码

### 权限系统配置

系统预置以下权限：

| 资源 | 操作 | 所需安全等级 | 额外验证 |
|------|------|--------------|----------|
| users | read | 2 | 否 |
| users | create | 3 | 是 |
| users | update | 3 | 是 |
| users | delete | 4 | 是 |
| applications | read | 2 | 否 |
| applications | create | 3 | 是 |
| applications | update | 3 | 是 |
| applications | delete | 4 | 是 |
| invitations | manage | 3 | 否 |
| system | admin | 4 | 是 |

## 🔧 开发指南

### 本地开发环境

#### 后端开发

```bash
cd backend

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或 venv\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements.txt

# 启动开发服务器
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### 前端开发

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### API 文档

启动后端服务后，访问以下地址查看完整API文档：
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### 主要API端点

#### 认证相关
- `POST /api/v1/auth/login` - 用户登录
- `POST /api/v1/auth/register` - 用户注册
- `GET /api/v1/auth/me` - 获取当前用户信息
- `POST /api/v1/auth/enable-totp` - 启用TOTP
- `GET /api/v1/auth/devices` - 获取设备列表

#### OAuth2.0
- `GET /oauth/authorize` - 授权端点
- `POST /oauth/token` - 令牌端点
- `GET /oauth/userinfo` - 用户信息端点
- `POST /oauth/revoke` - 撤销令牌

#### 管理功能
- `POST /api/v1/admin/invitation-codes` - 创建邀请码
- `GET /api/v1/admin/users` - 用户列表
- `POST /api/v1/admin/applications` - 创建应用
- `GET /api/v1/admin/stats` - 系统统计

## 🔐 安全特性

### 认证安全
- **密码哈希**: 使用 bcrypt 算法
- **JWT签名**: HS256 算法签名
- **令牌过期**: Access Token 15分钟，Refresh Token 30天
- **账户锁定**: 5次失败登录后锁定30分钟

### 传输安全
- **HTTPS强制**: 生产环境强制HTTPS
- **CORS配置**: 严格的跨域资源共享配置
- **安全头**: X-Frame-Options, X-Content-Type-Options等

### 应用安全
- **SQL注入防护**: 使用SQLAlchemy ORM
- **XSS防护**: 输入验证和输出编码
- **CSRF防护**: 状态令牌验证

## 📊 系统监控

### 日志管理

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 健康检查

- **后端健康检查**: http://localhost:8000/health
- **数据库连接**: 自动重连机制
- **Redis连接**: 连接池管理

## 🔄 常用操作

### 重启服务
```bash
docker-compose restart
```

### 停止服务
```bash
docker-compose down
```

### 重建服务
```bash
docker-compose down
docker-compose build
docker-compose up -d
```

### 备份数据库
```bash
docker-compose exec db pg_dump -U laaa laaa > backup.sql
```

### 恢复数据库
```bash
docker-compose exec -T db psql -U laaa laaa < backup.sql
```

## 🧩 扩展开发

### 添加新权限

1. 在数据库中插入新权限：
```sql
INSERT INTO permissions (name, resource, action, required_security_level) 
VALUES ('新权限', '资源名', '操作名', 所需等级);
```

2. 在代码中使用权限检查：
```python
if permission_service.check_permission(user_id, '资源名', '操作名'):
    # 执行操作
```

### 集成新的认证方式

系统支持扩展其他认证方式，如：
- LDAP/AD集成
- 第三方OAuth (GitHub, Google等)
- 硬件密钥 (FIDO2/WebAuthn)
- 短信验证

### 自定义前端主题

修改 `frontend/tailwind.config.js` 中的颜色配置：

```javascript
theme: {
  extend: {
    colors: {
      primary: {
        50: '#your-color',
        500: '#your-color',
        // ...
      }
    }
  }
}
```

## 📝 更新日志

### v1.0.0
- ✅ 完整的OAuth2.0实现
- ✅ 四级安全等级系统
- ✅ TOTP双因子认证
- ✅ 设备管理功能
- ✅ 邀请制注册
- ✅ 完整的管理后台
- ✅ Docker容器化部署

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 📞 支持与联系

- **问题反馈**: 请通过 Issues 页面提交
- **功能建议**: 欢迎提交 Feature Request
- **安全问题**: 请通过私有渠道联系

---

**⚠️ 安全提醒**: 本系统涉及身份认证和授权，部署到生产环境前请：
1. 修改所有默认密码和密钥
2. 启用 HTTPS
3. 配置防火墙规则
4. 定期更新依赖包
5. 监控安全日志