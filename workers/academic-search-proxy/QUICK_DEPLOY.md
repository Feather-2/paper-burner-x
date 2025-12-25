# 快速部署指南

Academic Search Proxy 提供两种部署方案，适合不同使用场景。

**部署方式：**
- **方式 A：使用 Wrangler CLI**（推荐，快速）
- **方式 B：在 Cloudflare Dashboard 手动部署**（无需命令行）

---

## 📋 方案对比

| 方案 | 适用场景 | API Key 位置 | 认证要求 | 安全性 |
|------|---------|-------------|---------|--------|
| **方案一：透传模式** | 个人使用/分享给他人 | 客户端 | 可选 | ⭐⭐⭐⭐⭐ |
| **方案二：共享密钥模式** | 团队内部/受控环境 | Worker | **必须** | ⭐⭐⭐ |

---

## 🎯 方案一：透传模式（推荐）

**适合：**
- ✅ 个人使用
- ✅ 分享给他人使用（用户自带 API Key）
- ✅ 最安全（你的 Key 不会泄露）

### A. 使用 Wrangler CLI 部署

#### 1. 部署 Worker

```bash
cd workers/academic-search-proxy
npx wrangler deploy
```

记录输出的 URL，例如：
```
https://academic-search-proxy.your-subdomain.workers.dev
```

#### 2. 配置 Worker（透传模式）

编辑 `wrangler.toml`：

```toml
[vars]
# 认证（可选，不强制）
ENABLE_AUTH = "false"

# 允许的来源（根据需要调整）
ALLOWED_ORIGINS = "*"

# 速率限制
RATE_LIMIT_ENABLED = "true"
RATE_LIMIT_TPS = "10"
RATE_LIMIT_TPM = "300"
RATE_LIMIT_PER_IP_TPS = "5"
RATE_LIMIT_PER_IP_TPM = "100"
RATE_LIMIT_PUBMED_TPS = "3"
RATE_LIMIT_SEMANTICSCHOLAR_TPS = "5"
RATE_LIMIT_SEMANTICSCHOLAR_TPM = "20"
```

**不设置任何 Secrets**（不配置 API Key）：
```bash
# 不需要运行这些命令
# npx wrangler secret put SEMANTIC_SCHOLAR_API_KEY  ← 跳过
# npx wrangler secret put PUBMED_API_KEY            ← 跳过
```

重新部署：
```bash
npx wrangler deploy
```

---

### B. 在 Cloudflare Dashboard 手动部署

#### 1. 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**
4. 命名：`academic-search-proxy`
5. 点击 **Deploy**

#### 2. 上传代码

1. 在 Worker 页面，点击 **Edit Code**
2. 删除默认代码
3. 复制 `workers/academic-search-proxy/src/index.js` 的全部内容
4. 粘贴到编辑器
5. 点击 **Save and Deploy**

#### 3. 配置环境变量（透传模式）

在 Worker 页面：

1. 点击 **Settings** 选项卡
2. 滚动到 **Variables** 部分
3. 点击 **Add variable**

**添加以下变量：**

| 变量名 | 类型 | 值 | 说明 |
|-------|------|---|------|
| `ENABLE_AUTH` | Text | `false` | 不启用认证（透传模式） |
| `ALLOWED_ORIGINS` | Text | `*` | 允许所有来源（或填入你的域名） |
| `RATE_LIMIT_ENABLED` | Text | `true` | 启用速率限制 |
| `RATE_LIMIT_TPS` | Text | `10` | 全局每秒请求数 |
| `RATE_LIMIT_TPM` | Text | `300` | 全局每分钟请求数 |
| `RATE_LIMIT_PER_IP_TPS` | Text | `5` | 每IP每秒请求数 |
| `RATE_LIMIT_PER_IP_TPM` | Text | `100` | 每IP每分钟请求数 |
| `RATE_LIMIT_PUBMED_TPS` | Text | `3` | PubMed每秒请求数 |
| `RATE_LIMIT_PUBMED_TPM` | Text | `180` | PubMed每分钟请求数 |
| `RATE_LIMIT_SEMANTICSCHOLAR_TPS` | Text | `5` | S2每秒请求数 |
| `RATE_LIMIT_SEMANTICSCHOLAR_TPM` | Text | `20` | S2每分钟请求数 |

