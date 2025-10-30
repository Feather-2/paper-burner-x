# 环境变量配置指南

本文档说明 Paper Burner X 项目的环境变量配置要求。

## 快速开始

### 开发环境（开箱即用）

开发环境可以使用默认值，系统会自动生成安全的开发密钥并给出警告提示：

```bash
# 无需配置即可运行（会有警告提示）
npm run dev
```

### 生产环境（必须配置）

生产环境必须设置以下关键安全变量：

```bash
# 必需的环境变量
NODE_ENV=production
JWT_SECRET=<生成强随机字符串>
ENCRYPTION_SALT=<生成强随机字符串>
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com

# 推荐配置
FILE_VALIDATION_STRICT=true
DATABASE_URL=postgresql://...
```

## 环境变量说明

### 🔴 必需配置（生产环境）

| 变量名 | 说明 | 示例 | 开发环境 | 生产环境 |
|--------|------|------|----------|----------|
| `NODE_ENV` | 环境模式 | `production` | 可选 | **必需** |
| `JWT_SECRET` | JWT 签名密钥 | 随机字符串 | 自动生成 | **必需** |
| `ENCRYPTION_SALT` | 加密 salt | 随机字符串 | 使用默认值 | **必需** |

### 🟡 部署配置

| 变量名 | 说明 | 示例 | 默认值 |
|--------|------|------|--------|
| `DEPLOYMENT_MODE` | 部署模式 | `frontend` / `backend` | `frontend` |
| `CORS_ORIGIN` | CORS 允许的源 | `https://example.com` | 开发环境允许所有源 |
| `PORT` | 服务器端口 | `3000` | `3000` |

### 🟢 安全配置

| 变量名 | 说明 | 示例 | 默认值 |
|--------|------|------|--------|
| `DISABLE_CSP` | 是否禁用 CSP | `true` / `false` | `false` |
| `CSP_ALLOW_INLINE` | 是否允许内联脚本 | `true` / `false` | 前端模式自动启用 |
| `FILE_VALIDATION_STRICT` | 文件类型验证严格模式 | `true` / `false` | `false` |
| `ALLOWED_MIME_TYPES` | 允许的文件类型 | `application/pdf,text/markdown` | 内置白名单 |
| `MAX_UPLOAD_SIZE` | 最大文件大小（MB） | `100` | `100` |

### 🔵 数据库配置

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `DATABASE_URL` | Prisma 数据库连接 URL | `postgresql://user:pass@localhost:5432/db` |

### 🟣 JWT 配置

| 变量名 | 说明 | 示例 | 默认值 |
|--------|------|------|--------|
| `JWT_EXPIRES_IN` | JWT 过期时间 | `7d` | `7d` |

## 生成安全密钥

### 使用 OpenSSL

```bash
# 生成 JWT_SECRET（32 字节 Base64）
openssl rand -base64 32

# 生成 ENCRYPTION_SALT（32 字节 Base64）
openssl rand -base64 32
```

### 使用 Node.js

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 配置示例

### .env（开发环境）

```bash
NODE_ENV=development
DEPLOYMENT_MODE=frontend
# JWT_SECRET 和 ENCRYPTION_SALT 可以不设置，系统会自动生成
```

### .env（生产环境）

```bash
NODE_ENV=production
JWT_SECRET=<生成的强随机字符串>
ENCRYPTION_SALT=<生成的强随机字符串>
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
FILE_VALIDATION_STRICT=true
DATABASE_URL=postgresql://user:password@localhost:5432/paperburner
```

## 安全提示

1. **永远不要将 `.env` 文件提交到 Git**
2. **生产环境必须设置所有安全相关变量**
3. **定期轮换密钥**（会影响现有用户登录，需要配合迁移策略）
4. **使用强随机字符串作为密钥**（至少 32 字节）
5. **限制 CORS_ORIGIN 为实际需要的域名**

## 迁移注意事项

⚠️ **重要**：更改 `ENCRYPTION_SALT` 会导致已加密的数据无法解密。如需更改 salt，需要：

1. 先解密所有数据
2. 更改 salt
3. 重新加密数据

因此，建议在生产环境部署前就设置好 `ENCRYPTION_SALT`。

