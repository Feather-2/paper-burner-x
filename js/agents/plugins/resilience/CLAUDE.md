# resilience - 运行容错与降级

运行时降级矩阵 + ServiceBus 自动重试。

> **文件统计**: 2 个 JS 文件

## 模块描述

`plugins/resilience` 提供两类韧性能力：`degradation-matrix` 用于根据错误率/延迟/内存等指标自动调整运行级别并给出可用功能集；`retry` 插件为 ServiceBus 增加可配置的重试与统计/事件通知。

## 核心文件

| 文件 | 职责 |
|------|------|
| `degradation-matrix.js` | DegradationMatrix/DegradationPolicy - 降级策略与运行级别评估（含默认阈值、触发器枚举与日志） |
| `retry.js` | retry 插件 - 服务调用重试、事件上报与统计 |

## 关键概念

- **OperationLevel**: `normal/degraded/critical/offline` 四级运行状态（`offline` 通常用于手动/极端降级或完全停用外部能力）。
- **DegradationTrigger**: `error_rate/latency/memory/quota/timeout/manual` 触发源（启用哪些触发器取决于具体评估实现）。
- **默认阈值 (DEFAULT_THRESHOLDS)**:
  - `errorRateDegraded`: `0.1`
  - `errorRateCritical`: `0.3`
  - `latencyDegradedMs`: `2000`
  - `latencyCriticalMs`: `5000`
  - `memoryDegradedRatio`: `0.7`
  - `memoryCriticalRatio`: `0.9`
- **DegradationPolicy**: 通过 `thresholds` 和 `features` 定义降级阈值与可用能力（如 `externalApis`, `backgroundTasks`）。
- **HealthMetrics**: 基于时间窗口统计请求数、错误率、平均延迟、P99 延迟（常见默认 60s，具体以实现/参数为准）。
- **手动覆盖**: `setManualOverride/clearManualOverride` 可强制运行级别并触发评估。
- **状态与建议**: `getStatus` 提供当前级别/触发器/最近变更，`getRecommendations` 输出建议。
- **日志**: `degradation-matrix` 使用 `createLogger(\"runtime/resilience/degradation-matrix\")` 输出诊断日志。
- **Retry 插件**: `maxRetries/baseDelay/retryableErrors` 控制重试策略；除错误码外，也会对 `error.status === 429` 与 `5xx` 进行重试判定（取决于错误对象字段）。

## 常见任务

```javascript
import DegradationMatrix, {
  DegradationPolicy,
  OperationLevel,
} from 'js/agents/plugins/resilience/degradation-matrix.js';

const policy = new DegradationPolicy({
  thresholds: { errorRateDegraded: 0.2, latencyCriticalMs: 8000 },
});

const matrix = new DegradationMatrix({
  policy,
  getMemoryUsage: () => 0.65,
  onLevelChange: (info) => console.warn('level changed', info),
});

matrix.recordRequest({ latencyMs: 1200, isError: false });

if (!matrix.isFeatureEnabled('externalApis')) {
  // fallback logic
}

matrix.setManualOverride(OperationLevel.DEGRADED);
```

```javascript
// Retry 插件的集成方式取决于项目的 Plugin/Kernel 框架；下面示例仅展示配置形状。
import retryPlugin from 'js/agents/plugins/resilience/retry.js';

const config = {
  maxRetries: 5,
  baseDelay: 500,
  retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT'],
};

// 伪代码：按项目实际插件系统替换
// kernel.use(retryPlugin, config);
```
