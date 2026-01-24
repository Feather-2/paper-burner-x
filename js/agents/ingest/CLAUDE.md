# ingest - 文档摄取

多格式文档/媒体摄取，统一产出 ParsedDocument（markdown + chunks + assets）。

## 核心文件列表

| 文件 | 职责 |
| --- | --- |
| `ingest-stage.js` | 主流程：路由输入、并发处理、超时/事件、可恢复持久化、可选资产理解 |
| `asset-manager.js` | 资产去重与管理（hash + 碰撞签名）；解析 data: payload；base64/bytes 互转（Browser/Node 兼容），按需保存 bytes 以降低内存 |
| `asset-understanding.js` | 视觉模型批量分析图片资产；带提示词缓存、图片大小上限、JSON 输出约束与错误消息脱敏；支持进度回调 |
| `chunked-loader.js` | 大文件分块读取与流式处理工具（binary/text）；输出带 offset/size/byteLength 的 ChunkRecord，降低内存峰值 |
| `extract-assets.js` | 从 markdown 图像引用抽取资产与定位信息 |
| `constants.js` | SourceKind、AssetMimeType、ExportFormat 等枚举 |
| `index.js` | 模块出口：IngestStage/AssetManager/Adapters/extractAssetsFromMarkdown |

## 关键概念

- 输入与调度：支持 `files`、`urls`、`historyIds`、`rawTexts`；按 `maxConcurrentDocs` 并发，支持 `docTimeoutMs` 和 URL 大小上限；URL 可走 urlFetcher/MCP/fetch。
- ParsedDocument：由 BaseAdapter.buildParsedDocument 生成，包含 `docId`、`markdown`、`textNormalized`、`textHash`、`toc`、`chunks`、`chunkStrategy`/`chunkMeta`、`assets`、`metadata`、`parseInfo`。
- 分块策略：默认固定大小 + overlap + 行号；可选 smartChunk；每个 chunk 带 `locator`（char/line 范围）。
- 资产与去重：`extractAssetsFromMarkdown()` 生成图片资产；`AssetManager` 以 hash 去重并检测碰撞，必要时存 bytes 而非大 base64；支持解析 `data:` payload，并提供 base64<->bytes 转换以适配 Browser/Node。
- 资产理解：`understandAssets` 可调用视觉模型批量分析图片（支持进度回调）；内置批量大小、图片大小、JSON 输出的数量/字段/长度上限，并对错误信息做脱敏与截断，避免泄漏或解析崩溃。
- 音视频：Audio/Video 依赖 `whisperApi` 转写，返回纯文本与 LRC；Video 可选抽帧生成图片资产。

## 子模块索引

### adapters/

- `base.js`：流式解析与分块基类；统一规范化、TOC、chunk 元数据。
- `markdown.js`：读取 md/txt（路径或 file-like），直接转 markdown。
- `raw-text.js`：用户文本输入转 markdown。
- `history.js`：从 storageAdapter 拉取历史记录（translation/ocr/markdown），附带图片资产。
- `pdf.js`：优先 OCR（OcrManager/processFile），无 OCR 时提取内嵌文本；抽取图片资产。
- `docx.js`：mammoth -> HTML -> Turndown -> markdown；提取内嵌/嵌入图片。
- `pptx.js`：PPTXSlideParser 解析幻灯片文本/图片，生成分 slide 的 markdown。
- `html.js`：Turndown 转 markdown；处理 HTML/data-uri 图片。
- `epub.js`：JSZip + DOMParser 解析章节与资源；拼接章节 markdown；抽取图片。
- `audio.js`：whisperApi 转写音频，生成纯文本与 LRC。
- `video.js`：whisperApi 转写视频（可先抽音轨）；可选抽帧生成图片资产。
- `code.js`：支持多语言代码文件；安全过滤敏感/过大文件；生成带语言标记的 code block。

### streaming/

- `byte-buffer.js`：ByteBuffer 增量二进制缓冲区，支持 append/slice/indexOf/consume，降低复制开销。

### tools/

- `video-frames.js`：`getVideoFrames()` 基于 mediabunny 抽帧，输出 base64 JPEG；支持自定义抽帧参数（如帧率/间隔/上限等）。
