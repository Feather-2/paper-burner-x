# errors - 运行时错误采样与聚合

为被 catch 吞掉或可恢复错误提供统一的采样、指纹归一、自动分类与按指纹聚合能力，便于运行时监控与排障。

> **文件统计**: 5 个 JS 文件

## 模块描述

`runtime/core/errors` 由两层能力组成：

1. **采样层（Silent Reporter）**：记录静默错误样本，提供 ring buffer、统计、导出、开关控制。
2. **聚合层（Fingerprint + Taxonomy + Aggregator）**：将错误按稳定指纹聚合，并给出 taxonomy/retryable 判定。

## 核心文件

| 文件 | 职责 |
|------|------|
| `silent-error-reporter.js` | `SilentErrorReporter`：静默错误采样、分类计数、ring buffer、导出 |
| `error-fingerprint.js` | 规范化 message/stack 并生成稳定错误指纹 |
| `error-taxonomy.js` | 基于 name/code/message/status 的错误分类与重试属性判定 |
| `error-aggregator.js` | 按指纹聚合统计，维护最近 1h 频次与受影响 run |
| `index.js` | 模块出口：导出 reporter、分类枚举、聚合器与便捷方法 |

## 关键概念

- **SilentErrorReporter**: 通过 `report()`、`getStats()`、`export()`、`getRecent()`、`clear()` 等接口收集静默错误。
- **ErrorCategory**: `RECOVERABLE` / `DEGRADED` / `CRITICAL`。
- **ErrorTaxonomy**: `retryable`、`non_retryable`、`external_dependency`、`input_validation`、`timeout`、`resource_exhaustion`、`internal`、`unknown`。
- **Error Fingerprint**: 使用 `name + normalize(message) + stack top frames` 计算稳定哈希，自动去除 UUID/时间戳/路径/长数字 ID。
- **ErrorAggregator**: `record(error, { runId })` 返回 `{ fingerprint, taxonomy, retryable, count }`；单指纹维护 `count`、`firstSeen`、`lastSeen`、`timestamps`、`affectedRuns`、`sample`。

## 配置选项

- **采样层**
  - `enabled`: 默认 `true`
  - `maxSamples`: 默认 `100`
  - `onError`: 每次采样回调
- **聚合层**
  - `ONE_HOUR_MS`: `3600_000`
  - `MAX_FINGERPRINTS`: `1000`（超限淘汰 `lastSeen` 最旧项）

## 常见任务

```javascript
import { reportSilentError, ErrorCategory } from 'js/agents/runtime/core/errors';

try {
  await maybeFail();
} catch (error) {
  reportSilentError(error, 'ToolExecutor.runTool', ErrorCategory.DEGRADED);
}
```

```javascript
import { ErrorAggregator } from 'js/agents/runtime/core/errors/error-aggregator.js';

const aggregator = new ErrorAggregator();
const summary = aggregator.record(error, { runId: 'run-42' });
// { fingerprint, taxonomy, retryable, count }
```

```javascript
import { computeErrorFingerprint } from 'js/agents/runtime/core/errors/error-fingerprint.js';
import { classifyError } from 'js/agents/runtime/core/errors/error-taxonomy.js';

const fingerprint = computeErrorFingerprint(error);
const { taxonomy, retryable } = classifyError(error);
```

## 设计注意事项

- 指纹用于根因聚合，不是唯一错误 ID。
- taxonomy 用于重试/降级策略，不替代业务错误码。
- 导出前应对 `message`、`stack`、`sample` 做脱敏处理。