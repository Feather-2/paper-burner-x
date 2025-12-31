# Analysis: Multimedia & System Extensions (多媒体与系统扩展)

## 1. 架构 (Architecture)

### 多媒体处理体系 (`src/media/`)
- **智能图片处理 (`image.ts`)**:
  - **自适应压缩**: 估算图片 Token 消耗（`base64.length * 0.125`），超过阈值（25,000 tokens）时自动压缩至 400x400, JPEG 质量 20%。
  - **尺寸感知**: 使用 `sharp` 提取图片的原始尺寸（Original）和显示尺寸（Display）。
- **PDF 支持 (`pdf.ts`)**:
  - 限制最大处理大小为 32MB。
  - 验证文件头（`%PDF-`）并转换为 Base64 供模型消费。
- **SVG 渲染扩展 (`svg.ts`)**:
  - 集成 `@resvg/resvg-js` 将 SVG 转换为 PNG 图像，支持 DPI、缩放（fitTo）和背景色配置。

### 浏览器与代码签名集成
- **Chrome 扩展通信 (`src/chrome/`)**: 实现了与浏览器环境的交互逻辑，可能用于 OAuth 流程或 Web 预览。
- **代码签名验证 (`src/codesign/`)**: 为 CLI 生成的代码或插件提供签名验证机制，确保从云端下载或本地生成的脚本未被篡改。

### 频率控制与更新
- **智能限流 (`src/ratelimit/`)**: 在本地层面对 API 请求进行速率控制，防止触发 Anthropic 服务端的 429 错误。
- **热更新系统 (`src/updater/`)**: 负责检查新版本并支持在不通过 npm 手动升级的情况下更新核心逻辑。

## 2. 优化 Trick (Optimization Tricks)

- **PDF 文本层提取**: PDF 处理逻辑优先提取文本层而非 OCR，以保证代码段的精确度并节省 Token。
- **SVG 矢量预览**: SVG 处理逻辑能够识别矢量图形中的关键路径，帮助模型在不“看”图的情况下理解图标或架构图的结构。
- **本地频率缓冲**: 限流器采用令牌桶算法，允许短时间内的请求爆发，但长周期内严格遵守 QPS 限制。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **文档深度理解能力**: 我们的 Agent 目前主要处理 `.js/.py`。引入 PDF 处理器，可以让 Agent 直接阅读项目文档（如设计 PRD 或架构图 PDF）。
- **多模态预览**: 在处理前端项目时，让 Agent 具备解析 SVG 的能力，可以辅助它进行 UI 组件的开发。
- **自动升级机制**: 为我们的 Agent 脚本添加一个简单的 `updater` 逻辑，确保团队成员始终在使用最新的 Prompt 和工具集。
- **内限流机制**: 在本地记录 Token 使用频率，当接近限额时自动增加 `Thinking` 时间或提示用户，比直接报错更友好。
