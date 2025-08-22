-- 初始化数据库脚本
-- 创建管理员用户和基础权限

-- 插入基础权限
INSERT INTO permissions (id, name, resource, action, required_security_level, require_additional_verification) VALUES
(gen_random_uuid(), 'Read Users', 'users', 'read', 2, false),
(gen_random_uuid(), 'Create Users', 'users', 'create', 3, true),
(gen_random_uuid(), 'Update Users', 'users', 'update', 3, true),
(gen_random_uuid(), 'Delete Users', 'users', 'delete', 4, true),
(gen_random_uuid(), 'Read Applications', 'applications', 'read', 2, false),
(gen_random_uuid(), 'Create Applications', 'applications', 'create', 3, true),
(gen_random_uuid(), 'Update Applications', 'applications', 'update', 3, true),
(gen_random_uuid(), 'Delete Applications', 'applications', 'delete', 4, true),
(gen_random_uuid(), 'Access Applications', 'applications', 'access', 1, false),
(gen_random_uuid(), 'Manage Invitations', 'invitations', 'manage', 3, false),
(gen_random_uuid(), 'System Admin', 'system', 'admin', 4, true);

-- 插入默认管理员用户 (密码: admin123)
INSERT INTO users (id, username, email, password_hash, security_level, is_active, is_superuser, email_verified) VALUES
(gen_random_uuid(), 'admin', 'admin@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewQZb5HcWZy./LBy', 4, true, true, true);

-- 创建默认应用
INSERT INTO applications (id, name, description, client_id, client_secret, redirect_uris, required_security_level, require_mfa, created_by) VALUES
(gen_random_uuid(), 'LAAA Dashboard', '系统管理面板', 'laaa_dashboard', 'dashboard_secret_change_me', ARRAY['http://localhost:3000/auth/callback'], 1, false, (SELECT id FROM users WHERE username = 'admin'));

-- 创建初始邀请码 (CODE123456)
INSERT INTO invitation_codes (id, code, created_by, max_uses, expires_at, security_level, is_active) VALUES
(gen_random_uuid(), 'CODE123456', (SELECT id FROM users WHERE username = 'admin'), 10, NOW() + INTERVAL '30 days', 2, true);