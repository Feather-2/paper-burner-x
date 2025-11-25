# Paper Burner 本地代理服务器

轻量级本地代理服务器，功能完全等同于 Cloudflare Worker，让你无需部署到云端即可使用。

## 功能

- **OCR 代理**: MinerU / Doc2X
- **学术搜索代理**: Semantic Scholar / PubMed / CrossRef / OpenAlex / arXiv
- **文件下载代理**: PDF / ZIP（解决跨域问题）

## 快速开始

### 方式一：直接运行（推荐）

```bash
cd local-proxy
npm install
npm start
```

### 方式二：全局安装

```bash
cd local-proxy
npm install -g .
paper-burner-proxy
```

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

## 在 Paper Burner 中使用

1. 启动本地代理服务器后，打开 Paper Burner
2. 进入设置页面
3. 将代理地址设置为：`http://localhost:3456`
4. 保存设置

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

## 与 Cloudflare Worker 的区别

| 特性 | 本地代理 | CF Worker |
|------|----------|-----------|
| 部署 | 本地运行 | 云端部署 |
| 费用 | 免费 | 免费额度有限 |
| 延迟 | 取决于网络 | 边缘节点低延迟 |
| 可用性 | 需要保持运行 | 24/7 可用 |
| 配置 | .env 文件 | 环境变量 |

## License

GPL-2.0
