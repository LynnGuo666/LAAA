#!/bin/bash

# 启动脚本

echo "Starting OAuth 2.0 / OIDC Authorization Server..."

# 检查环境变量
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "Please edit .env file with your configuration"
fi

# 安装依赖
echo "Installing dependencies..."
pip install -r requirements.txt

# 运行数据库迁移
echo "Running database migrations..."
alembic upgrade head

# 启动服务器
echo "Starting server..."
python main.py