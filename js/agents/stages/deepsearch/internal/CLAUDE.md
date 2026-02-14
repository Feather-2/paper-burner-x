# internal (deepsearch/internal) - 内部运行时组件

DeepSearch 阶段的运行时支撑：checkpoint/回溯、共享上下文、模型响应容错与写作阶段控制。

## 模块描述

该目录聚焦 DeepSearch 阶段的“运行时保障”与“交互容错”，为 agent loop 提供状态快照、回溯恢复、跨阶段记忆、用户干预与写作补全等能力。

## 核心文件

| 文件 | 职责 |
|------|------|
| `backtrack-manager.js` | BacktrackManager 回溯管理：限制次数（默认 3）、从 archive 恢复 checkpoint 并迁移、必要时回滚 sideEffects（cursor）、发射回溯事件、向 SharedContext 注入 backtrack_hint/诊断信号；对外返回结构化 `BacktrackResult`（可携带 `details`：checkpointId/stage/schemaVersion/keys） |
| `checkpoint.js` | CheckpointManager + snapshot 生成/迁移；`CHECKPOINT_SCHEMA_VERSION`（当前为 `1.0`）标识 schema；`normalizeCheckpointStrategy()` 对外部策略（大小写不敏感）做归一化（默认 LITE）；通过 `createCheckpoint()` 统一归档结构，`loadCheckpoint`/迁移流程兼容旧 schema 并补齐关键字段（如 todos/L2 flags 等）；快照拷贝使用 `deepClone()` |
| `shared-context.js` | SharedContext 三层记忆（L1 摘要/L2 索引/L3 存储）+ 信号/决策/去重 + action stream/黑板摘要/同步信号 |
| `model-response-handler.js` | 模型响应处理器：空响应/解析失败重试、用户选择、记录 usage |
| `writing-phase-handler.js` | 写作阶段控制：字数不足时触发 write-report 循环，注入写作 prompt 并持久化输出 |
| `error-classifier.js` | DeepSearch 错误分类封装（是否可恢复、类别） |

## 关键概念

| 概念 | 说明 |
|------|------|
| Checkpoint / Backtrack | `save()` 生成归档，`backtrack()` 从 archive 恢复并限制次数 |
| Snapshot 策略 | `CheckpointMode` 的 `lite/minimal/full`，兼顾体积与可恢复性 |
| 策略归一化 | `normalizeCheckpointStrategy()` 先做非空字符串标准化，再归一到 `CheckpointMode`；无效值回退默认策略 |
| Checkpoint 迁移补齐 | `loadCheckpoint()`/`migrateCheckpoint()` 迁移旧 schema，并对关键字段做补齐与纠偏（如 todos 与 L2 标记：awaitUserFeedback/taskImpossible/reason） |
| Schema 版本 | `CHECKPOINT_SCHEMA_VERSION` 表示当前 schema（`1.0`）；回溯诊断可记录/对比 `schemaVersion` |
| 归档结构统一 | `createCheckpoint()` 统一 checkpoint 归档数据结构，减少跨模块格式漂移 |
| 安全快照拷贝 | 使用 `deepClone()` 进行快照复制，避免状态对象引用污染 |
| SharedContext 三层记忆 | L1 摘要用于 prompt；L2 关键词索引；L3 完整数据；支持 `commit()` 一次写入 |
| Action Stream / 版本 | `getActions()` 输出增量动作，`applyActions()` 回放动作，`getVersion()` 保证单调，用于跨实例合并 |
| Blackboard 摘要 | `buildBlackboardPrompt()` 汇总 L1 摘要 + 最近信号/决策，支持 `targetTaskId` 定向过滤 |
| Sync Signals | `upsertSignal()` 维护同步信号表，`getSyncTable()` 便于协作/UI 展示 |
| 信号与决策 | `signal()`/`upsertSignal()` 供阶段间通信，`recordDecision()` 记录决策 |