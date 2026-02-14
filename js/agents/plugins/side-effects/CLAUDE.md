# side-effects - 可回滚副作用日志

记录和回放“物理”副作用（例如 VFS 写入），支持 Backtrack/undo 恢复文件状态。

## 模块描述

SideEffectJournal 以 WAL（write-ahead log）形式持久化可回滚副作用，监听 `vfs.write.*` 事件生成 `vfs_checkpoint` 记录，并在需要时回滚到指定游标。

当前实现采用“编排层 + helper 层”拆分：
- `side-effect-journal.js`：对外 API、生命周期管理、事件总线集成。
- `side-effect-journal-helpers.js`：路径安全、WAL 读写、回放状态计算、回滚执行与结果应用。

## 核心文件

| 文件 | 职责 |
|------|------|
| `side-effect-journal.js` | SideEffectJournal：记录/持久化/回放/回滚副作用，集成 EventBus 与 VFS |
| `side-effect-journal-helpers.js` | 纯函数 helper 集：时间/游标归一化、runId 校验、VFS IO 适配、WAL replay、rollback 管线 |

## 关键概念

| 概念 | 说明 |
|------|------|
| WAL 日志 | `${walDir || '.agents/wal'}/<runId>.jsonl`，按行 JSON 存储副作用记录 |
| WAL 目录 (walDir) | 可配置 WAL 根目录，默认 `.agents/wal` |
| WAL 安全限制 | WAL 文件最大 10MB；单行最大 100KB；超限/非法行会被跳过并告警（`MAX_WAL_FILE_SIZE` / `MAX_WAL_LINE_SIZE`） |
| runId 校验 | `sanitizeRunId()` 拒绝 `..`、绝对路径、路径分隔符与非法字符，降低路径穿越风险 |
| 路径拼接 | `joinVfsPath()` 统一处理目录与文件名拼接，避免重复分隔符与空路径分支 |
| 时间归一化 | `toIso()` 将输入时间标准化为 ISO 字符串，保证 WAL 时间字段可序列化 |
| 游标归一化 | `normalizeCursor()` 将外部 cursor 输入归一化为非负整数 |
| WAL 校验 | replay 时验证 `kind`/`ts`/`reversible` 等结构，非法记录跳过 |
| 游标 (cursor) | 当前日志长度，`rollbackToCursor()` 以序号回退 |
| vfs_checkpoint | 通过 `vfs.write.*` 事件生成的可回滚检查点记录 |
| 去重 | `eventId` 去重，忽略 `meta.replay` 事件，避免 replay 二次写入 |
| 回滚依赖 | 通过 `resolveRollbackDeps()` 解析 `runStore`/`storageAdapter`/`restoreVfsCheckpoint()` 依赖 |
| 回滚管线 | `rollbackEntries()` 执行逐条回滚，`applyRollbackResult()` 统一更新状态并触发事件 |
| WAL 追加 | 优先使用 `vfs.appendText`，缺失时回退为整文件重写 |
| 回滚事件 | 回滚完成后触发 `side_effects.rolled_back` |
| autoPersist | `record()` 默认按此选项自动写入 WAL |

## 数据结构（JSDoc typedef）

这些类型位于 `side-effect-journal.js` 顶部，便于调用方对接与做输入校验。

### SideEffectJournalCheckpointRef

| 字段 | 类型 | 说明 |
|------|------|------|
| artifactId | string | checkpoint artifact 标识 |
| op | string? | 触发操作类型（可选） |
| type | string? | checkpoint 类型（可选） |
| path | string? | checkpoint 路径（可选） |

### SideEffectJournalEntry（WAL 中的单条记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| seq | number | 序号（递增） |
| kind | string | 记录类型（如 `vfs_checkpoint`） |
| ts | string | 序列化后的时间戳 |
| reversible | boolean | 是否可回滚 |
| checkpoint | SideEffectJournalCheckpointRef? | checkpoint 引用（可选） |
| path | string? | 目标路径（可选） |
| op | string? | 操作类型（可选） |
| eventId | string? | 事件唯一 ID（可选） |
| meta | Record<string, unknown>? | 附加元数据（可选，建议为 plain object） |

### SideEffectJournalRecordInput（record() 入参）

与 `SideEffectJournalEntry` 类似，但 `ts` 允许 `string|number`，实现会在写入 WAL 前进行归一化。

### SideEffectJournalRollbackFailure

当回滚过程中某条记录失败时，用于描述失败信息：`{ seq, kind, error }`。

## 行为约束

- 仅记录可逆副作用，且优先通过 checkpoint 恢复。
- replay/rollback 过程中产生的内部事件必须标记 `meta.replay`，避免自触发。
- 任何外部输入（runId/cursor/WAL 行）都先归一化或校验，再进入主流程。
- 浏览器优先：VFS 能力不足时采用兼容分支，不引入 Node-only 强依赖。