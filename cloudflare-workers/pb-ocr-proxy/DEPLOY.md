# PB OCR Proxy (Cloudflare Worker) - 部署与使用指南

> 单个 Worker 同时支持 MinerU 与 Doc2X 两种 OCR 服务。无需 Vercel 配置，直接在 Cloudflare 控制台部署即可使用。

---

## 🚀 Fast Deploy · 快速部署

本节用最短路径告诉你如何上线与如何在 Paper Burner X 里配置。

### 1) 环境变量一览

- 必选（至少二选一）：
  - Secret `MINERU_API_TOKEN`（MinerU 令牌）
  - Secret `DOC2X_API_TOKEN`（Doc2X 令牌）
- 可选（推荐生产）：
  - Variable `ENABLE_AUTH` = `true|false`（是否开启鉴权）
  - Secret `AUTH_SECRET`（鉴权密钥，开启 ENABLE_AUTH 时必填）
  - Variable/Secret `ALLOWED_ORIGINS` = `https://your-frontend.com,https://another.com`（CORS 白名单）

备注：令牌值只填 Token 本体，不要带 `Bearer ` 前缀。请求头里同理。

### 2) Cloudflare 控制台 3 步上线

1. 创建 Worker → Delete 示例代码 → 粘贴 `src/index.js` → Save & Deploy
2. Settings → Variables/Secrets：按上面的变量一览添加
3. 复制你的 URL（如 `https://xxx.workers.dev`），用于前端配置

### 3) 常见使用场景与如何配置

场景 A：多人共享 Worker，各自用自己的 Key（推荐“前端透传模式”）
- Cloudflare Worker：
  - 可不配置 `MINERU_API_TOKEN` / `DOC2X_API_TOKEN`
  - 建议开启鉴权：`ENABLE_AUTH=true`，配置 `AUTH_SECRET`，并设置 `ALLOWED_ORIGINS`
- Paper Burner X：
  - 打开“模型与Key管理” → MinerU / Doc2X：
    - Worker URL：填你的 Worker 地址
    - Worker Auth Key：填 `AUTH_SECRET`（若开启鉴权）
    - Token 模式：选择“前端透传模式”，在 PBX 内填入各自的服务 Token
  - OCR 引擎：在主界面 OCR 设置里选择 MinerU / Doc2X
  - 点击“测试连接”确认可达

场景 B：个人 Worker（或你提供统一 Key 给他人使用）
- Cloudflare Worker：
  - 配置 `MINERU_API_TOKEN` / `DOC2X_API_TOKEN`
  - 开启鉴权：`ENABLE_AUTH=true` + `AUTH_SECRET`
  - 配置 `ALLOWED_ORIGINS`（只允许你的前端域）
- Paper Burner X：
  - 打开“模型与Key管理” → MinerU / Doc2X：
    - Worker URL：填你的 Worker 地址
    - Worker Auth Key：填 `AUTH_SECRET`
    - Token 模式：选择“Worker 配置模式”（前端不再填 Token）
  - OCR 引擎：在主界面 OCR 设置里选择 MinerU / Doc2X
  - 点击“测试连接”确认可达

优先级说明（两服务一致）：如果同时提供了“请求头 Token（前端透传）”与“Worker 环境变量”，请求头优先。

---

## 一、功能概览

Worker 提供以下统一端点（均基于你的 workers.dev 子域或自定义域）：

- MinerU
  - POST `/mineru/upload`    上传文件（表单）并发起处理
  - GET  `/mineru/result/{batch_id}` 轮询处理结果（含 `__health__` 测活）
  - GET  `/mineru/zip?url=...` 代理下载 ZIP（解决浏览器跨域）
- Doc2X
  - POST `/doc2x/upload`     预上传并上传文件
  - GET  `/doc2x/status/{uid}` 轮询处理状态（含 `__health__` 测活）
  - POST `/doc2x/convert`    触发导出（可选）
  - GET  `/doc2x/convert/result/{uid}` 查询导出结果（可选）
  - GET  `/doc2x/zip?url=...` 代理下载 ZIP（解决浏览器跨域）
- 通用
  - GET  `/health` 健康检查（不校验 Token）

鉴权与 CORS：
- 可选开启 `ENABLE_AUTH=true`，启用后所有业务端点需携带请求头 `X-Auth-Key: <AUTH_SECRET>`。
- Token 传递方式：优先读取请求头（前端透传）→ 若不存在则读取 Worker 环境变量。
- CORS：支持 `ALLOWED_ORIGINS` 白名单与标准预检（OPTIONS）。

