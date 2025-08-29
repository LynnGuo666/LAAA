# OAuth 2.0 / OIDC 授权服务器

一个完整的OAuth 2.0和OpenID Connect (OIDC)授权服务器实现，使用FastAPI作为后端，Next.js作为前端界面。

## 🚀 功能特性

### OAuth 2.0 支持
- ✅ 授权码流程 (Authorization Code Flow)
- ✅ PKCE (Proof Key for Code Exchange)
- ✅ 客户端认证 (Client Authentication)
- ✅ 令牌刷新 (Refresh Token)
- ✅ 令牌撤销 (Token Revocation)
- ✅ 令牌内省 (Token Introspection)

### OpenID Connect 支持
- ✅ ID Token
- ✅ UserInfo端点
- ✅ Discovery端点
- ✅ JWKS端点
- ✅ 标准Claims (profile, email, phone等)
- ✅ Nonce支持

### 安全特性
- 🔒 JWT签名验证
- 🔒 HTTPS传输支持
- 🔒 安全的密钥管理
- 🔒 密码哈希存储
- 🔒 CORS配置
- 🔒 输入验证

### 用户界面
- 🎨 现代化的登录界面
- 🎨 授权同意页面
- 🎨 用户注册功能
- 🎨 响应式设计
- 🎨 多语言支持

## 📋 技术栈

### 后端
- **FastAPI** - 高性能Web框架
- **SQLAlchemy** - ORM
- **PostgreSQL** - 数据库
- **Alembic** - 数据库迁移
- **Pydantic** - 数据验证
- **python-jose** - JWT处理
- **passlib** - 密码哈希

### 前端
- **Next.js 14** - React框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 样式框架
- **Axios** - HTTP客户端

## 🛠 快速开始

### 环境要求
- Python 3.8+
- Node.js 18+
- PostgreSQL 12+

### 安装步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd LAAA
   ```

2. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env 文件配置数据库连接等信息
   ```

3. **启动开发环境**
   ```bash
   chmod +x dev-start.sh
   ./dev-start.sh
   ```

4. **访问服务**
   - 前端界面: http://localhost:3000
   - 后端API: http://localhost:8000
   - API文档: http://localhost:8000/docs

### 手动启动

**启动后端：**
```bash
# 安装依赖
pip install -r requirements.txt

# 运行数据库迁移
alembic upgrade head

# 启动服务器
python main.py
```

**启动前端：**
```bash
cd frontend
npm install
npm run dev
```

## 📖 API文档

### 核心端点

#### OAuth 2.0 端点
- `GET /oauth/authorize` - 授权端点
- `POST /oauth/token` - 令牌端点
- `POST /oauth/revoke` - 令牌撤销
- `GET /oauth/introspect` - 令牌内省

#### OpenID Connect 端点
- `GET /oauth/.well-known/openid_configuration` - Discovery端点
- `GET /oauth/userinfo` - 用户信息端点
- `GET /oauth/jwks` - JWKS端点

#### API端点
- `POST /api/v1/users` - 用户注册
- `GET /api/v1/users/me` - 获取当前用户信息
- `POST /api/v1/clients` - 创建OAuth客户端
- `GET /api/v1/clients` - 获取客户端列表

### 使用示例

#### 授权码流程

1. **重定向用户到授权端点：**
   ```
   GET /oauth/authorize?
     response_type=code&
     client_id=YOUR_CLIENT_ID&
     redirect_uri=YOUR_REDIRECT_URI&
     scope=openid profile email&
     state=random_state&
     code_challenge=CODE_CHALLENGE&
     code_challenge_method=S256
   ```

2. **用户授权后，获取授权码：**
   ```
   YOUR_REDIRECT_URI?code=AUTHORIZATION_CODE&state=random_state
   ```

3. **交换授权码获取令牌：**
   ```bash
   curl -X POST http://localhost:8000/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code" \
     -d "code=AUTHORIZATION_CODE" \
     -d "redirect_uri=YOUR_REDIRECT_URI" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "code_verifier=CODE_VERIFIER"
   ```

## 🗄 数据库架构

### 主要表结构

- **users** - 用户信息
- **client_applications** - OAuth客户端应用
- **authorization_codes** - 授权码
- **oauth2_tokens** - OAuth令牌
- **user_authorizations** - 用户授权记录

## ⚙️ 配置选项

### 环境变量

```bash
# 数据库配置
DATABASE_URL=postgresql://user:password@localhost:5432/oauth_db

# JWT配置
SECRET_KEY=your-super-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# OIDC配置
JWT_ISSUER=https://localhost:8000
JWT_AUDIENCE=oauth-client

# CORS配置
CORS_ORIGINS=["http://localhost:3000", "http://localhost:8080"]
```

## 🧪 测试

### 运行测试
```bash
# 后端测试
pytest

# 前端测试
cd frontend
npm test
```

### OAuth 2.0 合规性测试

可以使用以下工具测试OAuth 2.0合规性：
- [OAuth 2.0 Security Best Current Practice](https://tools.ietf.org/html/draft-ietf-oauth-security-topics)
- [OpenID Connect Certification](https://openid.net/certification/)

## 📦 部署

### Docker部署

1. **构建镜像**
   ```bash
   docker build -t oauth-server .
   ```

2. **运行容器**
   ```bash
   docker run -p 8000:8000 oauth-server
   ```

### 生产环境配置

1. **使用HTTPS**
2. **配置反向代理**
3. **设置环境变量**
4. **数据库连接池**
5. **日志配置**

## 🤝 贡献

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

此项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🆘 支持

如有问题或需要帮助，请：

1. 查看[文档](docs/)
2. 提交[Issue](https://github.com/your-repo/issues)
3. 参与[讨论](https://github.com/your-repo/discussions)

## 🎯 路线图

- [ ] 多因子认证 (MFA)
- [ ] 设备流程 (Device Flow)
- [ ] SAML支持
- [ ] 管理后台界面
- [ ] 审计日志
- [ ] 国际化 (i18n)
- [ ] 主题定制

---

Made with ❤️ using FastAPI and Next.js