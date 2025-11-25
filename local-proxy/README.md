# Paper Burner 本地代理服务器

轻量级本地代理服务器，功能完全等同于 Cloudflare Worker，让你无需部署到云端即可使用。

> **重要提示**：此本地代理仅支持 HTTP 协议，必须配合**本地运行的 Paper Burner 前端**使用。
> 如果你从 HTTPS 网站（如 `https://paperburner.viwoplus.site`）访问，由于浏览器安全限制（Mixed Content），无法连接到本地 HTTP 服务。
> 请使用我们提供的 Cloudflare Worker 或自行部署 HTTPS 代理。

## 功能

- **OCR 代理**: MinerU / Doc2X
- **学术搜索代理**: Semantic Scholar / PubMed / CrossRef / OpenAlex / arXiv
- **文件下载代理**: PDF / ZIP（解决跨域问题）

## 快速开始

### 1. 启动本地代理

```bash
cd local-proxy
npm install
npm start
```

### 2. 启动本地前端

在项目根目录启动一个本地服务器：

```bash
# 方式一：使用 npx serve
npx serve -p 8080

# 方式二：使用 Python
python -m http.server 8080

# 方式三：使用 VS Code Live Server 插件
```

### 3. 配置使用

1. 访问 `http://localhost:8080`
2. 进入设置页面
3. 将代理地址设置为：`http://localhost:3456`
4. 保存设置

## 配置

1. 复制配置文件：
   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env` 文件，填入你的 API Token（可选）：
   ```
   MINERU_API_TOKEN=your_mineru_token
   DOC2X_API_TOKEN=your_doc2x_token
   ```

3. 启动服务器：
   ```bash
   npm start
   ```

## API 路由

### OCR 服务

| 路由 | 方法 | 说明 |
|------|------|------|
| `/mineru/upload` | POST | MinerU 文件上传 |
| `/mineru/result/:batchId` | GET | 获取 MinerU 处理结果 |
| `/doc2x/upload` | POST | Doc2X 文件上传 |
| `/doc2x/status/:uid` | GET | 查询 Doc2X 状态 |
| `/doc2x/convert` | POST | Doc2X 格式转换 |
| `/doc2x/convert/result/:uid` | GET | 获取转换结果 |
| `/mineru/zip?url=` | GET | MinerU ZIP 代理下载 |
| `/doc2x/zip?url=` | GET | Doc2X ZIP 代理下载 |

### 学术搜索

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/semanticscholar/*` | GET | Semantic Scholar 代理 |
| `/api/pubmed/*` | GET | PubMed 代理 |
| `/api/crossref/*` | GET | CrossRef 代理 |
| `/api/openalex/*` | GET | OpenAlex 代理 |
| `/api/arxiv/*` | GET | arXiv 代理 |
| `/api/pdf/download?url=` | GET | PDF 下载代理 |

### 其他

| 路由 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |

## 请求头

可以通过请求头传递 API Token（优先级高于环境变量）：

- `X-MinerU-Key`: MinerU API Token
- `X-Doc2X-Key`: Doc2X API Token
- `X-Api-Key`: Semantic Scholar / PubMed API Key

## 系统要求

- Node.js >= 18.0.0

## 使用场景对比

| 场景 | 推荐方案 |
|------|----------|
| 本地开发/测试 | 本地代理 + 本地前端 |
| 日常使用（线上） | Cloudflare Worker |
| 私有部署 | 自建 HTTPS 代理服务器 |

## 为什么不支持 HTTPS 网站？

浏览器的 **Mixed Content** 安全策略禁止 HTTPS 页面请求 HTTP 资源。虽然可以通过自签名证书启用 HTTPS，但：

1. 自签名证书需要手动信任，用户体验差
2. 杀毒软件（如卡巴斯基）可能拦截自签名 HTTPS 流量
3. 每次证书过期都需要重新配置

因此，本地代理仅推荐用于**本地开发和测试**场景。

## License

GPL-2.0
