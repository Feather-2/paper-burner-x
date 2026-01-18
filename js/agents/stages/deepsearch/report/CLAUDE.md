# report - 报告生成与引用

负责 DeepSearch 报告的章节组织、引用整理、长度/质量校验与输出规范。

## 核心文件

| 文件 | 职责 |
|------|------|
| `report-generator.js` | 从 claims/evidence/todos 生成报告骨架与完整内容，支持单次写作、TOC 分段写作与占位报告 |
| `citations.js` | 解析 `{{cite:...}}` 引用标记，生成精确引用（含行号）与参考文献 |
| `report-postprocess.js` | 报告校验与后处理（重排章节、去重、校验字数/引用） |
| `write-utils.js` | 报告长度策略、并发写作工具与基础文本统计 |

## 关键概念

| 概念 | 说明 |
|------|------|
| 引用标记 | 草稿中使用 `{{cite:<evidenceId>}}`，最终替换为 `[sourceId:Lx-Ly]`；若无行号则降级为 `[sourceId]`，无来源则使用 `[n]` |
| 参考文献条目 | 自动追加 `## 参考文献`；条目格式为 `- [ref] label — "quote"`，quote 会截断并对表格显示占位 |
| evidence / sources | `evidenceLedger` 与 `sources` 共同构建引用索引与来源元信息 |
| todo / gap 映射 | `gap_*` 与 `todo_*` 可互转，用于将 claims 归档到章节 |
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
