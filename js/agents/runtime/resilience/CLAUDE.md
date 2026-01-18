# resilience - 运行时降级与弹性

多级降级矩阵，根据错误率/延迟/内存指标自动调整运行级别，并通过策略开关功能。

> **文件统计**: 1 个 JS 文件

## 模块描述

`runtime/resilience` 提供 `DegradationMatrix` 与 `DegradationPolicy`，用于在运行时根据健康指标与手动覆盖，切换 Normal/Degraded/Critical/Offline 级别，并输出可用功能与降级建议。

## 核心文件

| 文件 | 职责 |
|------|------|
| `degradation-matrix.js` | OperationLevel/DegradationTrigger 枚举、DegradationPolicy、HealthMetrics、DegradationMatrix |

## 关键概念

- **OperationLevel**: `normal`/`degraded`/`critical`/`offline` 四级。
- **DegradationTrigger**: 错误率、延迟、内存、配额、超时、手动触发类型。
- **DegradationPolicy**: 阈值与各级别功能开关，支持覆盖默认配置。
- **HealthMetrics**: 统计窗口内请求数、错误率、平均/99 延迟。
- **DegradationMatrix**: 记录请求、评估级别、触发回调、输出状态/建议、支持手动覆盖。

## 常见任务

```javascript
import { DegradationMatrix } from 'js/agents/runtime/resilience/degradation-matrix.js';

const matrix = new DegradationMatrix({
  onLevelChange: ({ from, to, trigger }) => {
    console.log('level change', { from, to, trigger });
  },
  getMemoryUsage: () =>
    process.memoryUsage().heapUsed / process.memoryUsage().heapTotal,
});

// 每次请求后记录结果
matrix.recordRequest({ latencyMs: 350, isError: false });

if (!matrix.isFeatureEnabled('externalApis')) {
  // 降级时禁用外部 API
}
```

```javascript
import {
  DegradationMatrix,
  DegradationPolicy,
  OperationLevel,
} from 'js/agents/runtime/resilience/degradation-matrix.js';

const policy = new DegradationPolicy({
  thresholds: { errorRateDegraded: 0.05, latencyCriticalMs: 3000 },
});

const matrix = new DegradationMatrix({ policy });

// 手动降级 / 恢复
matrix.setManualOverride(OperationLevel.CRITICAL);
matrix.clearManualOverride();

// 查看状态与建议
const status = matrix.getStatus();
const recommendations = matrix.getRecommendations();
```