**注意：** 全部选择 **Text** 类型（不是 Secret）

4. 点击 **Save and Deploy**

#### 4. 获取 Worker URL

在 Worker 页面顶部，复制你的 Worker URL：
```
https://academic-search-proxy.your-subdomain.workers.dev
```

#### 5. 测试

访问健康检查端点：
```
https://academic-search-proxy.your-subdomain.workers.dev/health
```

应该返回：
```json
{
  "status": "ok",
  "services": { ... },
  "rateLimit": { "enabled": true, ... }
}
```

#### 3. 客户端配置

**方式 A：通过 UI 配置**（推荐）

在设置界面：
```
代理地址: https://academic-search-proxy.your-subdomain.workers.dev
Semantic Scholar API Key: [用户自己的 Key]
PubMed API Key: [用户自己的 Key]
```

**方式 B：通过 localStorage**

```javascript
localStorage.setItem('academicSearchSettings', JSON.stringify({
    proxyEnabled: true,
    proxyUrl: 'https://academic-search-proxy.your-subdomain.workers.dev',
    proxyAuthKey: null,  // 透传模式不需要
    semanticScholarApiKey: 'your-s2-api-key',  // 用户自己的
    pubmedApiKey: 'your-pubmed-api-key'        // 用户自己的
}));
```

#### 4. 客户端透传实现（已实现）

在 `reference-doi-resolver.js` 中：

```javascript
// Semantic Scholar 查询
const headers = {};
const userApiKey = getUserApiKey('semanticscholar');  // 从设置读取
if (userApiKey) {
    headers['X-Api-Key'] = userApiKey;  // 透传给 Worker
}

const response = await fetch(proxyUrl, { headers });
```

Worker 会自动将客户端的 `X-Api-Key` 转发给上游 API。

---

## 🔐 方案二：共享密钥模式

**适合：**
- ⚠️ 团队内部使用
- ⚠️ 信任的用户群体
- ⚠️ 你愿意分享你的 API Key

**⚠️ 警告：**
- **必须启用认证**（否则任何人都能用你的 Key）
- **必须设置强密码**
- **定期监控用量**

### A. 使用 Wrangler CLI 部署

#### 1. 部署 Worker

```bash
cd workers/academic-search-proxy
npx wrangler deploy
```

#### 2. 配置 Worker（共享密钥模式）

编辑 `wrangler.toml`：

```toml
[vars]
# ⚠️ 必须启用认证
ENABLE_AUTH = "true"

# 限制来源（推荐）
ALLOWED_ORIGINS = "https://yourdomain.com,https://trusted-domain.com"

# 更严格的速率限制（保护你的 API Key）
RATE_LIMIT_ENABLED = "true"
RATE_LIMIT_TPS = "5"               # 降低全局限制
RATE_LIMIT_TPM = "200"
RATE_LIMIT_PER_IP_TPS = "2"        # 每个 IP 更严格
RATE_LIMIT_PER_IP_TPM = "50"
RATE_LIMIT_PUBMED_TPS = "3"
RATE_LIMIT_SEMANTICSCHOLAR_TPS = "3"
RATE_LIMIT_SEMANTICSCHOLAR_TPM = "20"
```

#### 3. 设置 Secrets

```bash
# ⚠️ 必须：设置认证密钥（强密码）
npx wrangler secret put AUTH_SECRET
# 输入：例如 "xK9$mP2#vL8@nR5%qW3^tY7&zH4!"

# 可选：你的 Semantic Scholar API Key
npx wrangler secret put SEMANTIC_SCHOLAR_API_KEY
# 输入：你的 S2 Key

# 可选：你的 PubMed API Key
npx wrangler secret put PUBMED_API_KEY
# 输入：你的 PubMed Key
```

