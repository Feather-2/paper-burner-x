# memory - 记忆系统

Agent 记忆存储、状态引擎与检索系统，覆盖短期上下文、阶段摘要和长期归档。

## 模块定位

- 提供 L0-L3 分层记忆（即时状态 → 冷存储归档）
- 提供两条兼容链路：`MemoryStore`（分层实现）与 `UnifiedMemoryStore`（StateEngine SSOT）
- 提供统一检索：`RetrievalEngine`（`recall` / `semantic` / `hybrid`）
- 提供持久化与跨会话能力：`L3Storage` + `state-engine.persistence`

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块导出（`MemoryStore` / `UnifiedMemoryStore` / `StateEngine` / `RetrievalEngine` / reducers / action types） |
| `action-types.js` | 状态与写入动作常量定义 |
| `memory-store.impl.js` | `MemoryStore` 兼容入口（re-export） |
| `memory-store.impl.core.js` | `MemoryStore` 主类，组合 L0/L1/L2/L3 分层实现 |
| `memory-store.impl.l0.js` | L0：`systemPrompt` / `taskGoal` / `todos` |
| `memory-store.impl.l1.js` | L1：`messages` / `signals` / `decisions` / `scratchpad` / `flags` / `deck`，含 discovery/subagent 同步 |
| `memory-store.impl.l2.js` | L2：`historySummary` / `stageSummaries` / `claims`，含 summaries/decisions 聚合 |
| `memory-store.impl.l3.js` | L3：`archive` / `index` / `checkpoint`，桥接 `RetrievalEngine` 与 `L3Storage` |
| `memory-store.impl.utils.js` | token/ID/字节估算工具 |
| `unified-memory-store.js` | `UnifiedMemoryStore` 入口（基于 `StateEngine`） |
| `unified-memory-store.write.js` | 写入与更新流程（append/upsert/merge） |
| `unified-memory-store.query.js` | 查询、汇总、回忆与统计接口 |
| `unified-memory-store.index.js` | 检索兼容层（`recall` / `semantic` / `hybrid`） |
| `unified-memory-store.lifecycle.js` | L3 持久化、压缩、快照与生命周期统计 |
| `unified-memory-store.utils.js` | 统一工具（ID、token 估算、数值校验） |
| `state-engine.js` | `StateEngine` 核心（dispatch / queue / clock） |
| `state-engine.reducers.js` | reducers 与 `createInitialState` |
| `state-engine.events.js` | listener 与 EventBus 通知桥接 |
| `state-engine.persistence.js` | snapshot/checkpoint/hydration 逻辑 |
| `state-engine.utils.js` | `StateEngine` 工具函数 |
| `retrieval-engine.js` | 记忆检索引擎与排序策略 |
| `l3-storage.js` | 冷存储（LRU 淘汰、去重、VFS 持久化、多 Tab 协调） |
| `l3-storage/` | L3 子模块（详见 `l3-storage/CLAUDE.md`） |
| `state-diff.js` | 状态 diff/patch 工具 |

## 记忆分层语义

| 层级 | 数据特征 | 典型用途 |
|------|----------|----------|
| **L0** | 高优先级、低体量、即时覆盖 | 系统提示词、任务目标、当前 TODO |
| **L1** | 会话级实时上下文 | 消息流、信号、短决策、草稿信息 |
| **L2** | 阶段级压缩语义 | 历史摘要、阶段总结、可追溯 claims |
| **L3** | 跨会话长期归档 | checkpoint、冷数据检索、恢复与复盘 |

## 运行约定

- Browser-first，Node.js 兼容；避免引入 Node-only API（如 `fs` / `path` / `child_process`）到浏览器主路径
- 事件命名遵循 `domain:action`；服务名保持 camelCase
- Public API 必须包含完整 JSDoc（`@param` / `@returns` / `@throws`）
- 异步写入/持久化流程应保证异常可见（记录或上抛），禁止空 `catch`

## 测试建议

- 覆盖目标：整体 ≥90%，最低 ≥70%
- 重点边界：空值、超长文本、并发写入、快速连续 checkpoint、跨会话恢复一致性
- 避免伪测试与过度 mock，优先验证真实状态迁移与检索结果一致性
