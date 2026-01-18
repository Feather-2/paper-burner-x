# textprep - 文本预处理阶段

## 模块描述
从长文本生成 ContentPackage v0.1 的轻量流程，覆盖 TextPrep 主流程，并可为 DeepSearch 组装内容包与硬门槛校验。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口与流水线编排（TP1-TP6），含 trace/error boundary/降级逻辑 |
| `normalize.js` | TP1 文本规范化与哈希（稳定定位） |
| `chunk.js` | TP2 分块与定位（fixed/semantic/markdown），支持智能策略检测与 `smartChunk` |
| `slideplan.js` | TP4 SlideIntent 规划（LLM/启发式） |
| `claims.js` | TP5 原子论点与证据抽取（硬约束 H1） |
| `build-content-package.js` | TP6 组装 ContentPackage 并校验硬门槛（TextPrep H1-H4 / DeepSearch H5） |
| `constants.js` | PageType 枚举与合法性校验 |

## 关键概念

- TP1-TP6：normalize → chunk → slideplan → claims → align → buildContentPackage。
- ChunkStrategy：`detectChunkStrategy` 在 markdown/semantic/fixed 间择优，`smartChunk` 自动分块并返回元信息。
- Locator：`charStart/charEnd`（可选 `lineStart/lineEnd`）用于证据定位与硬门槛校验。
- Claims/Evidence：`extractClaims` 生成 `claimId/evidenceId` 并保证引用可解析。
- Summary：`deriveSummary` 优先使用 claims，缺失时回退到源文本摘要（DeepSearch 优先 scanSummary.summaryText）。
- DeepSearch 打包：`mode=deepsearch` 时要求 `report` 与 citations（H5），并补齐 scanSummary/gaps/todos/metrics。

## 常见任务

- 运行阶段：`runTextPrepStage(runContext, input, stageApi)` 或 `new TextPrepStage().execute(...)`。
- 控制分块：传入 `input.chunkOptions` 或直接调用 `chunkText`/`semanticChunk`/`markdownChunk`/`smartChunk`。
- 查询策略：`detectChunkStrategy(text)` 查看自动策略选择原因。
- 约束页数：通过 `runContext.constraints.pageCount` 或 `pageCountRange` 影响 slideplan。
- 无 LLM 兜底：开启 errorBoundary degrade 走启发式 `fallbackFactory`。
- 手动组装：`buildContentPackage(runContext, sources, slideIntents, claims, evidenceLedger, dataTables, extra)`，DeepSearch 需在 `extra` 提供 `mode/report/scanSummary/todos/gaps` 等。
