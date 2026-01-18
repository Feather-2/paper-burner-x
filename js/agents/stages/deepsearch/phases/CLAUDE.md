# phases - 深度搜索阶段流程

规划 -> 执行 -> 写作的三段流程实现，驱动 DeepSearch 每轮迭代与报告收敛。

## 模块描述

在 DeepSearch 运行中，负责构建 system prompt（工具/模式/子代理与可选 Skills catalog）、注入临时上下文（shadow/blackboard/memory/budget/reminder/convergence），解析模型决策并执行工具调用，同时在预算耗尽或完成时触发写作阶段生成报告，并在 watchdog handoff 时支持回溯。

## 核心文件

| 文件 | 职责 |
|------|------|
| `planning-phase.js` | 组合 system prompt（core/mode/subagents + skills catalog），注入 shadow/黑板/记忆/预算/提醒/收敛，解析决策与收敛追踪 |
| `execution-phase.js` | 执行单个或批量工具调用，持久化输出与 checkpoint，处理 watchdog handoff/backtrack |
| `writing-phase.js` | 写作阶段判断与运行，确保 complete 时有报告 |

## 关键概念

- **DeepSearchDecision**: `action/args` 或 `actions[]` 批量工具决策。
- **System Prompt 模块**: `system-core` + `mode` + `system-subagents` 拼装，缺失时回退到 fallback。
- **Skills Catalog 注入**: `SkillsManager.getCatalogPrompt` 按需注入技能目录。
- **Shadow 注入**: `shadow.getInjectedPrompt` 在每轮以 ephemeral 方式注入提醒。
- **Ephemeral 注入**: `blackboard/memory/budget/reminder/convergence` 标签的临时提示，只作用于当前轮。
- **Gap 收敛策略**: `getGapConvergencePolicy` 控制 gap 数量与“无进展”阈值。
- **迭代收敛追踪**: `createIterationConvergenceTracker` 统计 claims/gaps/todos 并发出 completed 事件。
- **LoopGuard**: `_recordToolCall` 检测重复工具调用并生成提示。
- **Checkpoint/持久化**: `maybeSaveCheckpoint` + `maybePersistToolOutput` 记录结果与副作用游标。
- **回溯/Hand off**: tool 返回 `mode: "handoff"` 时由 `backtrackManager` 回滚状态。
- **写作阶段**: `WritingPhaseHandler` 进入/执行写作循环，`ensureReportOnComplete` 补写报告。

## 常见任务

- 注入初始提示与预算信息：`addInitialDeepSearchMessages`
- 运行单轮规划并解析决策：`runPlanningPhaseIteration`
- 执行工具（单个/批量）：`executeDeepSearchDecision`
- 预算耗尽时触发写作：`runWritingPhaseIfNeeded`
- 完成前确保报告存在：`ensureReportOnComplete`