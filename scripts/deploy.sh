#!/bin/bash

# Paper Burner X - 一键部署脚本

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "======================================"
echo "   Paper Burner X - 一键部署脚本"
echo "======================================"
echo -e "${NC}"
echo ""

# 1. 检查 .env 文件
echo -e "${YELLOW}[1/6] 检查配置文件...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}→ 创建 .env 文件${NC}"
    cp .env.example .env
    echo -e "${RED}⚠️  请编辑 .env 文件并配置以下必要项：${NC}"
    echo "   - DB_PASSWORD"
    echo "   - JWT_SECRET"
    echo "   - ADMIN_EMAIL"
    echo "   - ADMIN_PASSWORD"
    echo ""
    read -p "配置完成后按回车继续..."
fi
echo -e "${GREEN}✓ 配置文件检查完成${NC}"
echo ""

# 2. 安装后端依赖
echo -e "${YELLOW}[2/6] 安装后端依赖...${NC}"
cd server
if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}✓ 依赖安装完成${NC}"
else
    echo -e "${GREEN}✓ 依赖已存在${NC}"
fi
cd ..
echo ""

# 3. 生成 Prisma Client
echo -e "${YELLOW}[3/6] 生成 Prisma Client...${NC}"
cd server
npx prisma generate
echo -e "${GREEN}✓ Prisma Client 生成完成${NC}"
cd ..
echo ""

# 4. 启动 Docker 服务
echo -e "${YELLOW}[4/6] 启动 Docker 服务...${NC}"
docker-compose up -d postgres
echo -e "${YELLOW}→ 等待数据库启动...${NC}"
sleep 5
echo -e "${GREEN}✓ 数据库已启动${NC}"
echo ""

# 5. 运行数据库迁移
echo -e "${YELLOW}[5/6] 初始化数据库...${NC}"
cd server
npx prisma migrate deploy
echo -e "${GREEN}✓ 数据库初始化完成${NC}"
cd ..
echo ""

# 6. 启动应用
echo -e "${YELLOW}[6/6] 启动应用服务...${NC}"
docker-compose up -d app
echo -e "${GREEN}✓ 应用已启动${NC}"
echo ""

# 等待应用启动
echo -e "${YELLOW}→ 等待应用启动...${NC}"
sleep 3

# 检查健康状态
echo -e "${YELLOW}→ 检查服务健康状态...${NC}"
for i in {1..10}; do
    if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 服务健康检查通过${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}✗ 服务启动失败，请检查日志：${NC}"
        echo "   docker-compose logs -f app"
        exit 1
    fi
    sleep 2
done

echo ""
echo -e "${GREEN}"
echo "======================================"
echo "   🎉 部署成功！"
echo "======================================"
echo -e "${NC}"
echo ""
echo -e "${BLUE}访问地址：${NC}"
echo -e "  主应用:    ${GREEN}http://localhost:3000${NC}"
echo -e "  管理面板:  ${GREEN}http://localhost:3000/admin${NC}"
echo -e "  API健康:   ${GREEN}http://localhost:3000/api/health${NC}"
echo ""
echo -e "${BLUE}管理员账户：${NC}"
echo -e "  邮箱: $(grep ADMIN_EMAIL .env | cut -d '=' -f2)"
echo -e "  密码: $(grep ADMIN_PASSWORD .env | cut -d '=' -f2)"
echo ""
echo -e "${BLUE}常用命令：${NC}"
echo "  查看日志:   docker-compose logs -f app"
echo "  停止服务:   docker-compose down"
echo "  重启服务:   docker-compose restart"
echo ""
echo -e "${YELLOW}⚠️  首次登录后请立即修改管理员密码！${NC}"
echo ""
