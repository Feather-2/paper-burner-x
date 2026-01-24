# constants - 运行时常量

运行时公共常量与默认配置值，统一超时、阈值与数量限制的口径。

## 模块描述

为运行时各模块提供稳定的默认配置，并通过轻量访问器支持覆盖值。

- 模块路径：`js/agents/runtime/core/constants`

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 常量入口，统一导出 TIMEOUTS/LIMITS/THRESHOLDS 与访问器 |
| `timeouts.js` | 超时常量（毫秒）与 getTimeout() |
| `limits.js` | 数量/容量限制常量与 getLimit() |
| `thresholds.js` | 触发阈值常量（比例/计数/ms/评分等）与 getThreshold() |

## 关键概念

- **三类常量**: TIMEOUTS（ms）、LIMITS（数量/大小）、THRESHOLDS（触发阈值：比例/计数/ms/评分等）
- **按域分组**: 通过分组注释覆盖消息/Token/并发/重试/缓存/订阅/Worker/网络/进程/监控/熔断/限流/质量检测/内存等运行时配置
- **只读保护**: 使用 `Object.freeze` 固化常量对象
- **访问器策略**:
  - `getTimeout`/`getLimit` 仅接受正数覆盖值
  - `getThreshold` 接受任意有限数覆盖值（允许 0；不建议传入负数）
- **默认回退**:
  - `getTimeout` 回退 `30_000`
  - `getLimit` 回退 `100`
  - `getThreshold` 回退 `0.5`
- **单位约定**: TIMEOUTS 默认 ms；LIMITS/THRESHOLDS 必须在条目注释中注明单位（如 bytes、ms、rpm/tpm、count 等）

## 常见任务

获取默认超时或覆盖超时：

```javascript
import { getTimeout, TIMEOUTS } from 'js/agents/runtime/core/constants';

const timeout = getTimeout('LLM_CALL');
const custom = getTimeout('LLM_CALL', 150_000);
console.log(TIMEOUTS.LLM_CALL);
```

使用限制与阈值常量：

```javascript
import { getLimit, getThreshold } from 'js/agents/runtime/core/constants';

const maxParallel = getLimit('MAX_PARALLEL_TOOLS');
const compressRatio = getThreshold('COMPRESS_TOKEN_RATIO');
```

获取熔断/限流相关阈值：

```javascript
import { getThreshold } from 'js/agents/runtime/core/constants';

const errorCritical = getThreshold('ERROR_RATE_CRITICAL');
const rpm = getThreshold('RATE_LIMIT_RPM');
```

新增常量：

1. 在 `timeouts.js`/`limits.js`/`thresholds.js` 中添加条目（全大写下划线命名）
2. 在条目注释中写清语义与单位
3. 如需对外暴露，确保 `index.js` 已导出对应对象/访问器
