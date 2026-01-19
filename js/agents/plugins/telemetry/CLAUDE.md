# telemetry - 遥测和追踪

运行时状态、Token 追踪、分布式追踪和回放。

## 核心文件

| 文件 | 职责 |
|------|------|
| `token-tracker.js` | TokenTracker - Token 使用统计 |
| `trace-context.js` | TraceContext - 分布式追踪 (OpenTelemetry 兼容) |
| `loop-runtime-state.js` | 运行时状态管理 |
| `replay-controller.js` | RunReplayController - 运行回放 |
| `runstore-telemetry.js` | RunStore 遥测订阅 |

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
unsubscribe();
```

## LoopRuntimeState

运行时状态跟踪：

```javascript
import { getRuntimeState, setRuntimeState } from 'js/agents/runtime';

const state = setRuntimeState(signal, { status: 'running' });
state.transitionTo('paused');

const current = getRuntimeState(signal);
```
