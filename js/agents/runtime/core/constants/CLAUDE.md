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
| `thresholds.js` | 触发阈值常量与 getThreshold() |

## 关键概念

- **三类常量**: TIMEOUTS（ms）、LIMITS（数量/大小）、THRESHOLDS（比例/评分）
- **按域分组**: 通过分组注释覆盖消息/Token/并发/重试/缓存/订阅/历史日志等运行时配置
- **只读保护**: 使用 `Object.freeze` 固化常量对象
- **访问器策略**:
  - `getTimeout`/`getLimit` 仅接受正数覆盖值
  - `getThreshold` 接受任意有限数覆盖值（允许 0）
- **默认回退**:
  - `getTimeout` 回退 `30_000`
  - `getLimit` 回退 `100`
  - `getThreshold` 回退 `0.5`

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

新增常量：

1. 在 `timeouts.js`/`limits.js`/`thresholds.js` 中添加条目（全大写下划线命名）
2. 如需对外暴露，确保 `index.js` 已导出对应对象/访问器
