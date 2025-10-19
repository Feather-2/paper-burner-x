# 本地测试指南 - 推送前验证

## ✅ Vercel 配置检查（已通过）

### 检查结果：
- ✅ `.vercelignore` 正确配置，会忽略所有后端文件
- ✅ `vercel.json` 配置正确
- ✅ 前端文件完整：index.html, js/, css/, public/, views/
- ✅ 后端文件会被忽略：server/, docker/, scripts/

**结论：Vercel 部署安全，不会上传后端代码**

---

## 🧪 本地测试步骤

### 测试 1：前端模式（模拟 Vercel）

```bash
# 启动简单的 HTTP 服务器
python -m http.server 8000

# 或使用 Node.js
npx http-server -p 8000

# 访问 http://localhost:8000
```

**测试项**：
- [ ] 页面正常加载
- [ ] 可以打开文件选择
- [ ] localStorage 正常工作
- [ ] 所有现有功能正常
- [ ] 控制台无错误

---

### 测试 2：Docker 后端模式

#### 2.1 检查 Docker 环境
```bash
docker --version
docker-compose --version
```

#### 2.2 配置环境变量
```bash
cp .env.example .env
nano .env
```

**最小配置**：
```env
DB_PASSWORD=test123456
JWT_SECRET=test-jwt-secret-minimum-32-characters-long
ADMIN_EMAIL=admin@test.local
ADMIN_PASSWORD=admin123456
```

#### 2.3 启动 Docker
```bash
# 方式 1: 使用部署脚本
cd scripts
./deploy.sh

# 方式 2: 手动启动
docker-compose up -d

# 查看日志
docker-compose logs -f app
```

#### 2.4 验证服务
```bash
# 健康检查
curl http://localhost:3000/api/health

# 访问前端
open http://localhost:3000

# 访问管理面板
open http://localhost:3000/admin
```

**测试项**：
- [ ] 所有容器正常运行
- [ ] 数据库连接成功
- [ ] API 健康检查通过
- [ ] 前端页面正常加载
- [ ] 可以注册用户
- [ ] 可以登录管理面板
- [ ] 数据保存到数据库

#### 2.5 清理
```bash
# 停止服务
docker-compose down

# 完全清理（包括数据）
docker-compose down -v
```

---

## 🔍 关键验证点

### 验证 1：Vercel 不会受影响

**测试方法**：模拟 Vercel 只部署前端文件
```bash
# 创建临时目录，只复制前端文件
mkdir /tmp/vercel-test
cp index.html /tmp/vercel-test/
cp -r js css public views /tmp/vercel-test/
cd /tmp/vercel-test

# 启动测试
python -m http.server 8001
# 访问 http://localhost:8001

# 应该完全正常工作
```

### 验证 2：admin/ 目录是否需要

**检查**：
```bash
# admin/ 是否在 .vercelignore 中？
grep admin .vercelignore
```

**结果**：`admin/` 没有被忽略，会部署到 Vercel

**确认**：这是对的，因为管理面板的 HTML 也可以在前端模式下查看（只是没有后端 API）

### 验证 3：存储适配器是否正确引入

```bash
# 检查 index.html
grep storage-adapter.js index.html
```

**预期输出**：
```html
<script src="js/storage/storage-adapter.js"></script>
```

**测试**：
1. 打开浏览器控制台
2. 检查 `window.storageAdapter` 是否存在
3. 检查 `window.DEPLOYMENT_MODE` 的值

---

## 🎯 快速测试脚本

### 一键测试脚本

```bash
#!/bin/bash

echo "=================================="
echo "   Paper Burner X 本地测试"
echo "=================================="
echo ""

# 测试 1: 前端模式
echo "测试 1: 前端模式（模拟 Vercel）"
echo "启动 HTTP 服务器..."
python -m http.server 8000 &
SERVER_PID=$!
sleep 2

echo "→ 测试页面访问"
if curl -s http://localhost:8000 > /dev/null; then
    echo "✅ 前端服务器启动成功"
else
    echo "❌ 前端服务器启动失败"
fi

echo "→ 打开浏览器手动测试"
echo "   访问: http://localhost:8000"
read -p "前端测试完成后按回车继续..."

kill $SERVER_PID
echo ""

# 测试 2: Docker 模式
echo "测试 2: Docker 模式"
echo "→ 检查 Docker 环境"
if command -v docker &> /dev/null; then
    echo "✅ Docker 已安装"
else
    echo "❌ Docker 未安装，跳过 Docker 测试"
    exit 0
fi

echo "→ 检查 .env 配置"
if [ ! -f ".env" ]; then
    echo "⚠️  .env 不存在，创建默认配置"
    cp .env.example .env
fi

read -p "是否启动 Docker 测试？(y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "→ 启动 Docker 服务"
    docker-compose up -d

    echo "→ 等待服务启动..."
    sleep 10

    echo "→ 测试 API"
    if curl -s http://localhost:3000/api/health > /dev/null; then
        echo "✅ Docker 服务启动成功"
        echo "   访问: http://localhost:3000"
        echo "   管理: http://localhost:3000/admin"
    else
        echo "❌ Docker 服务启动失败"
        docker-compose logs app
    fi

    read -p "Docker 测试完成后按回车清理..."
    docker-compose down
fi

echo ""
echo "=================================="
echo "   测试完成！"
echo "=================================="
```

---

## ✅ 测试通过标准

### 前端模式（Vercel）
- [ ] 页面正常加载
- [ ] 功能完全正常
- [ ] 无 JavaScript 错误
- [ ] localStorage 工作正常

### Docker 模式
- [ ] 所有容器运行正常
- [ ] API 响应正常
- [ ] 可以注册/登录
- [ ] 数据持久化工作

### 无冲突验证
- [ ] 前端代码未被破坏
- [ ] 旧功能全部正常
- [ ] 没有引入 breaking changes

---

## 🚀 测试通过后

如果所有测试都通过，你可以安全地：

```bash
git add .
git commit -m "feat: add Docker support with full backend"
git push origin main
```

**推送后监控**：
1. 立即检查 Vercel 部署状态
2. 访问部署后的 URL
3. 测试主要功能
4. 如有问题立即 revert

---

## 🆘 如果测试失败

### 前端测试失败
```bash
# 检查是否有文件缺失
git status

# 恢复特定文件
git restore <file>

# 查看具体错误
浏览器控制台
```

### Docker 测试失败
```bash
# 查看日志
docker-compose logs -f app

# 检查数据库
docker-compose logs postgres

# 重新构建
docker-compose down -v
docker-compose up --build
```

---

## 📞 现在做什么？

选择一个：

**A) 运行快速前端测试（5 分钟）**
```bash
python -m http.server 8000
# 手动测试功能
```

**B) 运行完整测试（包括 Docker，15 分钟）**
```bash
# 我帮你创建测试脚本
```

**C) 我相信配置没问题，直接推送**
```bash
git add .
git commit -m "feat: add Docker support"
git push origin main
```

你选哪个？
