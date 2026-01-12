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
import { TokenTracker } from 'js/agents/runtime/telemetry';

const tracker = new TokenTracker();
tracker.add('input', 1500);
tracker.add('output', 800);

console.log(tracker.total);      // 2300
console.log(tracker.breakdown);  // { input: 1500, output: 800 }
```

## TraceContext

OpenTelemetry 兼容的分布式追踪：

```javascript
import { TraceContext, withSpan, SpanKind } from 'js/agents/runtime/telemetry';

const ctx = new TraceContext({ serviceName: 'agent' });

await withSpan(ctx, 'llm-call', async (span) => {
  span.setAttribute('model', 'gpt-4o');
  const result = await llm.complete(messages);
  span.setStatus(SpanStatus.OK);
  return result;
}, { kind: SpanKind.CLIENT });
```

## RunReplayController

运行记录回放：

```javascript
import { RunReplayController } from 'js/agents/runtime/telemetry';

const replay = new RunReplayController(runStore);
await replay.load(runId);

for await (const event of replay.events()) {
  console.log(event.type, event.timestamp);
}
```
