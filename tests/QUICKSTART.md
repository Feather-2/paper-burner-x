# Paper Burner X - 快速开始指南

## 🚀 快速部署

### 前置要求

- Docker 和 Docker Compose
- 或者 Node.js 20+ 和 PostgreSQL 16+

---

## 方式一：使用 Docker Compose（推荐）

### 1. 克隆或下载项目

```bash
git clone https://github.com/your-repo/paper-burner-x.git
cd paper-burner-x
```

### 2. 配置环境变量

复制示例配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，**务必修改以下关键配置**：

```bash
# 数据库密码（必改）
DB_PASSWORD=your_secure_password_here

# JWT 密钥（必改，至少32字符）
JWT_SECRET=your_super_secret_jwt_key_min_32_chars

# API Keys 加密密钥（必改，至少32字符）
ENCRYPTION_SECRET=your_encryption_secret_min_32_chars

# 管理员账户（首次启动使用）
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=your_admin_password
```

**生成安全密钥的方法：**

```bash
# Linux/Mac
openssl rand -base64 32

# 或使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

### 3. 启动服务

```bash
docker-compose up -d
```

首次启动会自动：
- 拉取 PostgreSQL 和应用镜像
- 创建数据库
- 运行数据库迁移
- 创建管理员账户

### 4. 验证部署

访问：
- 应用主页：http://localhost:3000
- 管理面板：http://localhost:3000/admin
- API 健康检查：http://localhost:3000/api/health

### 5. 登录管理员账户

使用 `.env` 中配置的管理员邮箱和密码登录管理面板。

**⚠️ 重要：首次登录后请立即修改管理员密码！**

---

## 方式二：本地开发部署

### 1. 安装依赖

```bash
# 安装前端依赖（如有）
npm install

# 安装后端依赖
cd server
npm install
```

### 2. 启动 PostgreSQL

```bash
# 使用 Docker 启动 PostgreSQL
docker run -d \
  --name paperburner-db \
  -e POSTGRES_USER=paperburner \
  -e POSTGRES_PASSWORD=changeme \
  -e POSTGRES_DB=paperburner \
  -p 5432:5432 \
  postgres:16-alpine

# 或使用本地 PostgreSQL 并创建数据库
createdb paperburner
```

### 3. 配置环境变量

```bash
cd server
cp ../.env.example ../.env
# 编辑 .env 文件
```

### 4. 运行数据库迁移

```bash
cd server
npx prisma generate
npx prisma migrate deploy
```

### 5. 启动后端服务

```bash
cd server
npm start
```

### 6. 访问应用

http://localhost:3000

---

## 📊 管理员功能

### 登录管理面板

访问 `/admin` 并使用管理员账户登录。

### 主要功能

1. **用户管理**
   - 查看所有用户
   - 启用/禁用用户账户
   - 查看用户详细信息

2. **系统统计**
   - 总用户数、活跃用户
   - 文档处理量
   - 存储使用情况

3. **配额管理**
   - 设置用户文档数量限制
   - 设置存储空间限制
   - 查看当前使用量

4. **系统配置**
   - 全局设置
   - 自定义模型源站管理

---

## 👤 用户注册和使用

### 注册账户

如果允许用户注册（默认允许），用户可以：

1. 访问主页
2. 点击"注册"
3. 填写邮箱、密码、姓名
4. 提交注册

### 配置 API Keys

登录后：

1. 进入设置页面
2. 添加翻译服务的 API Keys（如 DeepSeek、Gemini、Claude 等）
3. 配置 OCR 服务 API Keys（MinerU 或 Doc2X）

**注意：所有 API Keys 都会自动加密存储，确保安全。**

### 上传和处理文档

1. 上传 PDF 文件
2. 选择 OCR 服务和翻译模型
3. 开始处理
4. 查看结果、下载译文

### 查看历史记录

在历史记录页面可以：
- 查看所有处理过的文档
- 重新查看翻译结果
- 添加标注和高亮
- 导出为 DOCX、Markdown 等格式

---

## 🔧 高级配置

### Nginx 反向代理（生产环境）

如需使用 Nginx，取消注释 `docker-compose.yml` 中的 nginx 服务：

```yaml
services:
  nginx:
    # ... nginx 配置
    profiles:
      - production
