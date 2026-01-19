# context - 运行时上下文

统一上下文门面、子 Agent 预算与快照协议，收敛状态访问与持久化入口。

> **文件统计**: 3 个 JS 文件

## 模块概览

`runtime/context` 提供 UnifiedAgentContext 统一管理 DeepSearchState/MemoryStore/SharedContext，配套子 Agent 预算分配与 Snapshotable 快照协议，确保上下文读写与 checkpoint 行为一致。

## 核心文件

| 文件 | 职责 |
|------|------|
| `unified-agent-context.js` | UnifiedAgentContext：统一状态门面、读写入口、checkpoint save/restore |
| `subagent-budget.js` | SubagentBudgetManager：子 Agent 预算分配、使用记录与回收 |
| `snapshotable.js` | Snapshotable 协议 + `isSnapshotable`/`assertSnapshotable` 运行时守卫 |

## 关键概念

- **UnifiedAgentContext**: 纯只读 getter + 显式 set/add，避免 getter 触发写入副作用。
- **SSOT 绑定**: `bind({ state, memory, sharedContext })` 尝试让 DeepSearchState 与 MemoryStore 共享 todos，并同步 SharedContext。
- **Checkpoint**: `saveCheckpoint()` 优先走 state.saveCheckpoint/toSnapshot；memory 支持 `incremental/includeMemoryL3`；sharedContext 使用 serialize/deserialize。
- **Signals/Decisions**: 通过 SharedContext 记录跨阶段信号与决策。
- **Memory 2.0**: scratchpad 与反馈标志（`awaitUserFeedback`/`taskImpossible`）作为轻量上下文状态。
- **SubagentBudgetManager**: 基于 `isolated/shared/handoff` 模式分配预算，支持并发上限、预留比例与使用量追踪。
- **Snapshotable**: 组件快照协议（`toSnapshot`/`fromSnapshot`）用于稳定序列化与恢复。

## 常见任务示例

### 1) 创建并绑定 UnifiedAgentContext

```javascript
import { UnifiedAgentContext } from 'js/agents/runtime';

const context = new UnifiedAgentContext({ runId: state.runId, eventBus });
context.bind({ state, memory, sharedContext });

context.setTaskGoal('Ship v1');
context.addTodo({ id: 'todo_1', title: 'Draft plan' });
context.addMessage({ role: 'user', content: 'Hello' });
context.recordDecision({ step: 'plan', result: 'approved' });
```

### 2) 保存与恢复 Checkpoint

```javascript
const checkpoint = await context.saveCheckpoint({
  includeMemoryL3: true,
  incremental: true,
});

await context.restoreCheckpoint(checkpoint);
```

### 3) 子 Agent 预算分配与回收

```javascript
import { createSubagentBudgetManager } from 'js/agents/runtime';

const budget = createSubagentBudgetManager({ parentBudget: 200_000, maxConcurrent: 2 });
const allocation = budget.allocate('subagent_1', { mode: 'shared' });

if (!allocation.error) {
  budget.recordUsage('subagent_1', 1200);
  budget.release('subagent_1', 1500);
}
```

### 4) Snapshotable 断言

```javascript
import { assertSnapshotable } from 'js/agents/runtime/context/snapshotable.js';

const snapshotable = assertSnapshotable(memoryStore, 'memoryStore');
const snapshot = snapshotable.toSnapshot();
```
