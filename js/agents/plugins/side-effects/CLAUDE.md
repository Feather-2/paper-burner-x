# side-effects - 可回滚副作用日志

记录和回放“物理”副作用（例如 VFS 写入），支持 Backtrack/undo 恢复文件状态。

## 模块描述

SideEffectJournal 以 WAL（write-ahead log）形式持久化可回滚副作用，
监听 `vfs.write.*` 事件生成 `vfs_checkpoint` 记录，并在需要时回滚到指定游标。

## 核心文件

| 文件 | 职责 |
|------|------|
| `side-effect-journal.js` | SideEffectJournal：记录/持久化/回放/回滚副作用，集成 EventBus 与 VFS |

## 关键概念

| 概念 | 说明 |
|------|------|
| WAL 日志 | `${walDir || '.agents/wal'}/<runId>.jsonl`，按行 JSON 存储副作用记录 |
| WAL 目录 (walDir) | 可配置 WAL 根目录，默认 `.agents/wal` |
| WAL 安全限制 | WAL 文件最大 10MB；单行最大 100KB；超限/非法行会被跳过并告警（对应 `MAX_WAL_FILE_SIZE` / `MAX_WAL_LINE_SIZE`） |
| runId 校验 | 拒绝 `..`、绝对路径、路径分隔符、非法字符，避免路径穿越 |
| WAL 校验 | replay 时验证 `kind`/`ts`/`reversible` 等结构，非法记录跳过 |
| 游标 (cursor) | 当前日志长度，`rollbackToCursor()` 以序号回退 |
| vfs_checkpoint | 通过 `vfs.write.*` 事件生成的可回滚检查点记录 |
| 去重 | `eventId` 去重，忽略 `meta.replay` 事件 |
| 回滚依赖 | 需要 `runStore`/`storageAdapter` + `restoreVfsCheckpoint()`；VFS 需支持 `writeFile` |
| WAL 追加 | 优先使用 `vfs.appendText`，缺失时回退为整文件重写 |
| 回滚事件 | 回滚完成后触发 `side_effects.rolled_back` |
| autoPersist | `record()` 默认按此选项自动写入 WAL |

## 数据结构（JSDoc typedef）

这些类型位于 `side-effect-journal.js` 顶部，便于调用方对接与做输入校验。

### SideEffectJournalCheckpointRef

| 字段 | 类型 | 说明 |
|------|------|------|
| artifactId | string | checkpoint artifact 标识 |
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

### SideEffectJournalEventPayload

`attachEventBus()` 监听的 `vfs.write.*` 事件 payload（由上游 VFS/EventBus 约定）。
SideEffectJournal 只关心以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| op | string? | 操作类型（如 write/append 等） |
| path | string? | 目标路径 |
| checkpoint | SideEffectJournalCheckpointRef? | 可回滚检查点引用（如有） |

### RunStoreLike（DI contract）

用于描述注入的 runStore（若提供）：

| 字段 | 类型 | 说明 |
|------|------|------|
| getEvents | (runId: string) => Promise<unknown[]> ? | 可选：按 runId 获取事件列表（用于回放/去重/回滚相关逻辑） |