```

然后使用：

```bash
docker-compose --profile production up -d
```

### 自定义端口

在 `.env` 中修改：

```bash
APP_PORT=8080  # 应用端口
DB_PORT=5433   # 数据库端口
NGINX_PORT=80  # Nginx 端口
```

### CORS 配置

如果前后端分离部署，配置允许的域名：

```bash
CORS_ORIGIN=https://yourdomain.com,https://app.yourdomain.com
```

### 文件上传大小限制

```bash
MAX_UPLOAD_SIZE=100  # MB
```

---

## 🛠️ 常见问题

### 1. 数据库连接失败

**问题**: `Error: connect ECONNREFUSED`

**解决**:
- 检查 PostgreSQL 是否运行
- 检查 `DATABASE_URL` 配置是否正确
- 确认数据库端口没有被占用

### 2. 管理员账户未创建

**问题**: 无法登录管理面板

**解决**:
```bash
# 查看容器日志
docker-compose logs app

# 应该看到：
# ✓ Admin account created successfully
# Email: admin@paperburner.local
# Password: admin123456

# 如果未创建，手动创建：
docker-compose exec app node -e "require('./server/src/utils/initAdmin.js').initializeAdmin()"
```

### 3. 数据库迁移失败

**问题**: Prisma 迁移错误

**解决**:
```bash
# 重置数据库（开发环境）
docker-compose exec app npx prisma migrate reset

# 生产环境
docker-compose exec app npx prisma migrate deploy
```

### 4. API Keys 加密错误

**问题**: 解密失败

**解决**:
- 确保 `ENCRYPTION_SECRET` 没有改变
- 如果更换了密钥，需要重新添加所有 API Keys

### 5. 配额检查不生效

**问题**: 用户超出配额仍可创建文档

**解决**:
- 检查用户是否有配额设置：`GET /api/admin/users/:userId/quota`
- 设置配额：`PUT /api/admin/users/:userId/quota`

---

## 📝 数据备份

### 备份数据库

```bash
# 使用 Docker
docker-compose exec postgres pg_dump -U paperburner paperburner > backup.sql

# 或使用 pg_dump
pg_dump -U paperburner -h localhost -p 5432 paperburner > backup.sql
```

### 恢复数据库

```bash
# 使用 Docker
docker-compose exec -T postgres psql -U paperburner paperburner < backup.sql

# 或使用 psql
psql -U paperburner -h localhost -p 5432 paperburner < backup.sql
```

### 备份上传文件

```bash
# 备份 Docker Volume
docker run --rm \
  -v paperburner_app_uploads:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/uploads-backup.tar.gz -C /data .
```

---

## 🔐 安全建议

### 生产环境部署清单

- [ ] 修改所有默认密码
- [ ] 使用强随机密钥（JWT_SECRET、ENCRYPTION_SECRET）
- [ ] 配置 HTTPS（使用 Nginx + Let's Encrypt）
- [ ] 设置防火墙规则
- [ ] 定期备份数据库
- [ ] 监控系统日志
- [ ] 启用访问日志
- [ ] 限制管理员 IP 范围（可选）
- [ ] 配置邮件通知（可选）

### HTTPS 配置示例

在 `docker/nginx.conf` 中配置 SSL：

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 📚 下一步

- 阅读 [BACKEND_IMPROVEMENTS.md](BACKEND_IMPROVEMENTS.md) 了解详细功能
- 查看 [API_REFERENCE.md](API_REFERENCE.md) 学习 API 使用
- 参考 [schema.prisma](server/prisma/schema.prisma) 了解数据模型

---

## 💬 获取帮助

- GitHub Issues: https://github.com/your-repo/paper-burner-x/issues
- 文档: https://docs.yourproject.com
- Email: support@yourproject.com

---

**祝使用愉快！🎉**
