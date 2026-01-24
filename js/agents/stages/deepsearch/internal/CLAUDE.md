# internal (deepsearch/internal) - 内部运行时组件

DeepSearch 阶段的运行时支撑：checkpoint/回溯、共享上下文、模型响应容错与写作阶段控制。

## 模块描述

该目录聚焦 DeepSearch 阶段的“运行时保障”与“交互容错”，为 agent loop 提供状态快照、回溯恢复、跨阶段记忆、用户干预与写作补全等能力。

## 核心文件

| 文件 | 职责 |
|------|------|
| `backtrack-manager.js` | BacktrackManager 回溯管理：恢复 checkpoint（含迁移）、限制次数（默认 3）、必要时回滚 sideEffects（cursor）、发射回溯事件、向 SharedContext 注入 backtrack_hint/诊断信号；对外返回结构化 `BacktrackResult`（含 details） |
| `checkpoint.js` | CheckpointManager + snapshot 生成/迁移；`CHECKPOINT_SCHEMA_VERSION` 标识 schema；`normalizeCheckpointStrategy()` 归一化策略输入（默认 LITE）；loadCheckpoint 兼容旧 schema 并补齐 todos/L2 flags；cloneValue 安全拷贝 |
| `shared-context.js` | SharedContext 三层记忆（L1 摘要/L2 索引/L3 存储）+ 信号/决策/去重 + action stream/黑板摘要/同步信号 |
| `model-response-handler.js` | 模型响应处理器：空响应/解析失败重试、用户选择、记录 usage |
| `writing-phase-handler.js` | 写作阶段控制：字数不足时触发 write-report 循环，注入写作 prompt 并持久化输出 |
| `error-classifier.js` | DeepSearch 错误分类封装（是否可恢复、类别） |

## 关键概念

| 概念 | 说明 |
|------|------|
| Checkpoint / Backtrack | `save()` 生成归档，`backtrack()` 从 archive 恢复并限制次数 |
| Snapshot 策略 | `CheckpointMode` 的 `lite/minimal/full`，兼顾体积与可恢复性 |
| 策略归一化 | `normalizeCheckpointStrategy()` 将外部输入（大小写不敏感）归一到 `CheckpointMode`；无效值回退到默认策略 |
| Checkpoint 迁移补齐 | `loadCheckpoint()`/`migrateCheckpoint()` 迁移旧 schema，自动补齐 todos 与 L2 标记（awaitUserFeedback/taskImpossible/reason） |
| Schema 版本 | `CHECKPOINT_SCHEMA_VERSION` 表示当前 schema；回溯诊断可记录/对比 `schemaVersion` |
| 安全快照拷贝 | `cloneValue()` 优先 structuredClone，循环检测 + `__proto__`/`constructor` 过滤兜底 |
| SharedContext 三层记忆 | L1 摘要用于 prompt；L2 关键词索引；L3 完整数据；支持 `commit()` 一次写入 |
| Action Stream / 版本 | `getActions()` 输出增量动作，`applyActions()` 回放动作，`getVersion()` 保证单调，用于跨实例合并 |
| Blackboard 摘要 | `buildBlackboardPrompt()` 汇总 L1 摘要 + 最近信号/决策，支持 `targetTaskId` 定向过滤 |
| Sync Signals | `upsertSignal()` 维护同步信号表，`getSyncTable()` 便于协作/UI 展示 |
| 信号与决策 | `signal()`/`upsertSignal()` 供阶段间通信，`recordDecision()` 记录决策 |
| 模型响应容错 | 解析失败/空响应会重试并可向用户询问是否继续 |
| 写作阶段 | 报告字数未达阈值时进入写作循环，限制每次追加长度 |
| Backtrack 结果 | `BacktrackResult`：`{ success, reason, state?, error?, details? }`；`details` 可包含 `checkpointId/stage/schemaVersion/keys` |
| Backtrack 事件/提示 | 通过 `emit(eventName, payload)` 发射回溯相关事件；恢复后可向 SharedContext 注入 `backtrack_hint` 等提示信号 |

## 常见任务

- 保存 checkpoint：`new CheckpointManager({ archive }).save(state, { iteration, metadata })`
- 读取/迁移 checkpoint：`loadCheckpoint(checkpoint)` / `migrateCheckpoint(checkpoint)`（补齐 todos/L2 flags）
- 选择 snapshot 模式：`new CheckpointManager({ strategy: CheckpointMode.LITE }).save(...)`
- 回溯恢复：`new BacktrackManager({ archive, emit, sideEffects, logger }).backtrack(state, checkpointId, { failReason, correctionHint, sharedContext })`
- 处理回溯失败：检查 `BacktrackResult.reason/error/details` 并决定是否重试/询问用户/终止
