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
| 游标 (cursor) | 当前日志长度，`rollbackToCursor()` 以序号回退 |
| vfs_checkpoint | 通过 `vfs.write.*` 事件生成的可回滚检查点记录 |
| 去重 | `eventId` 去重，忽略 `meta.replay` 事件 |
| 回滚依赖 | 需要 `runStore`/`storageAdapter` + `restoreVfsCheckpoint()`；VFS 需支持 `writeFile` |
| WAL 追加 | 优先使用 `vfs.appendText`，缺失时回退为整文件重写 |
| 回滚事件 | 回滚完成后触发 `side_effects.rolled_back` |

## 常见任务

### 1) 初始化并监听 VFS 写入

```javascript
import { SideEffectJournal } from 'js/agents/runtime/side-effects/side-effect-journal.js';

const journal = new SideEffectJournal({
  runId,
  vfs,
  runStore,
  storageAdapter,
  eventBus,
  logger: console,
  autoPersist: true,
  walDir: '.agents/wal', // 可选：自定义 WAL 根目录
});

journal.attachEventBus(eventBus); // 监听 vfs.write.*
```

### 2) 手动记录副作用并持久化

```javascript
journal.record({
  kind: 'vfs_checkpoint',
  reversible: true,
  path: 'output.txt',
  checkpoint: { artifactId: 'abc123', type: 'vfs_checkpoint.json' },
}, { persist: true });
```

### 3) 崩溃恢复与回滚

```javascript
await journal.replayFromStorage(runId);     // 读取 WAL 恢复内存日志
await journal.rollbackToCursor(3);          // 回滚到第 3 条之前
await journal.compact();                    // 压缩 WAL（可选）
```

### 4) 从 RunStore 还原历史事件

```javascript
await journal.loadFromRunStore({ runId });  // 读取历史 vfs.write.* 事件
```
