# PB OCR Proxy Worker

Cloudflare Worker 支持 MinerU 和 Doc2X 双 OCR 引擎，解决 CORS 与 API 密钥管理。

## 快速开始

详见 [DEPLOY.md](./DEPLOY.md)

## 目录结构

```
pb-ocr-proxy/
├── src/index.js       # Worker 核心代码
├── wrangler.toml      # Wrangler 配置
├── examples/          # 测试页面
├── DEPLOY.md          # 完整部署文档
└── README.md
```

## 核心特性

- **双引擎**: MinerU + Doc2X
- **灵活 Token**: 前端透传或 Worker 持有
- **零成本**: Cloudflare 免费额度 10 万次/天
- **安全**: CORS 白名单、API Key 验证

## API 端点

### MinerU
- `POST /mineru/upload` - 上传文件
- `GET /mineru/result/{batch_id}` - 查询结果
- `GET /mineru/zip?url=...` - 代理下载

### Doc2X
- `POST /doc2x/upload` - 上传文件
- `GET /doc2x/status/{uid}` - 查询状态
- `POST /doc2x/convert` - 触发导出
- `GET /doc2x/convert/result/{uid}` - 查询导出
- `GET /doc2x/zip?url=...` - 代理下载

### 通用
- `GET /health` - 健康检查

## 环境变量

**Token（至少配置一个）:**
- `MINERU_API_TOKEN` (Secret)
- `DOC2X_API_TOKEN` (Secret)

**鉴权（可选）:**
- `ENABLE_AUTH` = "true" (Variable)
- `AUTH_SECRET` (Secret, 需 ENABLE_AUTH)
- `ALLOWED_ORIGINS` = "https://your-domain.com" (Variable)

## Token 优先级

`X-MinerU-Key` / `X-Doc2X-Key` 请求头 > Worker 环境变量

## 部署

### 方式 1: Cloudflare Dashboard
1. Workers & Pages → Create Worker
2. 粘贴 `src/index.js` → Deploy
3. Settings → Variables 配置环境变量

### 方式 2: Wrangler CLI
```bash
wrangler secret put MINERU_API_TOKEN
wrangler secret put DOC2X_API_TOKEN
wrangler deploy
```

## 许可证

MIT
