# ingest - 文档摄取

多格式文档/媒体摄取，统一产出 `ParsedDocument`（markdown + chunks + assets）。

## 核心文件列表

| 文件 | 职责 |
| --- | --- |
| `ingest-stage.js` | 主流程：路由输入、并发处理、超时/事件、可恢复持久化（resume/persist）、URL 拉取、可选资产理解 |
| `asset-manager.js` | 资产去重与管理（hash + 碰撞签名）；解析 data payload；base64/bytes 互转；按需保存 bytes 降低内存 |
| `asset-understanding.js` | 批量图片理解；提示词缓存；进度回调；响应 JSON 限制（字符/items/keys）；错误消息脱敏/截断 |
| `chunked-loader.js` | 大文件分块读取与流式处理（binary/text）；输出 `ChunkRecord`（offset/size/byteLength） |
| `extract-assets.js` | 从 markdown 图像引用抽取资产与定位信息 |
| `constants.js` | `SourceKind`、`AssetMimeType`、`ExportFormat` 等枚举 |
| `index.js` | 模块出口：`IngestStage`、`AssetManager`、Adapters、`extractAssetsFromMarkdown` |
| `streaming/byte-buffer.js` | 流式解析的 `Uint8Array` 缓冲与拼接工具 |
| `tools/video-frames.js` | 视频抽帧（mediabunny + OffscreenCanvas）并生成图片资产 |
| `adapters/resolve-deps.js` | 统一解析 DOMParser/Turndown/mammoth/PPTX/OCR/whisper 等依赖 |
| `adapters/node-io.js` | Node 端路径读取与文件 I/O 封装（browser-safe 失败降级） |

## 关键概念

- 输入与调度：支持 `files`、`urls`、`historyIds`、`rawTexts`；按 `maxConcurrentDocs` 并发；支持 `docTimeoutMs` 与 URL 大小上限。
- 可恢复执行：`IngestStage` 支持中途进度持久化与恢复（resume/persist），用于长任务与断点续跑。
- URL 摄取：可通过 `urlFetcher`、MCP 或直连 `fetch`；直连能力由 `allowDirectUrlFetch`、私网访问由 `allowPrivateNetwork` 控制。
- `ParsedDocument`：由 `BaseAdapter.buildParsedDocument` 统一生成，包含 `docId`、`markdown`、`textNormalized`、`textHash`、`toc`、`chunks`、`chunkStrategy`、`chunkMeta`、`assets`、`metadata`、`parseInfo`。
- 分块策略：默认固定大小 + overlap + 行号；可选 smartChunk；每个 chunk 附带 `locator`（char/line 范围）。
- 资产与去重：`extractAssetsFromMarkdown()` 负责抽取图片资产；`AssetManager` 负责 hash 去重、碰撞检测、data payload 解析与 bytes/base64 转换。
- 资产理解限制：默认每批 5 张；响应限制为字符数/items/keys 上限；错误消息默认截断 200 chars。当前图像预处理函数不主动压缩或拒绝超限输入。
- 音视频：Audio/Video 依赖 `whisperApi` 转写；Video 支持可选抽帧生成图片资产。
- 路径读取策略：`markdown/html/docx/epub/pptx` 对路径输入要求 `allowPathRead`；`pdf/audio/video/code` 当前实现仍允许直接路径读取（建议调用方在受控环境运行）。

## 子模块索引

### adapters/

- `base.js`：流式解析与分块基类；统一规范化、TOC、chunk 元数据。
- `markdown.js`：读取 md/txt（file-like 或路径）。
- `raw-text.js`：用户文本输入转 markdown。
- `history.js`：从 storageAdapter 拉取历史记录（translation/ocr/markdown），并附带图片资产。
- `pdf.js`：优先 OCR（`OcrManager/processFile`）；无 OCR 时提取内嵌文本与图片资产。
- `docx.js`：mammoth -> HTML -> Turndown -> markdown；提取内嵌图片。
- `pptx.js`：`PPTXSlideParser` 解析幻灯片文本/图片并生成按 slide 的 markdown。
- `html.js`：HTML -> markdown 转换与基础清洗。
- `epub.js`：EPUB 解包、章节提取与 markdown 化。
- `audio.js`：音频转写为文本与 LRC。
- `video.js`：视频转写与可选抽帧。
- `code.js`：源码文本读取、按语言规则切块与元数据提取。

### streaming/

- `byte-buffer.js`：增量拼接/切片，避免大文件一次性加载。

### tools/

- `video-frames.js`：统一抽帧与图片序列化。
