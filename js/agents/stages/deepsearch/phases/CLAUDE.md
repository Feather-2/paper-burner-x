# phases - 深度搜索阶段流程

规划 -> 执行 -> 写作的三段流程实现，驱动 DeepSearch 每轮迭代与报告收敛。

## 模块描述

在 DeepSearch 运行中，负责构建 system prompt（system-core/mode/subagents + 工具目录/可选 catalog）、注入临时上下文（shadow/blackboard/memory/budget/reminder/convergence），对来自 UI/配置的 mode 与目标输入做基础校验与裁剪（含长度上限与数值规范化），调用模型并解析决策与收敛信号，随后执行工具调用（含默认超时、输出持久化与 checkpoint），并在预算耗尽或完成/切换阈值满足时触发写作阶段生成报告；在 watchdog handoff 时支持回溯。

## 核心文件

| 文件 | 职责 |
|------|------|
| `planning-phase.js` | 规划阶段主流程：拼装 prompt、注入上下文、调用模型、解析决策与收敛信号 |
| `planning-phase-helpers.js` | 规划辅助与常量：输入清洗、mode 解析、阈值常量、`createModelSignal` 超时与信号桥接 |
| `execution-phase.js` | 执行单个或批量工具调用（含默认超时）、安全序列化/持久化输出与 checkpoint，处理 watchdog handoff/backtrack |
| `writing-phase.js` | 写作阶段判断与运行，确保 complete 时有报告 |

## 关键概念

- **DeepSearchDecision**: `action/args` 或 `actions[]` 批量工具决策。
- **System Prompt 模块**: `system-core` + `mode` + `system-subagents` 拼装，缺失时回退到 fallback。
- **Tool Catalog 注入**: `getToolCatalogPrompt` 生成工具目录提示，供模型选择可调用工具。
- **输入约束**: `sanitizePromptInput` 对 UI 输入做 trim/压缩空白/长度裁剪；`MAX_TASK_GOAL_LEN`、`MAX_MODE_DESC_LEN` 控制截断上限。
- **模式解析**: `resolveModeDescription` 基于 `ALLOWED_MODES` 与 fallback 解析 quick/wider/deeper，非法值回退到 `wider`。
- **模式与最小 findings**: `DEFAULT_MIN_FINDINGS_BY_MODE` 控制不同模式下的最低 findings 目标。
- **Shadow 注入**: `shadow.getInjectedPrompt` 在每轮以 ephemeral 方式注入提醒。
- **Ephemeral 注入**: `blackboard/memory/budget/reminder/convergence` 标签的临时提示，只作用于当前轮（标签由 `EPHEMERAL_TAG` 统一维护）。
- **Reminder 策略**: `REMINDER_AFTER_ITERATION` 后开始注入 todo 提醒，`REMINDER_MAX_TODOS` 控制数量，`REMINDER_TAIL` 强化不要跳过待办直接写报告。
- **写作切换阈值**: `WRITE_PHASE_CUTOFF_RATIO` 控制在预算消耗达到一定比例时允许/倾向切换写作阶段。
- **模型调用超时**: `DEFAULT_MODEL_TIMEOUT_MS` + `createModelSignal` 生成带超时的 `AbortSignal`，并桥接父级 `stageApi.signal`，结束后执行 cleanup 清理监听器/计时器。
- **工具调用超时**: `DEFAULT_TOOL_TIMEOUT_MS` + `withTimeout` 为单次工具调用设置上限，避免阶段被长调用卡住（当前为超时 reject，底层工具需配合 `AbortSignal` 才能真正中止）。
- **安全序列化**: `safeStringify` 用于持久化/日志，处理 BigInt 与 Circular，避免 `JSON.stringify` 崩溃。
- **事件与观测**: `DeepSearchEvents` 贯穿规划/执行/写作阶段，用于上报关键事件（决策、工具调用、收敛信号等），支撑调试与回放。
- **Gap 收敛策略**: `getGapConvergencePolicy` 控制 gap 数量与无进展阈值。