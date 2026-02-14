# memory - 记忆系统

Agent 记忆存储、状态引擎和检索。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块导出 (MemoryStore / UnifiedMemoryStore / StateEngine + createInitialState/rootReducer / RetrievalEngine / action-types) |
| `memory-store.impl.js` | MemoryStore 兼容入口 (re-export) |
| `memory-store.impl.core.js` | MemoryStore 主类，组合 L0/L1/L2/L3 分层实现 |
| `memory-store.impl.l0.js` | L0 层：systemPrompt/taskGoal/todos |
| `memory-store.impl.l1.js` | L1 层：messages/signals/decisions/scratchpad/flags/deck + discovery/subagent sync |
| `memory-store.impl.l2.js` | L2 层：historySummary/stageSummaries/claims + summaries/decisions |
| `memory-store.impl.l3.js` | L3 层：archive/index/checkpoint + RetrievalEngine/L3Storage 桥接（含跨会话水合与索引重建） |
| `memory-store.impl.utils.js` | token/ID/字节估算工具 |
| `unified-memory-store.js` | UnifiedMemoryStore 入口 (StateEngine SSOT) |
| `unified-memory-store.query.js` | UnifiedMemoryStore 查询/汇总方法 |
| `unified-memory-store.write.js` | UnifiedMemoryStore 写入/更新方法 |
| `unified-memory-store.index.js` | RetrievalEngine 兼容 recall/semantic/hybrid |
| `unified-memory-store.lifecycle.js` | L3 持久化/压缩/统计生命周期 |
| `unified-memory-store.utils.js` | 共享工具（ID/token/数值校验） |
| `state-engine.js` | StateEngine 核心 (dispatch/queue/clock) |
| `state-engine.reducers.js` | Reducers + createInitialState |
| `state-engine.events.js` | Listener/EventBus 通知 |
| `state-engine.persistence.js` | snapshot/checkpoint 逻辑 |
| `state-engine.utils.js` | StateEngine 工具 (ID 等) |
| `retrieval-engine.js` | RetrievalEngine - 记忆检索 |
| `l3-storage.js` | L3Storage - 冷存储 (LRU 淘汰 + 去重 + VFS 持久化 + 多 Tab 协调) |
| `l3-storage/` | L3 辅助模块 (见 `l3-storage/CLAUDE.md`) |
| `state-diff.js` | 状态 diff/patch 工具 |
| `action-types.js` | Action Types + Action Creators (L0-L3 + deck/summaries + discovery/subagent sync) |
| `todo-normalize.js` | Todo 规范化 |

## MemoryStore

```javascript
import { MemoryStore } from 'js/agents/runtime/memory';

const store = new MemoryStore({ vfs, eventBus });

store.setTaskGoal('Ship v1');
store.addMessage({ role: 'user', content: 'Hello' });

// 归档
await store.archive('stage1', { summary: '...' }, ['keyword1']);

// 查看最近归档
const archives = store.listArchives(5);
```

## L3 层（跨会话持久化）

- `L3Storage.init()` 后，`MemoryStore` 会从 VFS 水合 `timeline/snapshots` 到内存索引（`_L3.index` + `_L3.snapshots`），支持跨会话检索。
- `archive()` 在写入 `L3Storage` 后会同步快照到内存 `Map` 与时间线，减少读取时的 VFS 往返。
- 水合阶段会基于快照元数据重建关键词索引（并恢复 stage 映射），确保 `RetrievalEngine` 可进行跨会话召回。
