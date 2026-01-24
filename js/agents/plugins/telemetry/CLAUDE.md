# telemetry - 遥测和追踪

运行时状态、Token 追踪、分布式追踪和回放。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | Telemetry 模块公共导出入口 |
| `token-tracker.js` | TokenTracker - Token 使用统计 |
| `trace-context.js` | TraceContext - 分布式追踪 (OpenTelemetry 兼容) |
| `loop-runtime-state.js` | LoopRuntimeState - 运行时状态管理 |
| `replay-controller.js` | RunReplayController - 运行回放 |
| `runstore-telemetry.js` | RunStore 遥测订阅 |

## 模块导出

`index.js` 聚合导出：

- Token: `TokenTracker`, `getGlobalTokenTracker`, `trackTokenUsage`, `getTokenUsageSummary`, `exportTokenUsageJson`, `exportTokenUsageCsv`
- Tracing: `TraceContext`, `Span`, `SpanStatus`, `SpanKind`, `parseTraceparent`
- Runtime State: `LoopRuntimeState`, `LoopRuntimeStatuses`, `LOOP_RUNTIME_TRANSITIONS`, `getRuntimeState`, `setRuntimeState`, `ensureRuntimeState`, `clearRuntimeState`
- Replay/Storage: `RunReplayController`, `subscribeTelemetry`

## TokenTracker

```javascript
import { TokenTracker } from 'js/agents/runtime';

const tracker = new TokenTracker({ maxRecords: 500 });

tracker.record({
  model: 'gpt-4o',
  provider: 'openai',
  usage: 'worker',
  promptTokens: 1500,
  completionTokens: 800,
  latencyMs: 1200,
  success: true,
});

const summary = tracker.getSummary();
console.log(summary.totalTokens); // 2300
```

全局/快捷 API（同样从本模块导出）：

- `getGlobalTokenTracker`：获取全局 TokenTracker 实例
- `trackTokenUsage`：记录一次 Token 使用（对 `record` 的封装）
- `getTokenUsageSummary`：获取聚合摘要
- `exportTokenUsageJson` / `exportTokenUsageCsv`：导出用量数据

## TraceContext

OpenTelemetry 兼容的分布式追踪与 W3C `traceparent` 解析：

```javascript
import { TraceContext, SpanKind, SpanStatus, parseTraceparent } from 'js/agents/runtime';

const ctx = new TraceContext();

// 解析 W3C traceparent（例如来自 HTTP 头部）
const parsed = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
console.log(parsed);

// Span 的创建/结束与属性设置 API 以 `trace-context.js` 的实现与 JSDoc 为准；
// 这里通常会结合 `SpanKind` / `SpanStatus` 来标记客户端/服务端调用与状态。
```

还提供：

- `parseTraceparent`：解析 W3C `traceparent` 头部
- `Span` / `SpanKind` / `SpanStatus`：Span 基础类型与枚举

## LoopRuntimeState

运行时状态常量与状态机迁移表（按 signal/context 维护）：

```javascript
import {
  LoopRuntimeStatuses,
  LOOP_RUNTIME_TRANSITIONS,
  ensureRuntimeState,
  getRuntimeState,
  setRuntimeState,
  clearRuntimeState,
} from 'js/agents/runtime';

const signal = new AbortController().signal;

// 确保该 signal 对应的状态存在（默认 idle）
ensureRuntimeState(signal);

// 更新状态（cursor 支持 string/array/object，详见实现）
setRuntimeState(signal, { status: LoopRuntimeStatuses.RUNNING, cursor: 'step:1' });

const state = getRuntimeState(signal);
console.log(state?.status); // 'running'

// 查看允许的状态迁移
console.log(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.RUNNING]);
// => ['paused', 'completed', 'failed', 'cancelled']

clearRuntimeState(signal);
```

## RunReplayController

运行回放控制器：从 `runStore.getEvents(runId)` 拉取事件并按序回放/定位（具体方法以类的 JSDoc 为准）。

```javascript
import { RunReplayController } from 'js/agents/runtime';

const replay = new RunReplayController({
  runStore: {
    async getEvents(runId) {
      // ReplayEvent = Record<string, unknown>
      return [{ seq: 1, type: 'agent:step', ts: Date.now() }];
    },
  },
});
```

## subscribeTelemetry

RunStore 遥测订阅入口（签名与回调数据结构以 `runstore-telemetry.js` 的实现与 JSDoc 为准）。
