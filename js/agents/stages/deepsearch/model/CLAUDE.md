# deepsearch/model - 预算与定价模型

统一模型调用、用量统计与成本估算，并基于预算触发预警/超额事件。

## 核心文件

| 文件 | 职责 |
|------|------|
| `caller.js` | 构建模型调用适配器，兼容 `modelRouter.call` 与 `aiApiService.chat` |
| `usage.js` | 归一化各厂商用量为 `{ input, output, total }` |
| `pricing.js` | 解析模型价格配置，估算单次调用 USD 成本 |
| `budget.js` | 维护 `state.L2.budgetState` 并触发预算事件（新旧事件名兼容）；提供 `ensureBudgetState(state)` 初始化预算状态 |

## 关键概念

| 概念 | 说明 |
|------|------|
| BudgetState | `warnedTokens/warnedCost/exceededTokens/exceededCost` 防止重复报警 |
| ensureBudgetState | 确保 `state.L2` 与 `state.L2.budgetState` 存在且为 plain object，并填充默认值；当 `state` 非对象时返回 `null` |
| 预算事件 | 主要事件：`deepsearch:budgetWarning/deepsearch:budgetExceeded`；兼容旧事件：`deepsearch.budget.warning/deepsearch.budget.exceeded`。`reasons` 为 `tokens/cost`，payload 含 `budget/total/ratios`（`total.estimatedCostUSD` 为估算成本） |
| 预算配置 | `maxTokens/maxCostUSD/warnAt`，`warnAt` 默认 `0.8`，可附带 `action` 字段 |
| 预算比率 | `ratios.tokens/ratios.cost` 表示当前使用与上限的比率 |
| 价格匹配 | 先精确匹配模型 ID，再最长前缀匹配，最后 `*` 兜底 |
| 价格字段 | 支持 `input/output` 或 `inputPer1K/inputUsdPer1K` 等别名 |
| 标准用量 | 统一输入/输出/总量字段，缺失时自动补足 |
| 调用适配 | 兼容 `modelRouter.call` 新旧签名与 `aiApiService.chat`，自动注入系统提示、透传 AbortSignal 与 usage 标签 |

## 常见任务

| 任务 | 示例 |
|------|------|
| 初始化预算状态 | `const budgetState = ensureBudgetState(state); if (!budgetState) throw new Error('Invalid state');` |
| 构建模型调用器 | `const call = buildBaseCaller(stageApi, { usage: 'worker' });` |
| 归一化用量 | `const usage = normalizeTokenUsage(rawUsage);` |
| 估算成本 | `const delta = estimateCostUSDDelta({ model, usage, prices });` |
| 触发预算事件 | `emitBudgetEvents({ emit, state, budget, totalTokens, totalCostUSD });` |
