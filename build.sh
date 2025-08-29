#!/bin/bash

echo "🔨 构建OAuth 2.0 / OIDC授权服务器..."

# 构建前端
echo "📦 构建前端静态文件..."
cd frontend
npm run build
cd ..

echo "✅ 构建完成！"
echo ""
echo "🚀 启动服务器："
echo "   python main.py"
echo ""
echo "🌐 服务地址："
echo "   http://localhost:8000"
echo ""