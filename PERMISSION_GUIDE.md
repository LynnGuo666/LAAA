# OAuth 2.0 权限管理系统使用指南

## 🎯 新增功能概览

现在OAuth服务器支持细分的权限管理系统：

### ✅ 功能特性
- **用户权限检查**：用户访问应用前会检查是否有相应权限
- **权限申请流程**：无权限用户可以申请访问权限
- **管理员审批**：管理员可以批准或拒绝权限申请
- **作用域控制**：可以精确控制用户可以访问的OAuth作用域
- **权限过期**：支持设置权限过期时间
- **权限撤销**：管理员可以随时撤销用户权限

## 🚀 快速开始

### 1. 初始化数据
```bash
python init_test_data.py
```
这会创建：
- 测试用户 `testuser` (密码: `password123`) - **具有管理员权限**
- 测试OAuth客户端应用

### 2. 启动服务
```bash
python main.py
```

### 3. 重新构建前端（如有修改）
```bash
cd frontend && npm run build && cd ..
```

## 📋 权限管理流程

### 用户权限申请流程

1. **用户访问OAuth授权URL**
   ```
   http://localhost:8000/oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=REDIRECT_URI&scope=openid profile email
   ```

2. **系统检查权限**
   - 如果有权限：正常显示授权页面
   - 如果无权限：重定向到权限申请页面

3. **用户填写申请**
   - 说明申请理由
   - 提交权限申请

4. **等待管理员审批**
   - 管理员在管理后台审核申请
   - 批准或拒绝申请

5. **获得权限后重新授权**
   - 用户重新访问OAuth授权URL
   - 系统验证权限后显示授权页面

### 管理员管理流程

1. **访问管理后台**
   ```
   http://localhost:8000/admin/permissions
   ```
   (需要管理员权限)

2. **审核权限申请**
   - 查看用户申请详情
   - 点击"批准"或"拒绝"
   - 系统自动创建权限记录

## 🔧 API端点说明

### 权限检查
```http
POST /api/v1/permissions/check
Content-Type: application/json

{
  "user_id": "user_uuid",
  "client_id": "client_uuid", 
  "requested_scopes": ["openid", "profile", "email"]
}
```

### 创建权限申请
```http
POST /api/v1/permissions/requests
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "client_id": "client_uuid",
  "requested_scopes": ["openid", "profile", "email"],
  "request_reason": "需要访问用户基本信息"
}
```

### 审批权限申请（管理员）
```http
PUT /api/v1/permissions/requests/{request_id}
Authorization: Bearer {admin_access_token}
Content-Type: application/json

{
  "status": "approved",
  "review_reason": "申请合理，予以批准"
}
```

### 创建用户权限（管理员）
```http
POST /api/v1/permissions/
Authorization: Bearer {admin_access_token}
Content-Type: application/json

{
  "user_id": "user_uuid",
  "client_id": "client_uuid",
  "is_allowed": true,
  "is_blocked": false,
  "allowed_scopes": ["openid", "profile", "email"],
  "approval_reason": "管理员直接授权"
}
```

## 🔒 权限状态说明

### 权限记录字段
- `is_allowed`: 是否允许访问（boolean）
- `is_blocked`: 是否被阻止（boolean） 
- `allowed_scopes`: 允许的作用域列表
- `denied_scopes`: 拒绝的作用域列表
- `expires_at`: 权限过期时间（可选）

### 权限检查逻辑
1. 无权限记录 → 需要申请权限
2. `is_blocked = true` → 被禁止使用，不能申请
3. `is_allowed = false` → 需要申请权限
4. `expires_at` 已过期 → 需要重新申请
5. 检查具体作用域权限

## 🎨 前端页面

- **权限申请页面**: `/permission-request`
- **管理员审批页面**: `/admin/permissions` 
- **回调处理页面**: `/callback`

## 📊 测试场景

### 场景1：首次访问应用
1. 用户点击OAuth授权链接
2. 系统检测到无权限，重定向到申请页面
3. 用户填写申请理由并提交
4. 管理员审批通过
5. 用户重新访问授权链接，正常显示授权页面

### 场景2：权限被拒绝
1. 用户提交权限申请
2. 管理员拒绝申请
3. 用户重新访问会显示"抱歉没有使用这个应用的权限"

### 场景3：管理员直接授权
1. 管理员通过API直接为用户创建权限
2. 用户访问OAuth授权链接时直接显示授权页面

## 🔧 自定义配置

### 权限策略
可以在 `PermissionService.check_user_permission` 方法中修改权限检查逻辑

### UI定制
前端页面使用Tailwind CSS，可以轻松修改样式和布局

### 作用域描述
在前端页面的 `getScopeDescription` 函数中添加更多作用域描述

---

现在你拥有了一个**完整的OAuth 2.0权限管理系统**！🚀