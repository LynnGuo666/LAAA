#!/usr/bin/env python3
"""
OAuth Server - 启动脚本
直接运行此文件启动服务器
"""
import sys
import os

# 将 backend 目录添加到 Python 路径
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)

if __name__ == "__main__":
    import uvicorn
    from app.config import get_settings

    settings = get_settings()

    print(f"🚀 Starting {settings.app_name}...")
    print(f"📝 API Docs: http://localhost:{settings.port}/api/docs")
    print(f"🌐 Web UI: http://localhost:{settings.port}")
    print(f"")
    print(f"Press CTRL+C to stop")
    print(f"")

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level="debug" if settings.debug else "info",
        access_log=True,
    )
