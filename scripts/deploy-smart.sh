#!/bin/bash

# 智能部署脚本 - 自动检测部署模式

echo "======================================"
echo "   Paper Burner X - 智能部署"
echo "======================================"
echo ""

# 检测部署模式
if [ -d "server" ] && [ -f "docker-compose.yml" ]; then
    echo "✓ 检测到后端代码，使用 Docker 完整模式"
    DEPLOY_MODE="docker"
else
    echo "✓ 检测到纯前端代码，使用 Vercel 模式"
    DEPLOY_MODE="frontend"
fi

echo ""

# 根据模式部署
case $DEPLOY_MODE in
    docker)
        echo "🐳 启动 Docker 部署..."

        # 检查 .env
        if [ ! -f ".env" ]; then
            echo "→ 创建 .env 文件"
            cp .env.example .env
            echo "⚠️  请配置 .env 文件后重新运行"
            exit 1
        fi

        # 安装依赖
        echo "→ 安装后端依赖..."
        cd server && npm install && npx prisma generate && cd ..

        # 启动服务
        echo "→ 启动 Docker 服务..."
        docker-compose up -d

        echo ""
        echo "✅ Docker 部署完成！"
        echo "   访问: http://localhost:3000"
        echo "   管理: http://localhost:3000/admin"
        ;;

    frontend)
        echo "🌐 前端部署指南..."
        echo ""
        echo "方式 1: Vercel 部署"
        echo "  1. 访问 https://vercel.com"
        echo "  2. 导入此 GitHub 仓库"
        echo "  3. 点击部署"
        echo ""
        echo "方式 2: 本地预览"
        echo "  python -m http.server 8000"
        echo "  访问 http://localhost:8000"
        ;;
esac

echo ""