重新部署：
```bash
npx wrangler deploy
```

---

### B. 在 Cloudflare Dashboard 手动部署

#### 1. 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**
4. 命名：`academic-search-proxy`
5. 点击 **Deploy**

#### 2. 上传代码

1. 在 Worker 页面，点击 **Edit Code**
2. 删除默认代码
3. 复制 `workers/academic-search-proxy/src/index.js` 的全部内容
4. 粘贴到编辑器
5. 点击 **Save and Deploy**

#### 3. 配置环境变量（共享密钥模式）

在 Worker 页面：

1. 点击 **Settings** 选项卡
2. 滚动到 **Variables** 部分

**3.1 添加普通变量（Text）：**

点击 **Add variable**，添加以下变量（类型选择 **Text**）：

| 变量名 | 类型 | 值 | 说明 |
|-------|------|---|------|
| `ENABLE_AUTH` | Text | `true` | ⚠️ 必须启用认证 |
| `ALLOWED_ORIGINS` | Text | `https://yourdomain.com` | 限制来源域名 |
| `RATE_LIMIT_ENABLED` | Text | `true` | 启用速率限制 |
| `RATE_LIMIT_TPS` | Text | `5` | 全局每秒请求数（更严格） |
| `RATE_LIMIT_TPM` | Text | `200` | 全局每分钟请求数 |
| `RATE_LIMIT_PER_IP_TPS` | Text | `2` | 每IP每秒请求数（更严格） |
| `RATE_LIMIT_PER_IP_TPM` | Text | `50` | 每IP每分钟请求数 |
| `RATE_LIMIT_PUBMED_TPS` | Text | `3` | PubMed每秒请求数 |
| `RATE_LIMIT_PUBMED_TPM` | Text | `180` | PubMed每分钟请求数 |
| `RATE_LIMIT_SEMANTICSCHOLAR_TPS` | Text | `3` | S2每秒请求数 |
| `RATE_LIMIT_SEMANTICSCHOLAR_TPM` | Text | `20` | S2每分钟请求数 |

**3.2 添加加密变量（Secret）：**

⚠️ **重要：这些是敏感信息，必须使用 Secret 类型！**

点击 **Add variable**，**勾选 "Encrypt"**，添加：

| 变量名 | 类型 | 值 | 说明 |
|-------|------|---|------|
| `AUTH_SECRET` | **Secret** ✅ | `xK9$mP2#vL8@nR5%qW3^tY7&zH4!` | ⚠️ 认证密钥（强密码，至少32字符） |
| `SEMANTIC_SCHOLAR_API_KEY` | **Secret** ✅ | `your-s2-api-key` | （可选）你的 S2 API Key |
| `PUBMED_API_KEY` | **Secret** ✅ | `your-pubmed-api-key` | （可选）你的 PubMed API Key |

**如何添加 Secret：**
1. 点击 **Add variable**
2. 输入变量名（如 `AUTH_SECRET`）
3. **勾选 "Encrypt"** 复选框 ⚠️
4. 输入值（如 `xK9$mP2#vL8@nR5%qW3^tY7&zH4!`）
5. 点击 **Save**

**验证 Secret 已加密：**
- Secret 变量显示为 `••••••••`
- 保存后无法查看原始值

4. 点击 **Save and Deploy**

#### 4. 生成强密码（AUTH_SECRET）

**推荐方法：**

```bash
# Linux/Mac
openssl rand -base64 32

# 或在线生成器
# https://www.random.org/passwords/?num=1&len=32&format=plain
```

示例强密码：
```
xK9$mP2#vL8@nR5%qW3^tY7&zH4!aB6*cD1%
```

#### 5. 测试

访问健康检查（需要带 Auth Key）：

```bash
curl -H "X-Auth-Key: xK9$mP2#vL8@nR5%qW3^tY7&zH4!" \
  https://academic-search-proxy.your-subdomain.workers.dev/health
```

