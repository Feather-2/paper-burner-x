# write-report - DeepSearch 报告写作工具

用于生成、增量编辑并提交 DeepSearch 研究报告。

## 模块描述

- DeepSearch 阶段的报告写入与提交处理器，支持分阶段写作与最终提交校验。
- 维护 `state.L1.report`（markdown、draftMarkdown、sections、citations、history、version、submitted、validation 等）。
- 提供进度提示、重复内容审查、引用原文回溯、发现回顾等辅助能力。
- 分析门槛支持 `state.globalConfig.analysisGates` 覆盖默认阈值。

## 核心文件

| 文件 | 说明 |
|------|------|
| `handler.js` | write-report 主处理器：动作分发、门槛校验、报告状态更新 |
| `SKILL.md` | 工具能力与使用时机说明 |

## 关键概念

- **动作(action)**：create/direct/append/section/sections/update/patch/fill-section/full/get-content(read)/get-outline/get-findings(get-context)/get-source/review/submit(finalize)
- **分析门槛**：按 mode(quick/wider/deeper) 校验 iteration/readDocs/gaps；可由 `state.globalConfig.analysisGates` 覆盖；submit 强制拦截
- **前置条件**：待办完成率不足或发现数量不足时给警告；submit 阶段阻断提交
- **发现回顾**：`get-findings` 支持 type/keyword/minConfidence/limit 过滤，并返回 blackboard 摘要
- **引用溯源**：`get-source` 可列出可用源文档，支持 `start/maxLength` 截取原文
- **报告质量**：`reportTemplate` 定义必需章节与学术规范；`prepareReportForSubmit` 与 `getReportProgress` 做校验与进度提示
- **章节填充**：`fill-section` 按 `args.minWords` 或 `state.reportConfig.sectionWordLimits` 校验
- **变更历史**：`recordHistory` 记录最近 20 次修改并递增版本号
- **事件通知**：emit `deepsearch.report.generated`/`deepsearch.report.written`/`deepsearch.draft.*`/`deepsearch.section.*`/`deepsearch.report.submitted`

## 常见任务

- 追加内容：`action=append`，自动更新进度并避免重复追加
- 构建章节框架：`action=sections` + `action=fill-section`
- 更新或修补：`action=update` / `action=patch`
- 读取大纲或全文：`action=get-outline` / `action=get-content`
- 回顾发现与引用：`action=get-findings` / `action=get-source`
- 自动生成完整报告：`action=full`（基于 claims/evidence/todos/sources）
- 质量审查与提交：`action=review` 修复重复，`action=submit` 做最终验证
