# telemetry - 遥测和追踪

运行时状态、Token/成本追踪、分布式追踪和回放。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | Telemetry 模块公共导出入口 |
| `token-tracker.js` | TokenTracker - Token 使用统计与导出 |
| `cost-aggregator.js` | CostAggregator - 跨 Agent Token 汇总与 EventBus 集成 |
| `cost-formatter.js` | Cost 格式化工具（Token/延迟/汇总/表格） |
| `trace-context.js` | TraceContext - 分布式追踪（OpenTelemetry 兼容） |
| `loop-runtime-state.js` | LoopRuntimeState - 运行时状态管理 |
| `replay-controller.js` | RunReplayController - 运行回放 |
| `runstore-telemetry.js` | RunStore 遥测订阅 |

## 模块导出

`index.js` 聚合导出：

- Token: `TokenTracker`, `getGlobalTokenTracker`, `trackTokenUsage`, `getTokenUsageSummary`, `exportTokenUsageJson`, `exportTokenUsageCsv`
- Cost: `CostAggregator`, `formatTokenCount`, `formatLatency`, `formatCostSummary`, `formatBreakdownTable`, `formatAgentReport`, `calculateCostEstimate`
- Tracing: `TraceContext`, `Span`, `SpanStatus`, `SpanKind`, `parseTraceparent`
- Runtime State: `LoopRuntimeState`, `LoopRuntimeStatuses`, `LOOP_RUNTIME_TRANSITIONS`, `getRuntimeState`, `setRuntimeState`, `ensureRuntimeState`, `clearRuntimeState`
- Replay/Storage: `RunReplayController`, `subscribeTelemetry`

## TokenTracker

```javascript
import { TokenTracker } from 'js/agents/plugins/telemetry';

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

## CostAggregator

用于跨 Agent/Stage 的轻量汇总（纯内存），与 TokenTracker 互补：

```javascript
import {
  CostAggregator,
  formatCostSummary,
  formatBreakdownTable,
} from 'js/agents/plugins/telemetry';

const aggregator = new CostAggregator({ eventBus });

aggregator.recordUsage('planner', {
  promptTokens: 1200,
  completionTokens: 600,
  latencyMs: 950,
  success: true,
  provider: 'openai',
  model: 'gpt-4o-mini',
});

const total = aggregator.getTotalCost();
console.log(formatCostSummary(total));

const breakdown = aggregator.getBreakdown();
console.log(formatBreakdownTable(breakdown));
```

主要 API：

- `recordUsage(agentId, usage)`：记录单次调用
- `getAgentCost(agentId)`：查询单 Agent 汇总
- `getTotalCost()`：查询全局汇总
- `getBreakdown()`：获取按 Agent 分组报表
- `getSnapshot()` / `restore(snapshot)`：快照与恢复
- `dispose()`：释放 EventBus 订阅

EventBus 集成：

- 当前实现监听 `llm.complete` 事件，自动提取 `payload`/事件对象中的 token 字段并写入聚合器

## Cost 格式化（cost-formatter）

提供 UI/日志友好的格式化能力：

- `formatTokenCount(n)`：Token 数量缩写（K/M/B/T）
- `formatLatency(ms)`：延迟显示（ms/s/hm）
- `formatCostSummary(total)`：总览摘要文本
- `formatBreakdownTable(rows)`：分组表格文本
- `formatAgentReport(agent)`：单 Agent 报告
- `calculateCostEstimate(usage, pricing)`：费用估算

```javascript
import { formatTokenCount, formatLatency } from 'js/agents/plugins/telemetry';

console.log(formatTokenCount(15320)); // 15.3K
console.log(formatLatency(1250));     // 1.3s
```

## TraceContext

OpenTelemetry 兼容的分布式追踪与 W3C `traceparent` 解析：

```javascript
import {
  TraceContext,
  SpanKind,
  SpanStatus,
  parseTraceparent,
} from 'js/agents/plugins/telemetry';

const trace = new TraceContext();
const parsed = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
console.log(parsed.traceId);
```

还提供：

- `Span`：Span 生命周期与属性管理
- `SpanKind`：客户端/服务端等 Span 类型
- `SpanStatus`：执行状态标记

## Runtime State

`LoopRuntimeState` 管理 Agent Loop 状态流转，配套导出：

- `LoopRuntimeStatuses`
- `LOOP_RUNTIME_TRANSITIONS`
- `getRuntimeState`, `setRuntimeState`, `ensureRuntimeState`, `clearRuntimeState`

## Replay / RunStore 遥测

- `RunReplayController`：按运行记录进行回放控制
- `subscribeTelemetry`：订阅 RunStore 事件并转发为遥测流

## 设计边界

- `TokenTracker`：保留调用明细，支持导出
- `CostAggregator`：聚合统计与报告，不做预算裁决
- `BudgetManager`（外部模块）：负责限额与策略控制
