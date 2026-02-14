# memory - 记忆系统

Agent 记忆存储、状态引擎与检索系统，覆盖短期上下文、阶段摘要和长期归档。

## 模块定位

- 提供 L0-L3 分层记忆（即时状态 → 冷存储归档）
- 提供两条兼容链路：`MemoryStore`（分层实现）与 `UnifiedMemoryStore`（StateEngine SSOT）
- 提供统一检索：`RetrievalEngine`（recall / semantic / hybrid）
- 提供持久化与跨会话能力：`L3Storage` + `state-engine.persistence`

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块导出 (`MemoryStore` / `UnifiedMemoryStore` / `StateEngine` + `createInitialState` / `rootReducer` / `RetrievalEngine` / action-types) |
| `memory-store.impl.js` | `MemoryStore` 兼容入口（re-export） |
| `memory-store.impl.core.js` | `MemoryStore` 主类，组合 L0/L1/L2/L3 分层实现 |
| `memory-store.impl.l0.js` | L0：`systemPrompt` / `taskGoal` / `todos` |
| `memory-store.impl.l1.js` | L1：`messages` / `signals` / `decisions` / `scratchpad` / `flags` / `deck` + discovery/subagent sync |
| `memory-store.impl.l2.js` | L2：`historySummary` / `stageSummaries` / `claims` + summaries/decisions |
| `memory-store.impl.l3.js` | L3：`archive` / `index` / `checkpoint` + `RetrievalEngine` / `L3Storage` 桥接（含跨会话水合与索引重建） |
| `memory-store.impl.utils.js` | token/ID/字节估算工具 |
| `unified-memory-store.js` | `UnifiedMemoryStore` 入口（StateEngine SSOT） |
| `unified-memory-store.query.js` | `UnifiedMemoryStore` 查询/汇总方法 |
| `unified-memory-store.write.js` | `UnifiedMemoryStore` 写入/更新方法 |
| `unified-memory-store.index.js` | `RetrievalEngine` 兼容 recall/semantic/hybrid |
| `unified-memory-store.lifecycle.js` | L3 持久化/压缩/统计生命周期 |
| `unified-memory-store.utils.js` | 共享工具（ID/token/数值校验） |
| `state-engine.js` | `StateEngine` 核心（dispatch/queue/clock） |
| `state-engine.reducers.js` | reducers + `createInitialState` |
| `state-engine.events.js` | listener/EventBus 通知 |
| `state-engine.persistence.js` | snapshot/checkpoint 逻辑 |
| `state-engine.utils.js` | `StateEngine` 工具（ID 等） |
| `retrieval-engine.js` | `RetrievalEngine` 记忆检索 |
| `l3-storage.js` | `L3Storage` 冷存储（LRU 淘汰 + 去重 + VFS 持久化 + 多 Tab 协调） |
| `l3-storage/` | L3 辅助模块（见 `l3-storage/CLAUDE.md`） |
| `state-diff.js` | 状态 diff/patch 工具 |
| `action-types.js` | Action Types + Action Creators（L0-L3 + deck/summaries + discovery/subagent sync） |
| `todo-normalize.js` | Todo 规范化 |

## 分层语义（L0-L3）

- **L0（任务底座）**：系统提示词、任务目标、执行 Todo
- **L1（工作上下文）**：消息流、信号、临时草稿、运行标志、deck
- **L2（结构化沉淀）**：阶段摘要、历史摘要、claims 等可复用结论
- **L3（长期记忆）**：归档、索引、checkpoint 与跨会话恢复

## 数据流（简版）

1. 写入请求进入 `MemoryStore` 或 `UnifiedMemoryStore`
2. 由 `StateEngine` + reducers 更新状态并触发事件
3. 生命周期模块在阈值或阶段边界执行摘要/压缩
4. `L3Storage` 执行归档、去重、持久化
5. `RetrievalEngine` 基于索引返回 recall/semantic/hybrid 结果

## 最小使用示例

```javascript
import {
  UnifiedMemoryStore,
  StateEngine,
  createInitialState,
  rootReducer
} from './index.js';

const stateEngine = new StateEngine({
  initialState: createInitialState(),
  reducer: rootReducer
});

const memory = new UnifiedMemoryStore({ stateEngine });
```

## 开发约定

- 事件命名遵循 `domain:action`
- Action 类型统一收敛在 `action-types.js`
- Todo 输入先经过 `todo-normalize.js`
- 新增字段时同步更新：reducers、persistence、query/write、文档
