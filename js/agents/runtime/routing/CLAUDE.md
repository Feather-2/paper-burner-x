# routing - 性能感知路由

## 模块描述

基于历史延迟与成功率的自适应路由器，按任务复杂度在 Fast/Power 层之间选择端点，并支持端点权重、过滤与统计查询。

## 核心文件

| 文件 | 职责 |
|------|------|
| `performance-router.js` | PerformanceRouter 路由器、EwmaTracker、任务复杂度估算 |

## 关键概念

| 概念 | 说明 |
|------|------|
| `EwmaTracker` | EWMA 延迟追踪，提供 ewma/min/max/count 统计 |
| `ModelTier` | `FAST` / `POWER` / `FALLBACK` 分层 |
| `TaskComplexity` | `SIMPLE` / `MODERATE` / `COMPLEX` 任务复杂度 |
| `EndpointStats` | 每端点延迟、成功率、权重与评分 |
| `score` | `(1 / (1 + latency/1000)) * successRate * weight` |
| `error penalty` | 失败时按 5000ms 惩罚延迟记入统计 |
| `preferFastTier` | SIMPLE 任务优先 FAST 层的开关 |
| `includeIds/excludeIds` | 路由选择的白/黑名单过滤 |
| `auto-register` | `recordResult` 在未知端点时自动创建统计项 |
| `onRouteDecision` | 路由决策回调，用于日志/遥测 |
| `latencyThresholdMs` | 预留阈值配置，当前不参与路由选择 |

## 常见任务

| 任务 | 接口 |
|------|------|
| 注册端点 | `registerEndpoint(id, { tier, weight })` |
| 记录成功/失败 | `recordResult(id, { success, latencyMs, error })` |
| 选择端点 | `selectEndpoint({ complexity, excludeIds, includeIds })` |
| 更新权重/层级 | `setWeight(id, weight)`, `setTier(id, tier)` |
| 查看统计 | `getEndpointStats(id)`, `getAllStats()`, `getRankedEndpoints()` |
| 复杂度估算 | `estimateComplexity(task)` |
| 重置/移除 | `resetStats()`, `removeEndpoint(id)` |