应该返回：
```json
{
  "status": "ok",
  "authentication": { "required": true }
}
```

---

## 📊 环境变量完整列表

### 通用变量（Text 类型）

| 变量名 | 默认值 | 说明 | 方案一 | 方案二 |
|-------|-------|------|-------|-------|
| `ENABLE_AUTH` | `"false"` | 是否启用认证 | `false` | ⚠️ `true` |
| `ALLOWED_ORIGINS` | `"*"` | 允许的来源（CORS） | `"*"` | 特定域名 |
| `RATE_LIMIT_ENABLED` | `"true"` | 启用速率限制 | `true` | `true` |
| `RATE_LIMIT_TPS` | `"10"` | 全局每秒请求数 | `10` | `5` |
| `RATE_LIMIT_TPM` | `"300"` | 全局每分钟请求数 | `300` | `200` |
| `RATE_LIMIT_PER_IP_TPS` | `"5"` | 每IP每秒请求数 | `5` | `2` |
| `RATE_LIMIT_PER_IP_TPM` | `"100"` | 每IP每分钟请求数 | `100` | `50` |
| `RATE_LIMIT_PUBMED_TPS` | `"3"` | PubMed每秒请求数 | `3` | `3` |
| `RATE_LIMIT_PUBMED_TPM` | `"180"` | PubMed每分钟请求数 | `180` | `180` |
| `RATE_LIMIT_SEMANTICSCHOLAR_TPS` | `"5"` | S2每秒请求数 | `5` | `3` |
| `RATE_LIMIT_SEMANTICSCHOLAR_TPM` | `"20"` | S2每分钟请求数 | `20` | `20` |

### 加密变量（Secret 类型）⚠️

| 变量名 | 方案一 | 方案二 | 说明 |
|-------|-------|-------|------|
| `AUTH_SECRET` | 不设置 | ⚠️ **必须设置** | 认证密钥（强密码） |
| `SEMANTIC_SCHOLAR_API_KEY` | 不设置 | 可选 | 你的 S2 API Key |
| `PUBMED_API_KEY` | 不设置 | 可选 | 你的 PubMed API Key |

---

## 🎨 Dashboard 配置截图说明

### 添加 Text 变量

```
Settings → Variables → Add variable
┌─────────────────────────────────┐
│ Variable name                   │
│ ENABLE_AUTH                     │
├─────────────────────────────────┤
│ Value                           │
│ false                           │
├─────────────────────────────────┤
│ □ Encrypt                       │  ← 不勾选
└─────────────────────────────────┘
         [Save]
```

### 添加 Secret 变量

```
Settings → Variables → Add variable
┌─────────────────────────────────┐
│ Variable name                   │
│ AUTH_SECRET                     │
├─────────────────────────────────┤
│ Value                           │
│ xK9$mP2#vL8@nR5%qW3^tY7&zH4!   │
├─────────────────────────────────┤
│ ☑ Encrypt                       │  ← 必须勾选！
└─────────────────────────────────┘
         [Save]
```

保存后显示为：
```
AUTH_SECRET: •••••••• (encrypted)
```

#### 4. 分发给用户

**给用户提供：**
1. Worker URL: `https://academic-search-proxy.your-subdomain.workers.dev`
2. Auth Key: `xK9$mP2#vL8@nR5%qW3^tY7&zH4!` ⚠️（保密分享）

**用户配置：**

```javascript
localStorage.setItem('academicSearchSettings', JSON.stringify({
    proxyEnabled: true,
    proxyUrl: 'https://academic-search-proxy.your-subdomain.workers.dev',
    proxyAuthKey: 'xK9$mP2#vL8@nR5%qW3^tY7&zH4!',  // ⚠️ 你提供的
    // 不需要配置 API Key，Worker 会用你的
}));
```

#### 5. 监控和保护

**定期检查用量：**
```bash
# Cloudflare Dashboard
# Workers & Pages → academic-search-proxy → Analytics
```