---

## 二、部署步骤（控制台，无需 wrangler）

1. 登录 Cloudflare Dashboard → Workers & Pages → Create Application → Create Worker
2. 命名（如 `pb-ocr-proxy`）→ Deploy → Edit Code
3. 删除示例代码，粘贴 `src/index.js` 全部内容 → Save and Deploy
4. Settings → Variables and Secrets：
   - 必填（至少二选一，根据使用场景）：
     - Secret `MINERU_API_TOKEN`（MinerU 令牌）
     - Secret `DOC2X_API_TOKEN`（Doc2X 令牌）
   - 可选（推荐生产）：
     - Variable `ENABLE_AUTH` = `true|false`
     - Secret `AUTH_SECRET`（开启 ENABLE_AUTH 时必填）
     - Variable/Secret `ALLOWED_ORIGINS` = `https://your-frontend.com,https://another.com`
   - 注意：令牌值只填 Token 本体，不要带 `Bearer ` 前缀。
5. 复制你的 Worker URL（如 `https://pb-ocr-proxy.yourname.workers.dev`）用于前端配置。

> 兼容日期（Compatibility Date）建议设置为 >= 2024-10-01。

---

## 三、环境变量说明

- MinerU/Doc2X Token
  - `MINERU_API_TOKEN`（Secret）：MinerU 令牌
  - `DOC2X_API_TOKEN`（Secret）：Doc2X 令牌
- 鉴权与 CORS（可选）
  - `ENABLE_AUTH`（Variable，默认不启用）：`true` 时开启鉴权
  - `AUTH_SECRET`（Secret）：开启鉴权后，所有业务端点需携带 `X-Auth-Key: <AUTH_SECRET>`
  - `ALLOWED_ORIGINS`（Variable/Secret）：逗号分隔的白名单 Origin；启用后仅白名单域可通过预检

Token 查找顺序（两服务一致）：
1. 请求头：`X-MinerU-Key` 或 `X-Doc2X-Key`
2. 环境变量：`MINERU_API_TOKEN` 或 `DOC2X_API_TOKEN`

---

## 四、端点与示例

通用健康：
```bash
curl https://your-worker.workers.dev/health
```

MinerU 测活（含 Token 校验）：
```bash
# 成功（200）：带 Token 或 Worker 已配置 Token
curl -i https://your-worker.workers.dev/mineru/result/__health__ \
  -H "X-Auth-Key: <AUTH_SECRET>" \
  -H "X-MinerU-Key: <MINERU_API_TOKEN>"

# 未授权（401）：未提供 Token 且 Worker 未配置 Token
curl -i https://your-worker.workers.dev/mineru/result/__health__
```

Doc2X 测活：
```bash
curl -i https://your-worker.workers.dev/doc2x/status/__health__ \
  -H "X-Auth-Key: <AUTH_SECRET>" \
  -H "X-Doc2X-Key: <DOC2X_API_TOKEN>"
```

MinerU 工作流：
```bash
# 1) 上传
curl -X POST https://your-worker.workers.dev/mineru/upload \
  -H "X-Auth-Key: <AUTH_SECRET>" \
  -H "X-MinerU-Key: <MINERU_API_TOKEN>" \
  -F file=@/path/to/file.pdf \
  -F is_ocr=true -F enable_formula=true -F enable_table=true -F language=ch

# 响应 { success:true, batch_id:"..." }

# 2) 轮询结果
curl https://your-worker.workers.dev/mineru/result/<batch_id> \
  -H "X-Auth-Key: <AUTH_SECRET>"

# 3) ZIP 代理下载（解决浏览器跨域）
curl -L "https://your-worker.workers.dev/mineru/zip?url=<full_zip_url>" \
  -o result.zip
```

