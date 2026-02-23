#!/bin/bash

# Paper Burner X - 部署前检查和修复脚本

echo "======================================"
echo "Paper Burner X - 部署前检查"
echo "======================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 已安装"
        return 0
    else
        echo -e "${RED}✗${NC} $1 未安装"
        return 1
    fi
}

# 1. 检查必要的命令
echo "1. 检查系统依赖..."
check_command docker || DOCKER_MISSING=1
check_command docker-compose || DOCKER_COMPOSE_MISSING=1
check_command node || NODE_MISSING=1
check_command npm || NPM_MISSING=1
echo ""

# 2. 检查环境变量文件
echo "2. 检查配置文件..."
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} .env 文件存在"
else
    echo -e "${YELLOW}!${NC} .env 文件不存在，从模板复制..."
    cp .env.example .env
    echo -e "${YELLOW}⚠${NC} 请编辑 .env 文件并配置必要的环境变量！"
    echo "   必须修改："
    echo "   - DB_PASSWORD"
    echo "   - JWT_SECRET"
    echo "   - ADMIN_EMAIL"
    echo "   - ADMIN_PASSWORD"
fi
echo ""

# 3. 安装后端依赖
echo "3. 安装后端依赖..."
if [ -d "server/node_modules" ]; then
    echo -e "${GREEN}✓${NC} 后端依赖已安装"
else
    echo -e "${YELLOW}→${NC} 正在安装后端依赖..."
    cd server
    npm install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} 后端依赖安装成功"
    else
        echo -e "${RED}✗${NC} 后端依赖安装失败"
        exit 1
    fi
    cd ..
fi
echo ""

# 4. 生成 Prisma Client
echo "4. 生成 Prisma Client..."
cd server
npx prisma generate
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Prisma Client 生成成功"
else
    echo -e "${RED}✗${NC} Prisma Client 生成失败"
    exit 1
fi
cd ..
echo ""

# 5. 检查前端文件
echo "5. 检查前端文件..."
if [ -f "index.html" ]; then
    echo -e "${GREEN}✓${NC} index.html 存在"
else
    echo -e "${RED}✗${NC} index.html 不存在"
    exit 1
fi

if [ -f "js/storage/storage-adapter.js" ]; then
    echo -e "${GREEN}✓${NC} storage-adapter.js 存在"
else
    echo -e "${RED}✗${NC} storage-adapter.js 不存在"
    exit 1
fi
echo ""

# 6. 提供部署选项
echo "======================================"
echo "部署选项："
echo "======================================"
echo ""
echo "选择部署模式："
echo "  1) Vercel 前端部署（纯静态）"
echo "  2) Docker 后端部署（完整功能）"
echo "  3) 本地开发模式"
echo ""
read -p "请选择 (1-3): " choice

case $choice in
    1)
        echo ""
        echo "Vercel 前端部署步骤："
        echo "1. 访问 https://vercel.com"
        echo "2. 导入此 GitHub 仓库"
        echo "3. 保持默认配置点击部署"
        echo "4. 完成！"
        echo ""
        echo "注意：Vercel 模式下数据存储在浏览器本地"
        ;;
    2)
        echo ""
        echo "正在启动 Docker 服务..."

        # 检查 .env 是否配置
        if grep -q "changeme" .env; then
            echo -e "${RED}⚠${NC} 警告：.env 文件包含默认值！"
            echo "   请编辑 .env 文件后再启动服务"
            exit 1
        fi

        # 启动 Docker
        docker-compose up -d

        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓${NC} Docker 服务启动成功！"
            echo ""
            echo "访问地址："
            echo "  主应用: http://localhost:3000"
            echo "  管理面板: http://localhost:3000/admin"
            echo ""
            echo "查看日志: docker-compose logs -f app"
        else
            echo -e "${RED}✗${NC} Docker 服务启动失败"
            exit 1
        fi
        ;;
    3)
        echo ""
        echo "启动本地开发服务器..."
        cd server
        npm run dev &
        SERVER_PID=$!
        echo ""
        echo -e "${GREEN}✓${NC} 开发服务器已启动"
        echo "  后端 API: http://localhost:3000/api"
        echo "  前端: 直接打开 index.html"
        echo ""
        echo "按 Ctrl+C 停止服务器"
        wait $SERVER_PID
        ;;
    *)
        echo "无效选择"
        exit 1
        ;;
esac
