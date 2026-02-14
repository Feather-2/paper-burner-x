# constants - 运行时常量

运行时公共常量与默认配置值，统一超时、阈值与数量限制的口径。

## 模块描述

为 runtime/core 各子模块提供稳定默认配置，并通过轻量访问器支持覆盖值。

- 模块路径：`js/agents/runtime/core/constants`

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 常量入口，统一导出 `TIMEOUTS` / `LIMITS` / `THRESHOLDS` 与访问器 |
| `timeouts.js` | 超时常量（毫秒）与 `getTimeout()` |
| `limits.js` | 数量/容量限制常量与 `getLimit()` |
| `thresholds.js` | 触发阈值常量（比例/计数/ms/评分等）与 `getThreshold()` |

## 关键概念

- **三类常量**: `TIMEOUTS`（ms）、`LIMITS`（数量/容量）、`THRESHOLDS`（触发阈值）
- **按域分组**: 覆盖消息/历史、Token、并发、重试、缓存、订阅、日志、Worker、网络、进程、定时任务、监控/压缩、熔断、限流、质量检测、内存、L2→L3 迁移
- **只读保护**: 使用 `Object.freeze` 固化常量对象，避免运行时意外篡改
- **访问器策略**:
  - `getTimeout` / `getLimit` 仅接受正数覆盖值
  - `getThreshold` 接受有限数值覆盖（允许 `0`）
  - 非法覆盖或缺失键名时回退到访问器内置默认值
- **单位约定**: `TIMEOUTS` 默认单位为 ms；`LIMITS`/`THRESHOLDS` 必须在条目注释中注明单位（如 bytes、rpm/tpm、count）
- **分层治理**: 内存与上下文相关阈值用于 L1/L2/L3 缓存回收、压缩和迁移触发

## 常见任务

获取默认超时或覆盖超时：

```javascript
import { getTimeout, TIMEOUTS } from 'js/agents/runtime/core/constants';

const timeout = getTimeout('LLM_CALL');
const custom = getTimeout('LLM_CALL', 150_000);
const toolMax = getTimeout('TOOL_EXECUTION_MAX');
console.log(TIMEOUTS.LLM_CALL);
```

使用限制与阈值常量：

```javascript
import { getLimit, getThreshold } from 'js/agents/runtime/core/constants';

const maxParallel = getLimit('MAX_PARALLEL_TOOLS');
const maxSubAgents = getLimit('MAX_PARALLEL_SUBAGENTS');
const compressRatio = getThreshold('COMPRESS_TOKEN_RATIO');
const memoryWarn = getThreshold('MEMORY_WARN_RATIO');
```

获取熔断/限流相关阈值：

```javascript
import { getThreshold } from 'js/agents/runtime/core/constants';

const errorCritical = getThreshold('ERROR_RATE_CRITICAL');
const rpm = getThreshold('RATE_LIMIT_RPM');
const circuitFailures = getThreshold('CIRCUIT_FAILURE_COUNT');
```

## 新增常量规范

1. 在 `timeouts.js` / `limits.js` / `thresholds.js` 中添加条目（全大写下划线命名）
2. 在条目注释中写清语义与单位
3. 若为边界值，优先成对提供软/硬阈值（如 warn/critical、default/max）
4. 如需对外暴露，确保 `index.js` 已导出对应对象/访问器
5. 新增与工具执行、并发、内存相关常量时，补充对应测试用例（边界值与异常输入）