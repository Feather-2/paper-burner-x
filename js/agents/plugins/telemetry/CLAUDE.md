# telemetry - 遥测和追踪

运行时状态、Token 追踪、分布式追踪和回放。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | Telemetry 模块公共导出入口 |
| `token-tracker.js` | TokenTracker - Token 使用统计 |
| `trace-context.js` | TraceContext - 分布式追踪 (OpenTelemetry 兼容) |
| `loop-runtime-state.js` | 运行时状态管理 |
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

OpenTelemetry 兼容的分布式追踪：

```javascript
import { TraceContext, withSpan, SpanKind, SpanStatus } from 'js/agents/runtime';

const ctx = new TraceContext();

await withSpan(ctx, 'llm-call', async (span) => {
  span?.setAttribute('model', 'gpt-4o');
  const result = await llm.complete(messages);
  span?.setStatus(SpanStatus.OK);
  return result;
}, { kind: SpanKind.CLIENT });
```

还提供：

- `parseTraceparent`：解析 W3C `traceparent` 头部
- `Span` / `SpanKind` / `SpanStatus`：Span 基础类型与枚举

## LoopRuntimeState

运行时状态常量与状态机迁移表：

```javascript
import { LoopRuntimeStatuses, LOOP_RUNTIME_TRANSITIONS } from 'js/agents/runtime';

const canPause = LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.RUNNING]
  .includes(LoopRuntimeStatuses.PAUSED);

console.log(canPause); // true
```

状态存取相关方法同样从本模块导出：`getRuntimeState`, `setRuntimeState`, `ensureRuntimeState`, `clearRuntimeState`。

## RunReplayController

运行记录回放：

```javascript
import { RunReplayController } from 'js/agents/runtime';

const replay = new RunReplayController({ runStore, eventBus, speed: 1 });
await replay.load(runId);

replay.play();
// replay.pause();
// replay.step();

console.log(replay.state.status); // playing
```

## RunStore Telemetry

将 EventBus 遥测写入 RunStore，并在内存中聚合 timeline/todos：

```javascript
import { subscribeTelemetry } from 'js/agents/runtime';

const { timeline, todos, flush, snapshot, unsubscribe } =
  subscribeTelemetry(eventBus, runStore, { maxTimelineEntries: 2000 });

await flush();
... (16 more lines)
```