Doc2X 工作流：
```bash
# 1) 上传
curl -X POST https://your-worker.workers.dev/doc2x/upload \
  -H "X-Auth-Key: <AUTH_SECRET>" \
  -H "X-Doc2X-Key: <DOC2X_API_TOKEN>" \
  -F file=@/path/to/file.pdf

# 响应 { success:true, uid:"..." }

# 2) 轮询状态
curl https://your-worker.workers.dev/doc2x/status/<uid> \
  -H "X-Auth-Key: <AUTH_SECRET>"

# 3) （可选）触发导出并查询导出结果
curl -X POST https://your-worker.workers.dev/doc2x/convert \
  -H "X-Auth-Key: <AUTH_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"uid":"<uid>","to":"md","formula_mode":"dollar"}'

curl https://your-worker.workers.dev/doc2x/convert/result/<uid> \
  -H "X-Auth-Key: <AUTH_SECRET>"

# 4) ZIP 代理下载（解决浏览器跨域）
curl -L "https://your-worker.workers.dev/doc2x/zip?url=<zip_url>" -o result.zip
```

CORS 与预检（OPTIONS）：
- Worker 自动处理预检请求，允许的请求头：`Content-Type, X-Auth-Key, X-MinerU-Key, X-Doc2X-Key`
- 设置 `ALLOWED_ORIGINS` 后，只有白名单域可通过预检并访问

---

## 五、前端集成要点

- 在前端 UI 中配置 Worker URL（如 `https://your-worker.workers.dev`）即可，无需 Vercel 侧代理/重写
- 鉴权启用时，在请求中带 `X-Auth-Key: <AUTH_SECRET>`
- Token 传递有两种模式：
  - 前端透传：请求头 `X-MinerU-Key` / `X-Doc2X-Key`
  - Worker 持有：在 Cloudflare 环境变量中配置 `MINERU_API_TOKEN` / `DOC2X_API_TOKEN`
- 对于从第三方返回的 ZIP 下载链接，前端应通过 `/mineru/zip?url=...` 或 `/doc2x/zip?url=...` 代理，避免浏览器直连跨域

---

## 六、wrangler CLI 部署（推荐用于生产）

如需使用 wrangler CLI 进行本地开发和自动化部署，项目已包含 `wrangler.toml` 配置文件。

### 1) 安装 wrangler

```bash
npm install -g wrangler
# 或使用 pnpm/yarn
pnpm add -g wrangler
```

### 2) 登录 Cloudflare

```bash
wrangler login
```

### 3) 配置环境变量

**Secrets（敏感信息）：**
```bash
# 至少配置一个 OCR Token
wrangler secret put MINERU_API_TOKEN
wrangler secret put DOC2X_API_TOKEN

# 可选：启用鉴权
wrangler secret put AUTH_SECRET
```

**Variables（非敏感配置）：**

编辑 `wrangler.toml`，取消注释需要的变量：
```toml
[vars]
ENABLE_AUTH = "true"
ALLOWED_ORIGINS = "https://yourdomain.com,https://another.com"
```

或使用命令行设置：
```bash
wrangler secret put ALLOWED_ORIGINS --env production
```

### 4) 本地开发

```bash
cd workers/pb-ocr-proxy
wrangler dev
```

访问 `http://localhost:8787/health` 测试。

### 5) 部署到生产

```bash
wrangler deploy
```

部署成功后会显示 Worker URL，如 `https://pb-ocr-proxy.yourname.workers.dev`。

### 6) 查看日志

```bash
wrangler tail
```

### 7) 管理 Secrets

```bash
# 列出所有 secrets（不显示值）
wrangler secret list

# 删除 secret
wrangler secret delete MINERU_API_TOKEN
```

---

## 七、与 Vercel 的关系

- 本仓库前端在 Vercel 部署；Workers 在 Cloudflare 部署，二者独立
- 已在仓库根添加 `.vercelignore` 排除 `workers/` 目录，避免 Workers 代码被当作静态文件发布
- 无需在 `vercel.json` 中为 Workers 写任何配置

---

## 八、故障排查

- 401 未授权：
  - 未携带 `X-Auth-Key`（在开启鉴权时）或 `X-Auth-Key` 与 `AUTH_SECRET` 不一致
  - 未携带服务 Token（请求头或环境变量），`X-MinerU-Key` / `X-Doc2X-Key` 均为空
- 403 预检失败：
  - 设置了 `ALLOWED_ORIGINS`，但请求来源不在白名单
- ZIP 跨域：
  - 直接访问第三方下载地址跨域失败；使用 `/mineru/zip?url=...` 或 `/doc2x/zip?url=...` 代理
- 健康与测活：
  - `/health` 仅测试可达性
  - `/mineru/result/__health__` 与 `/doc2x/status/__health__` 用于测试 Token/鉴权链路

如需更多示例，请参考 `workers/pb-ocr-proxy/examples/test.html`。
