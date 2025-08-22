#!/bin/bash

# LAAA 构建脚本

set -e

echo "🏗️ 构建 LAAA 统一身份认证系统..."

# 构建前端
echo "📦 构建前端应用..."
cd frontend

# 安装依赖
if [ ! -d node_modules ]; then
    echo "📥 安装前端依赖..."
    npm install
fi

# 构建静态文件
echo "🏗️ 构建前端静态文件..."
npm run build

cd ..

# 构建Docker镜像
echo "🐳 构建 Docker 镜像..."
docker-compose build

echo "✅ 构建完成！"
echo ""
echo "🚀 使用以下命令启动系统:"
echo "   ./scripts/start.sh"
echo ""