# Academic Search Proxy - Cloudflare Worker

CORS 代理服务，解决浏览器访问学术搜索 API 的跨域限制。

## 支持的服务

- ✅ **Semantic Scholar** - AI 驱动的学术搜索
- ✅ **PubMed** - 医学/生物学文献数据库
- ✅ **CrossRef** - DOI 注册机构数据库
- ✅ **OpenAlex** - 开放学术图谱
- ✅ **arXiv** - 预印本服务器

## 快速开始

### 本地开发

```bash
cd workers/academic-search-proxy
npx wrangler dev
```

服务将在 `http://localhost:8787` 启动。

### 部署到 Cloudflare

```bash
# 首次部署
npx wrangler deploy

# 设置环境变量（可选）
npx wrangler secret put SEMANTIC_SCHOLAR_API_KEY
npx wrangler secret put PUBMED_API_KEY
npx wrangler secret put AUTH_SECRET
```

## API 端点

### 健康检查
```
GET /health
```

返回服务状态和配置信息。

### Semantic Scholar
```
GET /api/semanticscholar/graph/v1/paper/search?query=machine+learning&limit=5
```

### PubMed
```
GET /api/pubmed/esearch.fcgi?db=pubmed&term=cancer&retmode=json&retmax=5
GET /api/pubmed/efetch.fcgi?db=pubmed&id=12345&retmode=xml
```

### CrossRef
```
GET /api/crossref/works?query.title=deep+learning&rows=5
```

### OpenAlex
```
GET /api/openalex/works?search=neural+networks
```

### arXiv
```
GET /api/arxiv/query?search_query=ti:transformer&max_results=5
```

## 客户端使用

修改前端代码，将直接 API 调用改为通过代理：

```javascript
// 配置代理地址
const PROXY_BASE = 'https://your-worker.workers.dev';

// Semantic Scholar
fetch(`${PROXY_BASE}/api/semanticscholar/graph/v1/paper/search?query=test`)

// PubMed
fetch(`${PROXY_BASE}/api/pubmed/esearch.fcgi?db=pubmed&term=cancer&retmode=json`)

// CrossRef
fetch(`${PROXY_BASE}/api/crossref/works?query.title=test`)

// OpenAlex
fetch(`${PROXY_BASE}/api/openalex/works?search=test`)

// arXiv
fetch(`${PROXY_BASE}/api/arxiv/query?search_query=ti:test`)
```

## 配置

### 环境变量

在 `wrangler.toml` 中配置（或使用 Cloudflare Dashboard）：

```toml
[vars]
ENABLE_AUTH = "false"
ALLOWED_ORIGINS = "http://localhost:8080,https://yourdomain.com"
```

### Secrets（敏感信息）

使用 wrangler CLI 设置：

```bash
# Semantic Scholar API Key (可选，提高速率限制)
npx wrangler secret put SEMANTIC_SCHOLAR_API_KEY

# PubMed API Key (可选，提高速率限制)
npx wrangler secret put PUBMED_API_KEY

# 认证密钥（如果启用 ENABLE_AUTH）
npx wrangler secret put AUTH_SECRET
```

### 客户端 API Key 透传

如果不想在 Worker 中存储 API Key，可以从客户端传递：

```javascript
fetch(`${PROXY_BASE}/api/semanticscholar/...`, {
    headers: {
        'X-Api-Key': 'your-client-api-key'
    }
})
```

### 启用认证

1. 设置 `ENABLE_AUTH = "true"`
2. 设置 `AUTH_SECRET`
3. 客户端请求时包含认证头：

```javascript
fetch(`${PROXY_BASE}/api/...`, {
    headers: {
        'X-Auth-Key': 'your-auth-secret'
    }
})
```

## 速率限制

### 无 API Key
- **Semantic Scholar**: 20 请求/分钟
- **PubMed**: 3 请求/秒

### 有 API Key
- **Semantic Scholar**: 180 请求/分钟（提升 9 倍）
- **PubMed**: 10 请求/秒（提升 3 倍）

### 获取 API Key
- [Semantic Scholar API](https://www.semanticscholar.org/product/api)
- [NCBI API Key](https://www.ncbi.nlm.nih.gov/account/settings/)

## 安全建议

1. ✅ 在生产环境启用 `ENABLE_AUTH`
2. ✅ 设置 `ALLOWED_ORIGINS` 限制来源
3. ✅ 使用 Secrets 存储敏感信息
4. ✅ 监控使用量，避免滥用
5. ✅ 定期轮换 `AUTH_SECRET`

## 故障排查

### CORS 错误
确保 Worker 返回正确的 CORS 头。检查：
- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Methods`
- `Access-Control-Allow-Headers`

### 401 Unauthorized
- 检查 `ENABLE_AUTH` 配置
- 确认 `X-Auth-Key` 头正确
- 验证 `ALLOWED_ORIGINS` 包含你的域名

### API 速率限制
- 考虑添加 API Key
- 实现客户端缓存
- 添加请求去重逻辑

## 开发

### 目录结构
```
workers/academic-search-proxy/
├── src/
│   └── index.js        # Worker 主文件
├── wrangler.toml       # Cloudflare 配置
├── README.md           # 本文档
└── DEPLOY.md           # 部署指南
```

### 测试

```bash
# 健康检查
curl https://your-worker.workers.dev/health

# Semantic Scholar
curl "https://your-worker.workers.dev/api/semanticscholar/graph/v1/paper/search?query=test"

# PubMed
curl "https://your-worker.workers.dev/api/pubmed/esearch.fcgi?db=pubmed&term=cancer&retmode=json"
```

## License

MIT
