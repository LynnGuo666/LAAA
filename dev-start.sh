#!/bin/bash

# 启动开发环境脚本

echo "🚀 启动OAuth 2.0 / OIDC授权服务器开发环境..."

# 检查Python环境
if ! command -v python3 &> /dev/null; then
    echo "❌ 未找到Python3，请先安装Python"
    exit 1
fi

# 检查Node.js环境
if ! command -v node &> /dev/null; then
    echo "❌ 未找到Node.js，请先安装Node.js"
    exit 1
fi

# 检查环境变量
if [ ! -f .env ]; then
    echo "📝 创建.env文件..."
    cp .env.example .env
    echo "✅ 请编辑.env文件配置数据库连接等信息"
fi

# 安装Python依赖
echo "📦 安装Python依赖..."
pip install -r requirements.txt

# 安装前端依赖
echo "📦 安装前端依赖..."
cd frontend && npm install && cd ..

# 启动函数
start_backend() {
    echo "🔧 启动FastAPI后端服务器 (端口8000)..."
    python main.py &
    BACKEND_PID=$!
    echo "后端PID: $BACKEND_PID"
}

start_frontend() {
    echo "🌐 启动Next.js前端服务器 (端口3000)..."
    cd frontend
    npm run dev &
    FRONTEND_PID=$!
    cd ..
    echo "前端PID: $FRONTEND_PID"
}

# 清理函数
cleanup() {
    echo "🛑 正在关闭服务器..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    exit 0
}

# 捕获中断信号
trap cleanup SIGINT SIGTERM

# 启动服务
start_backend
start_frontend

echo ""
echo "✅ 服务启动完成！"
echo "🔗 访问地址："
echo "   前端界面: http://localhost:3000"
echo "   后端API: http://localhost:8000"
echo "   API文档: http://localhost:8000/docs"
echo "   OIDC Discovery: http://localhost:8000/oauth/.well-known/openid_configuration"
echo ""
echo "📝 要停止服务，请按 Ctrl+C"
echo ""

# 等待进程
wait