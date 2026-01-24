# textprep - 文本预处理阶段

## 模块描述
从长文本生成 ContentPackage v0.1 的轻量流程，覆盖 TextPrep 主流程，并可为 DeepSearch 组装内容包与硬门槛校验。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口与流水线编排（TP1-TP6），含 trace/error boundary/降级逻辑 |
| `normalize.js` | TP1 文本规范化与哈希（稳定定位） |
| `chunk.js` | TP2 分块与定位（fixed/semantic/markdown）；导出 `ChunkStrategy`、`detectChunkStrategy` 与 `smartChunk`（支持 `forceStrategy/maxSize`） |
| `slideplan.js` | TP4 SlideIntent 规划（LLM/启发式） |
| `claims.js` | TP5 原子论点与证据抽取（硬约束 H1） |
| `build-content-package.js` | TP6 组装 ContentPackage 并校验硬门槛（TextPrep H1-H4 / DeepSearch H5），并派生 summary/metrics 等 |
| `constants.js` | PageType 枚举与合法性校验 |

## 关键概念

- TP1-TP6：normalize → chunk → slideplan → claims → align → buildContentPackage。
- ChunkStrategy：值为 `"markdown"|"semantic"|"fixed"`；`detectChunkStrategy(text)` 返回 `{ strategy, reason, headingCount?, paragraphCount? }`。
  - 启发式：markdown（标题数≥2 且标题密度满足阈值）> semantic（有效段落数≥3，段落长度阈值过滤）> fixed。
  - 当前实现细节（可能随版本微调）：标题密度使用 `headingCount >= text.length / 5000`；段落过滤使用 `p.trim().length > 50`。
- smartChunk：`smartChunk(text, { forceStrategy?, maxSize? })` 自动择优并返回 `{ strategy, reason, chunks, meta }`；`maxSize` 默认 2000。
- Locator：`charStart/charEnd`（可选 `lineStart/lineEnd`）用于证据定位与硬门槛校验。
- Claims/Evidence：`extractClaims` 生成 `claimId/evidenceId` 并保证引用可解析。
- Summary：`deriveSummary` 优先用 claims 文本派生摘要；缺失时回退到源文本截断摘要（当前实现约 280 字符上限）；摘要会做空白归一化以便展示/比对。DeepSearch 优先使用 `scanSummary.summaryText`（若提供）。
- DeepSearch 打包：`mode=deepsearch` 时要求 `report` 与 citations（H5），并补齐 `scanSummary/gaps/todos/metrics`；可选附带 `condensedMemory`、`todoCompletionStats`、`completionReason` 等运行态字段。

## 常见任务

- 运行阶段：`runTextPrepStage(runContext, input, stageApi)` 或 `new TextPrepStage().execute(...)`。
- 控制分块：传入 `input.chunkOptions` 或直接调用 `chunkText`/`semanticChunk`/`markdownChunk`/`smartChunk`；需要固定策略时用 `smartChunk(text, { forceStrategy: "markdown"|"semantic"|"fixed" })`。
- 查询策略：`detectChunkStrategy(text)` 查看自动策略选择原因（`reason`）及计数信息。
- 约束页数：通过 `runContext.constraints.pageCount` 或 `pageCountRange` 影响 slideplan。
- 无 LLM 兜底：开启 errorBoundary degrade 走启发式 `fallbackFactory`。
- 手动组装：直接调用 `buildContentPackage(...)`（见 `build-content-package.js` 导出与 Hard Gate 校验逻辑）。
