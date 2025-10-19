# Paper Burner X 部署指南

本指南介绍如何部署 Paper Burner X 的 Docker 版本（包含后端和数据库）。

---

## 📋 目录

1. [快速开始](#快速开始)
2. [环境变量配置](#环境变量配置)
3. [部署方式](#部署方式)
4. [常见问题](#常见问题)

---

## 🚀 快速开始

### 前置要求

- Docker 和 Docker Compose 已安装
- Git 已安装（用于克隆仓库）

### 快速部署步骤

```bash
# 1. 克隆仓库
git clone https://github.com/Feather-2/paper-burner-x.git
cd paper-burner-x

# 2. 复制环境变量模板
cp .env.example .env

# 3. 编辑环境变量（重要！）
nano .env  # 或使用其他编辑器

# 4. 启动服务
docker-compose up -d

# 5. 查看日志
docker-compose logs -f
```

---

## 🔧 环境变量配置

### 第一步：复制模板文件

```bash
cp .env.example .env
```

### 第二步：编辑 `.env` 文件

打开 `.env` 文件并修改以下**必须配置**的项目：

#### ⚠️ 必须修改的配置

```bash
# 1. 数据库密码（强烈建议修改）
DB_PASSWORD=你的超强密码123!@#

# 2. JWT 密钥（必须修改，至少 32 个字符）
JWT_SECRET=你的超级安全密钥-至少32个字符-请使用随机字符串

# 3. 管理员账户（首次启动时创建）
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=你的管理员密码
ADMIN_NAME=管理员
```

#### 🔑 生成安全密钥的方法

**方法 1：使用 OpenSSL（推荐）**
```bash
# 生成 JWT 密钥
openssl rand -base64 32

# 生成数据库密码
openssl rand -base64 24
```

**方法 2：使用 Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**方法 3：在线生成器**
访问 https://randomkeygen.com/ 生成强密码

#### 📝 可选配置

```bash
# OCR 服务（如果需要 OCR 功能）
MINERU_API_TOKEN=your_mineru_token
DOC2X_API_TOKEN=your_doc2x_token

# AI 翻译模型（如果需要后端提供 API keys）
DEEPSEEK_API_KEY=your_deepseek_key
GEMINI_API_KEY=your_gemini_key
CLAUDE_API_KEY=your_claude_key
TONGYI_API_KEY=your_tongyi_key
VOLCANO_API_KEY=your_volcano_key

# CORS 配置（如果需要限制访问域名）
CORS_ORIGIN=https://yourdomain.com,https://app.yourdomain.com

# 其他配置
MAX_UPLOAD_SIZE=100  # 文件上传大小限制（MB）
LOG_LEVEL=info       # 日志级别
```

### 第三步：验证配置

检查你的 `.env` 文件是否包含所有必要的配置：

```bash
# 检查关键配置是否存在
grep -E "DB_PASSWORD|JWT_SECRET|ADMIN_EMAIL|ADMIN_PASSWORD" .env
```

---

## 🐳 部署方式

### 方式 1：使用 Docker Compose（推荐）

**启动服务：**
```bash
docker-compose up -d
```

**查看日志：**
```bash
docker-compose logs -f
```

**停止服务：**
```bash
docker-compose down
```

**重启服务：**
```bash
docker-compose restart
```

**查看运行状态：**
```bash
docker-compose ps
```

### 方式 2：使用一键部署脚本

**Linux/Mac：**
```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

**Windows (PowerShell)：**
```powershell
.\scripts\deploy.ps1
```

### 方式 3：从 Docker Hub 拉取镜像

```bash
# 拉取最新镜像
docker pull feather2dev/paper-burner-x:latest

# 手动运行（需要先启动 PostgreSQL）
docker run -d \
  --name paper-burner-x \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/dbname" \
  -e JWT_SECRET="your-secret-key" \
  -e ADMIN_EMAIL="admin@example.com" \
  -e ADMIN_PASSWORD="admin-password" \
  feather2dev/paper-burner-x:latest
```

---

## 🔍 验证部署

### 1. 检查服务状态

```bash
# 检查容器是否运行
docker-compose ps

# 应该看到两个服务都是 "Up" 状态：
# - paper-burner-x_app
# - paper-burner-x_postgres
```

### 2. 访问服务

- **前端界面**: http://localhost:3000
- **管理面板**: http://localhost:3000/admin
- **API 健康检查**: http://localhost:3000/api/health

### 3. 测试管理员登录

1. 访问 http://localhost:3000/admin
2. 使用 `.env` 中配置的管理员邮箱和密码登录
3. 如果登录成功，说明后端和数据库都正常工作

---

## 🔄 更新部署

### 从 Git 仓库更新

```bash
# 1. 停止服务
docker-compose down

# 2. 拉取最新代码
git pull origin main

# 3. 重新构建镜像
docker-compose build --no-cache

# 4. 启动服务
docker-compose up -d
```

### 从 Docker Hub 更新

```bash
# 1. 停止服务
docker-compose down

# 2. 拉取最新镜像
docker-compose pull

# 3. 启动服务
docker-compose up -d
```

---

## 📊 数据管理

### 数据库备份

```bash
# 备份数据库
docker-compose exec postgres pg_dump -U paperburner paperburner > backup_$(date +%Y%m%d).sql

# 或使用 Docker 卷备份
docker run --rm \
  -v paper-burner-x_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/postgres_data_backup.tar.gz /data
```

### 数据库恢复

```bash
# 从 SQL 文件恢复
docker-compose exec -T postgres psql -U paperburner paperburner < backup_20250115.sql
```

### 查看数据库

```bash
# 进入数据库容器
docker-compose exec postgres psql -U paperburner -d paperburner

# 常用 SQL 命令
\dt              # 列出所有表
\d User          # 查看 User 表结构
SELECT * FROM "User" LIMIT 5;  # 查看用户数据
```

---

## 🐛 常见问题

### 1. 数据库连接失败

**错误信息：**
```
Error: Environment variable not found: DATABASE_URL
```

**解决方法：**
- 检查 `.env` 文件是否存在
- 检查 `docker-compose.yml` 是否正确引用了 `.env`
- 确保 PostgreSQL 容器已启动：`docker-compose ps`

### 2. 管理员账户无法登录

**可能原因：**
- 首次启动时 `.env` 中的管理员配置不正确
- 数据库中管理员账户未创建

**解决方法：**
```bash
# 查看容器日志，确认管理员是否创建成功
docker-compose logs app | grep -i admin

# 重新创建管理员账户
docker-compose exec app node server/src/utils/initAdmin.js
```

### 3. 端口冲突

**错误信息：**
```
Error: port is already allocated
```

**解决方法：**
修改 `docker-compose.yml` 中的端口映射：
```yaml
ports:
  - "3001:3000"  # 改为 3001 或其他可用端口
```

### 4. 容器启动后立即退出

**排查步骤：**
```bash
# 1. 查看详细日志
docker-compose logs

# 2. 检查环境变量
docker-compose config

# 3. 重新构建
docker-compose build --no-cache
docker-compose up
```

### 5. OpenSSL 兼容性问题（已修复）

如果你使用旧版本的代码遇到以下错误：
```
Error loading shared library libssl.so.1.1
```

**解决方法：**
拉取最新代码，已修复此问题（使用 OpenSSL 3.x）

---

## 🔒 生产环境安全建议

### 1. 使用 HTTPS

使用 Nginx 或 Traefik 作为反向代理，配置 SSL 证书：

```bash
# 在 docker-compose.yml 中启用 Nginx 服务
# 取消注释 nginx 服务部分
```

### 2. 修改默认密码

- ✅ 修改 `DB_PASSWORD`
- ✅ 修改 `JWT_SECRET`（至少 32 个字符）
- ✅ 修改 `ADMIN_PASSWORD`

### 3. 限制 CORS

```bash
# 在 .env 中设置允许的域名
CORS_ORIGIN=https://yourdomain.com
```

### 4. 启用防火墙

```bash
# 只允许特定端口访问
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 3000/tcp  # 禁止直接访问应用端口
```

### 5. 定期备份

设置定时任务自动备份数据库：
```bash
# 添加到 crontab
0 2 * * * /path/to/backup-script.sh
```

---

## 📚 相关文档

- [README.md](./README.md) - 项目介绍
- [LOCAL_TESTING.md](./LOCAL_TESTING.md) - 本地测试指南
- [docker-compose.yml](./docker-compose.yml) - Docker Compose 配置
- [Dockerfile](./Dockerfile) - Docker 镜像构建配置

---

## 💡 需要帮助？

- 📖 查看文档：[GitHub Wiki](https://github.com/Feather-2/paper-burner-x/wiki)
- 🐛 报告问题：[GitHub Issues](https://github.com/Feather-2/paper-burner-x/issues)
- 💬 讨论交流：[GitHub Discussions](https://github.com/Feather-2/paper-burner-x/discussions)

---

**祝部署顺利！🎉**
