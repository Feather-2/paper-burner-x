# checkpoints - 运行检查点

Agent 运行快照的持久化与恢复，基于 VFS 保存检查点文件和索引。

> **文件统计**: 2 个 JS 文件

## 模块描述

`plugins/checkpoints` 负责把一次运行的消息、工具调用、结果等快照写入磁盘，并维护索引以支持按“最新 / 指定 ID / 指定步数”恢复。

## 核心文件

| 文件 | 职责 |
|------|------|
| `agent-checkpoint-store.js` | AgentCheckpointStore - 检查点保存/读取 + `index.json` 管理 |
| `index.js` | 模块导出 |

## 关键概念

- **runId**: 运行分区标识，写入前会做安全化处理（仅保留 `a-zA-Z0-9._-`，空值回退为 `run`），目录为 `.agents/runs/<runId>/checkpoints`。
- **检查点文件**: `<checkpointId>.json`，包含 `schemaVersion`、`kind`、`checkpointId`、`runId`、`ts`、`step/iteration`、`messages`、`toolCalls`、`results`、`metadata` 等。
- **索引文件**: `index.json` 采用对象结构 `{ schemaVersion, kind, runId, updatedAt, checkpoints }`，`checkpoints` 数组保存 `checkpointId`、`ts`、`step/iteration`、`metadata`；读取时兼容旧版数组结构。
- **检查点 ID**: 默认使用 `makeSecureTimestampedId('ckpt')`，异常时回退为 `ckpt_<ts>_<rand>`。
- **恢复模式**: `last/latest` (默认)、`checkpoint/id`、`step`；`step` 匹配 `step` 或 `iteration`。
- **VFS/StorageAdapter**: 需要具备 `readText/readFile` 与 `writeText/writeFile` 能力；可用 `StorageVfs` 适配存储后端。
- **索引锁**: `withIndexLock` 保证同一 `runId` 的索引读写串行化。

## 常见任务

```javascript
import { AgentCheckpointStore } from 'js/agents/plugins/checkpoints';

const store = new AgentCheckpointStore({ vfs, runId: 'session_123' });

const { checkpointId } = await store.saveCheckpoint({
  messages,
  toolCalls,
  results,
  metadata: { stage: 'plan' },
  step: 12,
});

const checkpoints = await store.listCheckpoints();
```

```javascript
// 加载最新检查点 (默认 last)
const latest = await store.loadCheckpoint();

// 按步数恢复
const byStep = await store.loadCheckpoint({ step: 5, mode: 'step' });

// 按 ID 恢复
const byId = await store.loadCheckpoint({ checkpointId, mode: 'checkpoint' });
```
