# 部署指南 - Academic Search Proxy

## 前置要求

1. **Cloudflare 账号**
   - 注册地址：https://dash.cloudflare.com/sign-up
   - Workers 免费套餐：100,000 请求/天

2. **Wrangler CLI**
   ```bash
   npm install -g wrangler

   # 登录
   wrangler login
   ```

## 部署步骤

### 1. 本地测试

```bash
cd workers/academic-search-proxy

# 本地开发模式
npx wrangler dev

# 测试健康检查
curl http://localhost:8787/health
```

### 2. 首次部署

```bash
# 部署到 Cloudflare
npx wrangler deploy

# 输出示例：
# ✨ Published academic-search-proxy
# https://academic-search-proxy.your-subdomain.workers.dev
```

### 3. 配置环境变量

#### 3.1 公开变量（wrangler.toml）

编辑 `wrangler.toml`：

```toml
[vars]
ENABLE_AUTH = "false"  # 改为 "true" 启用认证
ALLOWED_ORIGINS = "http://localhost:8080,https://yourdomain.com"
```

重新部署：
```bash
npx wrangler deploy
```

#### 3.2 密钥变量（Secrets）

```bash
# Semantic Scholar API Key（可选）
# 获取：https://www.semanticscholar.org/product/api
npx wrangler secret put SEMANTIC_SCHOLAR_API_KEY
# 输入你的 API Key 并回车

# PubMed API Key（可选）
# 获取：https://www.ncbi.nlm.nih.gov/account/settings/
npx wrangler secret put PUBMED_API_KEY

# 认证密钥（如果 ENABLE_AUTH = "true"）
npx wrangler secret put AUTH_SECRET
# 输入一个强密码，客户端需要使用这个密钥
```

### 4. 自定义域名（可选）

#### 4.1 通过 Cloudflare Dashboard

1. 进入 Dashboard：https://dash.cloudflare.com
2. 选择你的 Worker：`academic-search-proxy`
3. 点击 **Triggers** → **Custom Domains**
4. 添加域名，如：`academic-search.yourdomain.com`

#### 4.2 通过 wrangler.toml

```toml
[[routes]]
pattern = "academic-search.yourdomain.com/*"
zone_name = "yourdomain.com"
```

```bash
npx wrangler deploy
```

## 客户端配置

### 修改前端代码

找到 `js/processing/reference-doi-resolver.js`，添加代理配置：

```javascript
// 在文件顶部添加
const ACADEMIC_PROXY = {
    enabled: true,  // 是否启用代理
    baseUrl: 'https://academic-search-proxy.your-subdomain.workers.dev',
    authKey: null  // 如果启用了认证，填入 AUTH_SECRET
};
```

修改各个 Resolver 的请求 URL（示例见下方）。

## 验证部署

### 1. 健康检查

```bash
curl https://your-worker.workers.dev/health
```

预期输出：
```json
{
  "status": "ok",
  "timestamp": 1234567890,
  "services": {
    "semanticscholar": { "enabled": true, "hasApiKey": false },
    "pubmed": { "enabled": true, "hasApiKey": false },
    "crossref": { "enabled": true },
    "openalex": { "enabled": true },
    "arxiv": { "enabled": true }
  },
  "authentication": {
    "required": false
  }
}
```

### 2. 测试各个服务

```bash
# Semantic Scholar
curl "https://your-worker.workers.dev/api/semanticscholar/graph/v1/paper/search?query=test&limit=1"

# PubMed
curl "https://your-worker.workers.dev/api/pubmed/esearch.fcgi?db=pubmed&term=cancer&retmode=json&retmax=1"

# CrossRef
curl "https://your-worker.workers.dev/api/crossref/works?query.title=test&rows=1"

# OpenAlex
curl "https://your-worker.workers.dev/api/openalex/works?search=test"

# arXiv
curl "https://your-worker.workers.dev/api/arxiv/query?search_query=ti:test&max_results=1"
```

## 更新部署

修改代码后重新部署：

```bash
npx wrangler deploy
```

查看部署历史和回滚：

```bash
# 查看部署历史
npx wrangler deployments list

# 回滚到上一个版本
npx wrangler rollback
```

## 监控和日志

### 实时日志

```bash
npx wrangler tail
```

### Cloudflare Dashboard

1. 进入：https://dash.cloudflare.com
2. Workers & Pages → `academic-search-proxy`
3. 查看：
   - 请求统计
   - 错误率
   - CPU 时间
   - 带宽使用

## 安全配置

### 生产环境建议

1. **启用认证**
   ```toml
   [vars]
   ENABLE_AUTH = "true"
   ```

2. **限制来源**
   ```toml
   [vars]
   ALLOWED_ORIGINS = "https://yourdomain.com,https://app.yourdomain.com"
   ```

3. **设置强密钥**
   ```bash
   # 生成随机密钥
   openssl rand -base64 32

   # 设置为 AUTH_SECRET
   npx wrangler secret put AUTH_SECRET
   ```

4. **添加速率限制**（需要付费计划）
   - 在 Cloudflare Dashboard 设置 Rate Limiting 规则

## 故障排查

### 部署失败

```bash
# 检查配置
npx wrangler whoami

# 重新登录
npx wrangler login

# 清理缓存
rm -rf node_modules .wrangler
npx wrangler deploy
```

### CORS 错误

确认 `ALLOWED_ORIGINS` 包含你的域名：
```toml
[vars]
ALLOWED_ORIGINS = "http://localhost:8080,https://yourdomain.com"
```

### 401 错误

检查认证配置：
```bash
# 查看当前变量
npx wrangler secret list

# 重新设置
npx wrangler secret put AUTH_SECRET
```

### 速率限制

添加 API Keys：
```bash
npx wrangler secret put SEMANTIC_SCHOLAR_API_KEY
npx wrangler secret put PUBMED_API_KEY
```

## 成本

### 免费套餐

- **请求数**: 100,000 请求/天
- **CPU 时间**: 10ms/请求（免费额度：10ms x 100,000 = 1,000秒/天）
- **足够覆盖**: 中小型应用

### 付费套餐（$5/月）

- **请求数**: 10,000,000 请求/月
- **CPU 时间**: 30,000,000 CPU 毫秒/月
- **适合**: 大型应用

## 下一步

1. ✅ 部署 Worker
2. ✅ 配置环境变量
3. ✅ 测试所有端点
4. ⏭️ 修改前端代码使用代理（见 README.md）
5. ⏭️ 在设置界面添加配置选项

## 参考资料

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)
