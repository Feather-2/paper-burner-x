# deepsearch/state - 状态管理

DeepSearch 的状态访问器、序列化、检查点与内存同步。

## 模块描述

该目录为 DeepSearchState 提供状态读写方法、序列化与恢复、迭代/报告访问器，以及与 MemoryStore/StateEngine 的同步逻辑。

## 核心文件

| 文件 | 职责 |
|------|------|
| `state-methods.js` | todo、token usage、timeline 与 gap 操作的主方法集合 |
| `checkpoint-methods.js` | 保存/恢复 checkpoint，计算 gap/claim/evidence/retrieved 指标 |
| `serializer.js` | 构建快照、序列化 JSON、处理 checkpoint 引用 |
| `serialization-methods.js` | toSnapshot/serialize/clone/deserialize 的通用方法 |
| `memory-methods.js` | 绑定 MemoryStore、scratchpad 同步、共享信号上报 |
| `task-state.js` | taskGoal 与 awaitUserFeedback/taskImpossible 访问器 |
| `iteration-state.js` | 迭代级别 phase/gaps/retrievedChunks 访问器，自动初始化 L1/L2 容器 |
| `report-state.js` | 报告草稿与提纲访问器 |
| `planning-tree.js` | 轻量 PlanningTree 骨架与序列化 |

## 关键概念

| 概念 | 说明 |
|------|------|
| 状态分层 | L0/L1/L2 分层保存目标、规划/报告、运行期数据 |
| StateEngine | 若存在则作为 L0 SSOT，通过 dispatchSync 写入 |
| MemoryStore | 外部记忆库适配，支持 scratchpad/todo 同步 |
| Checkpoint | FULL/MINIMAL/LITE 三种快照策略，按需恢复 |
| Checkpoint metrics | saveCheckpoint 记录 gap/claim/evidence/retrieved 计数，用于状态摘要 |
| Snapshot | buildStateSnapshot/toSnapshot/toJSON 输出持久化数据 |
| Scratchpad | L2.scratchpad 的轻量临时存储 |
| PlanningTree | 仅保存 rootGoal/runId 的最小规划树 |

## 常见任务

| 任务 | 入口 |
|------|------|
| 保存/恢复 checkpoint（含 metrics） | `checkpoint-methods.js` 中的 saveCheckpoint/restoreCheckpoint |
| 序列化/克隆状态 | `serialization-methods.js` 与 `serializer.js` |
| 管理 todo | `state-methods.js` 中 add/update/remove/replaceTodos |
| 绑定 MemoryStore | `memory-methods.js` 中 bindMemoryStore |
| 更新 report 草稿/提纲 | `report-state.js` 的 reportDraft/outline |
| 读写 taskGoal 与状态标志 | `task-state.js` 的 taskGoal/awaitUserFeedback/taskImpossible |
| 迭代内读写 phase/gaps/chunks | `iteration-state.js` |
