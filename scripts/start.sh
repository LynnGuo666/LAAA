#!/bin/bash

# LAAA 统一身份认证系统启动脚本

set -e

echo "🚀 启动 LAAA 统一身份认证系统..."

# 检查是否安装了Docker和Docker Compose
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Compose"
    exit 1
fi

# 创建环境变量文件（如果不存在）
if [ ! -f .env ]; then
    echo "📝 创建环境变量文件..."
    cat > .env << EOF
# 数据库配置
DB_PASSWORD=secure_password_change_me

# JWT密钥 (请在生产环境中修改)
SECRET_KEY=your-secret-key-change-me-in-production

# 邮件配置 (可选)
SENDGRID_API_KEY=
FROM_EMAIL=noreply@example.com

# 前端API地址
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF
    echo "✅ 环境变量文件已创建，请根据需要修改 .env 文件"
fi

# 构建前端
echo "📦 构建前端应用..."
cd frontend
if [ ! -d node_modules ]; then
    echo "📥 安装前端依赖..."
    npm install
fi
echo "🏗️ 构建前端静态文件..."
npm run build
cd ..

# 启动服务
echo "🐳 启动 Docker 容器..."
docker-compose up -d

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 检查服务状态
echo "🔍 检查服务状态..."
docker-compose ps

# 运行数据库迁移
echo "🗄️ 初始化数据库..."
docker-compose exec -T backend python -c "
from app.core.database import engine
from app.models import Base
Base.metadata.create_all(bind=engine)
print('数据库表创建完成')
"

echo ""
echo "🎉 LAAA 系统启动完成！"
echo ""
echo "📱 前端地址: http://localhost:3000"
echo "🔧 后端API: http://localhost:8000"
echo "📚 API文档: http://localhost:8000/docs"
echo ""
echo "👤 默认管理员账户:"
echo "   用户名: admin"
echo "   密码: admin123"
echo ""
echo "🎫 默认邀请码: CODE123456"
echo ""
echo "⚠️  首次使用请及时修改默认密码和配置！"
echo ""
echo "📋 常用命令:"
echo "   停止服务: docker-compose down"
echo "   查看日志: docker-compose logs -f"
echo "   重启服务: docker-compose restart"
echo ""