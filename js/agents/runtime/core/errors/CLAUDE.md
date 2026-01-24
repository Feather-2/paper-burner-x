# errors - 运行时静默错误收集

为被 catch 吞掉的错误提供统一的收集、分类、采样与导出能力，便于运行时监控与排障。

> **文件统计**: 2 个 JS 文件

## 模块描述

`runtime/errors` 聚焦于“静默错误”场景：在不打断流程的前提下记录错误上下文与样本。提供分类枚举、统计信息与导出能力，并支持全局单例、按模块的 scoped reporter，以及启用/禁用控制。

## 核心文件

| 文件 | 职责 |
|------|------|
| `silent-error-reporter.js` | `SilentErrorReporter` 实现：采样、统计、导出、ring buffer、开关控制 |
| `index.js` | 模块出口：导出 Reporter、分类与便捷方法 |

## 关键概念

- **SilentErrorReporter**: 收集错误样本，支持 `enabled`、`maxSamples`、`onError` 回调；提供 `report()`、`getStats()`、`export()`、`getRecent()`、`clear()`、`size`、`setEnabled()` / `isEnabled()`。
- **ErrorCategory**: `RECOVERABLE` / `DEGRADED` / `CRITICAL` 三类，用于分类统计（其值分别为 `'recoverable'` / `'degraded'` / `'critical'`）。
- **ErrorEntry**: 单条错误样本：
  - `message?`: 错误消息
  - `stack?`: 截断后的堆栈（前 3 行）
  - `location`: 来源标识（建议使用 `Domain.Component` 或 `Module.fn`）
  - `category`: 分类（建议来自 `ErrorCategory`）
  - `operation?`: 当前操作名（如 `runTool`）
  - `ts`: 时间戳
- **ErrorStats**: 统计汇总（`getStats()` 返回）：
  - `total`: 总错误数
  - `byCategory`: 按分类计数
  - `byLocation`: 按来源计数
- **silentErrors**: 全局单例，用于统一收集。
- **reportSilentError / createScopedReporter**: 快捷函数与按模块前缀的 reporter。

## 配置选项

- `enabled`: 是否启用收集（默认 `true`）。
- `maxSamples`: 最大样本数（默认 `100`）。
- `onError`: 每次采样触发的回调（用于上报/聚合）。

## 常见任务

```javascript
import { reportSilentError, ErrorCategory } from 'js/agents/runtime/errors';

try {
  await maybeFail();
} catch (error) {
  reportSilentError(error, 'MessageManager.compress', ErrorCategory.DEGRADED);
}
```

```javascript
import { createScopedReporter } from 'js/agents/runtime/errors';

const reporter = createScopedReporter('ToolExecutor');
reporter.report(error, 'runTool');
```

```javascript
import { silentErrors } from 'js/agents/runtime/errors';

silentErrors.setEnabled(false);
silentErrors.clear();
const count = silentErrors.size;
```
