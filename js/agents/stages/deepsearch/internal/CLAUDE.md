# internal (deepsearch/internal) - 内部运行时组件

DeepSearch 阶段的运行时支撑：checkpoint/回溯、共享上下文、模型响应容错与写作阶段控制。

## 模块描述

该目录聚焦 DeepSearch 阶段的“运行时保障”与“交互容错”，为 agent loop 提供状态快照、回溯恢复、跨阶段记忆、用户干预与写作补全等能力。

## 核心文件

| 文件 | 职责 |
|------|------|
| `backtrack-manager.js` | BacktrackManager 回溯管理：恢复 checkpoint、限制次数、回滚 sideEffects（cursor）、发射 backtrack 事件并注入 backtrack_hint 信号 |
| `checkpoint.js` | CheckpointManager + snapshot 生成/迁移；loadCheckpoint 兼容旧 schema 并补齐 todos/L2 flags；cloneValue 安全拷贝 |
| `shared-context.js` | SharedContext 三层记忆（L1 摘要/L2 索引/L3 存储）+ 信号/决策/去重 + action stream/黑板摘要/同步信号 |
| `model-response-handler.js` | 模型响应处理器：空响应/解析失败重试、用户选择、记录 usage |
| `writing-phase-handler.js` | 写作阶段控制：字数不足时触发 write-report 循环，注入写作 prompt 并持久化输出 |
| `error-classifier.js` | DeepSearch 错误分类封装（是否可恢复、类别） |

## 关键概念

| 概念 | 说明 |
|------|------|
| Checkpoint / Backtrack | `save()` 生成归档，`backtrack()` 从 archive 恢复并限制次数 |
| Snapshot 策略 | `CheckpointMode` 的 `lite/minimal/full`，兼顾体积与可恢复性 |
| Checkpoint 迁移补齐 | `loadCheckpoint()` 迁移旧 schema，自动补齐 todos 与 L2 标记（awaitUserFeedback/taskImpossible/reason） |
| 安全快照拷贝 | `cloneValue()` 优先 structuredClone，循环检测 + `__proto__`/`constructor` 过滤兜底 |
| SharedContext 三层记忆 | L1 摘要用于 prompt；L2 关键词索引；L3 完整数据；支持 `commit()` 一次写入 |
| Action Stream / 版本 | `getActions()` 输出增量动作，`applyActions()` 回放动作，`getVersion()` 保证单调，用于跨实例合并 |
| Blackboard 摘要 | `buildBlackboardPrompt()` 汇总 L1 摘要 + 最近信号/决策，支持 `targetTaskId` 定向过滤 |
| Sync Signals | `upsertSignal()` 维护同步信号表，`getSyncTable()` 便于协作/UI 展示 |
| 信号与决策 | `signal()`/`upsertSignal()` 供阶段间通信，`recordDecision()` 记录决策 |
| 模型响应容错 | 解析失败/空响应会重试并可向用户询问是否继续 |
| 写作阶段 | 报告字数未达阈值时进入写作循环，限制每次追加长度 |
| Backtrack 事件/提示 | `deepsearch.agent.backtracked/backtrack_limit` 事件 + `backtrack_hint` 注入 SharedContext |

## 常见任务

- 保存 checkpoint：`new CheckpointManager({ archive }).save(state, { iteration, metadata })`
- 读取/迁移 checkpoint：`loadCheckpoint(checkpoint)`（补齐 todos/L2 flags）
- 回溯恢复：`new BacktrackManager({ archive, emit, sideEffects }).backtrack(state, checkpointId, { failReason, correctionHint, sharedContext })`
- 更新共享上下文：`sharedContext.commit(stage, { full, summary, keywords })` / `sharedContext.signal(...)`
- 黑板摘要：`sharedContext.buildBlackboardPrompt({ maxSignals, maxDecisions, targetTaskId })`
- 动作流同步：`sharedContext.getActions({ sinceVersion })` / `sharedContext.applyActions(actions)`
- 同步信号：`sharedContext.upsertSignal({ type, id, status, keywords })` / `sharedContext.getSyncTable(type)`
- 处理模型响应：`handler.handleResponse(response, { stageApi, addMessage, budget })`
- 写作补全：`writing.shouldEnter(...)` 为 true 后调用 `writing.run(...)`