**如果发现滥用：**
```bash
# 立即更换认证密钥
npx wrangler secret put AUTH_SECRET
# 输入新密码

# 通知用户新密钥
```

**设置告警：**
- Cloudflare Dashboard → Workers → academic-search-proxy
- 设置请求数告警（如超过 10,000/天）

---

## 📊 两种方案对比详解

### 方案一：透传模式

```
用户浏览器
  ├─ 用户的 S2 Key
  └─ 用户的 PubMed Key
         ↓ (通过 X-Api-Key 头)
     你的 Worker (无 Key)
         ↓ (转发 X-Api-Key)
  Semantic Scholar / PubMed
```

**优点：**
- ✅ 你的 Key 不会泄露
- ✅ 每个用户用自己的限额
- ✅ 无需担心滥用
- ✅ 可以公开分享

**缺点：**
- ⚠️ 用户需要自己申请 API Key

---

### 方案二：共享密钥模式

```
用户浏览器
  └─ Auth Key (xK9$mP2#...)
         ↓
     你的 Worker
       ├─ 你的 S2 Key (在 Worker 中)
       └─ 你的 PubMed Key (在 Worker 中)
         ↓
  Semantic Scholar / PubMed
```

**优点：**
- ✅ 用户无需申请 Key
- ✅ 即开即用

**缺点：**
- ⚠️ 所有人共享你的 Key 限额
- ⚠️ 必须启用认证
- ⚠️ Auth Key 泄露 = 你的 API Key 被滥用
- ⚠️ 需要监控用量

---

## 🎯 选择建议

| 场景 | 推荐方案 |
|------|---------|
| 个人使用 | **方案一** |
| 开源项目 | **方案一** |
| 公开分享 | **方案一** |
| 小团队（< 5人） | 方案二（谨慎） |
| 大团队 | **方案一** |
| 商业产品 | **方案一** |

**默认推荐：方案一（透传模式）** ✅

---

## ⚡ 一键部署脚本

### 方案一（透传模式）

```bash
# 1. 进入目录
cd workers/academic-search-proxy

# 2. 确认配置（wrangler.toml）
cat wrangler.toml

# 3. 部署
npx wrangler deploy

# 4. 测试
curl https://your-worker.workers.dev/health

# 完成！分享 Worker URL 给用户
```

### 方案二（共享密钥模式）

```bash
# 1. 进入目录
cd workers/academic-search-proxy

# 2. 修改配置
# 编辑 wrangler.toml，设置 ENABLE_AUTH = "true"

# 3. 设置密钥
npx wrangler secret put AUTH_SECRET
# 输入强密码（至少 32 字符）

# 可选：添加你的 API Keys
npx wrangler secret put SEMANTIC_SCHOLAR_API_KEY
npx wrangler secret put PUBMED_API_KEY

# 4. 部署
npx wrangler deploy

# 5. 测试
curl https://your-worker.workers.dev/health

# 6. 分发给用户
echo "Worker URL: https://your-worker.workers.dev"
echo "Auth Key: [你设置的密码]"
```

---

## 🔧 故障排查

### Worker 健康检查失败

```bash
# 检查部署状态
npx wrangler deployments list

# 查看日志
npx wrangler tail

# 重新部署
npx wrangler deploy
```

### 认证失败（方案二）

```bash
# 检查 Secret 是否设置
npx wrangler secret list

# 重新设置
npx wrangler secret put AUTH_SECRET
```

### 速率限制触发

```toml
# 编辑 wrangler.toml，调高限制
RATE_LIMIT_TPS = "20"
RATE_LIMIT_TPM = "600"
```

```bash
# 重新部署
npx wrangler deploy
```

---

## 📚 更多资源

- [完整文档](./README.md)
- [详细部署指南](./DEPLOY.md)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)

## 💡 最佳实践

1. **优先使用方案一**（透传模式）
2. **定期检查 Worker 使用量**
3. **设置合理的速率限制**
4. **方案二必须启用认证**
5. **定期轮换 Auth Key**（方案二）
6. **监控 Cloudflare Dashboard**
