# report - 报告生成与引用

负责 DeepSearch 报告的章节组织、引用整理、长度/质量校验与输出规范。

## 核心文件

| 文件 | 职责 |
|------|------|
| `report-generator.js` | 从 claims/evidence/todos（含 gaps 自动转换）生成报告骨架与完整内容，支持单次写作、TOC 分段写作与占位报告 |
| `citations.js` | 解析 `{{cite:...}}` 引用标记，构建引用清单与参考文献，并将标记重写为编号引用 `[n]` |
| `report-postprocess.js` | 报告校验与后处理（重排章节、去重、校验字数/引用） |
| `write-utils.js` | 报告长度策略、并发写作工具与基础文本统计 |

## 关键概念

| 概念 | 说明 |
|------|------|
| 引用标记 | 草稿中使用 `{{cite:<evidenceId>}}`，最终统一替换为编号引用 `[n]`；编号与 evidence/source 的映射在 `## 参考文献` 中给出 |
| 参考文献条目 | 自动追加 `## 参考文献`；条目格式为 `- [n] label — "quote"`（quote 会截断并对表格显示占位） |
| evidence / sources | `evidenceLedger` 与 `sources` 共同构建引用索引与来源元信息；如存在行号/locator 信息，通常体现在参考文献条目中（而不是内联引用） |
| todo / gap 映射 | 兼容 `gap_*` 与 `todo_*` 两种 ID：`gap_123` <-> `todo_123`；非数字 ID 通过前缀追加/移除保持可逆。gap 状态会映射为 todo 状态（filled->completed, blocked->cancelled，其余->open） |
| 报告策略 | `single`（一次生成）与 `toc-based`（先目录后分章） |
| 模式校验 | `quick/wider/deeper` 模式控制字数、引用数量与必需章节 |

## 常见任务

- 生成基础报告骨架与引用：`generateReport(...)` + `finalizeCitationsInMarkdown(...)`
- LLM 一次性写作：`generateReportSingleWithLLM(...)`
- 目录+分章写作：`generateReportTocBasedWithLLM(...)`（会 emit 进度事件）
- 全部完成时生成占位报告：`generatePlaceholderReport(...)`
- 合并并保留引用：`finalizeReportKeepingCitations(...)`
- 校验与整理：`validateReport(...)`、`reorderReportSections(...)`、`prepareReportForSubmit(...)`
- 长度与并发配置：`resolveReportLengthConfig(...)`、`resolveMaxParallelSections(...)`
- 报告进度与质量检查：`getReportProgress(...)`、`reviewReportMarkdown(...)`
- 仅提取引用 evidenceId：`extractEvidenceIdsFromMarkdownCitations(...)`
- 引用 quote 格式化（截断/表格占位）：`formatQuoteForCitation(...)`
