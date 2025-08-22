#!/bin/bash

# LAAA 本地开发启动脚本

set -e

echo "🚀 启动 LAAA 统一身份认证系统 (本地开发版)..."

# 检查Python环境
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 未安装，请先安装 Python 3.8+"
    exit 1
fi

# 检查是否在虚拟环境中
if [[ "$VIRTUAL_ENV" == "" ]]; then
    echo "📝 创建虚拟环境..."
    python3 -m venv venv
    echo "🔧 激活虚拟环境..."
    source venv/bin/activate
else
    echo "✅ 已在虚拟环境中"
fi

# 安装后端依赖
echo "📦 安装后端依赖..."
cd backend
pip install -r requirements.txt
cd ..

# 设置环境变量
export DATABASE_URL="sqlite:///./laaa.db"
export SECRET_KEY="dev-secret-key-change-in-production"
export REDIS_URL="redis://localhost:6379/0"

echo "🗄️ 初始化SQLite数据库..."
cd backend
python3 -c "
from app.core.database import engine
from app.models import Base
Base.metadata.create_all(bind=engine)

# 创建管理员用户
from sqlalchemy.orm import sessionmaker
from app.models.user import User
from app.core.security import get_password_hash
import uuid

Session = sessionmaker(bind=engine)
session = Session()

# 检查是否已存在管理员
admin = session.query(User).filter(User.username == 'admin').first()
if not admin:
    admin = User(
        id=uuid.uuid4(),
        username='admin',
        email='admin@example.com',
        password_hash=get_password_hash('admin123'),
        security_level=4,
        is_active=True,
        is_superuser=True,
        email_verified=True
    )
    session.add(admin)
    session.commit()
    print('管理员用户创建完成')
else:
    print('管理员用户已存在')

session.close()
print('数据库初始化完成')
"

echo "🚀 启动后端服务..."
python3 run.py &
BACKEND_PID=$!

echo ""
echo "🎉 LAAA 本地开发版启动完成！"
echo ""
echo "🔧 后端API: http://localhost:8000"
echo "📚 API文档: http://localhost:8000/docs"
echo ""
echo "👤 默认管理员账户:"
echo "   用户名: admin"
echo "   密码: admin123"
echo ""
echo "⚠️  这是开发版本，使用SQLite数据库"
echo ""
echo "📋 停止服务:"
echo "   按 Ctrl+C 停止"
echo ""

# 等待用户按键停止
trap "echo '正在停止服务...'; kill $BACKEND_PID; exit 0" INT

wait $BACKEND_PID