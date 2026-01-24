# archive - 归档和检查点

运行状态归档、差量快照与检查点迁移（Browser-first，Node.js 可用）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `archive.js` | 入口导出：Archive、MapAdapter、IndexedDBAdapter、FallbackAdapter |
| `archive-core.js` | Archive 类（差量快照/恢复缓存/输入校验/安全限制） |
| `map-adapter.js` | MapAdapter（内存存储） |
| `storage-adapter.js` | StorageAdapter 接口定义 |
| `serialization.js` | JSON patch/diff 构建与应用（含大小估算/安全限制） |
| `checkpoint-schema.js` | Checkpoint 类型、版本、创建/校验/迁移 |

## Archive

```javascript
import { Archive, FallbackAdapter } from 'js/agents/core/archive/archive.js';

// 优先 IndexedDB，失败时自动回退到 MapAdapter
const archive = new Archive(new FallbackAdapter(), {
  diff: {
    enabled: true,
    // 每 N 次 checkpoint best-effort 存一份全量（按 Archive 实例计数，不保证跨实例）
    fullSnapshotEvery: 10,
    // 只有当预计节省 >= minSavingsBytes 才会采用 diff（粗略估算）
    minSavingsBytes: 1024,
    // 安全限制：避免病态 diff
    maxOps: 5000,
    maxDepth: 12,
  },

  // 恢复结果缓存（0=禁用，Infinity=不设上限）
  restoreCacheMax: 200,

  // restore 时允许的 diff 链最大深度（默认 50）
  restoreMaxDepth: 50,
});

// 保存 -> 返回 checkpointId（格式见下方）
const checkpointId = await archive.save('run-123', {
  nodeStates: state,
  metadata: { runId: 'run-123', iteration: 1 },
});

// runId -> 最新 checkpoint
const latest = await archive.load('run-123');

// checkpointId -> 精确恢复（不存在会抛错）
const exact = await archive.restore(checkpointId);

// 列出
const list = await archive.listCheckpoints('run-123');

// 清理历史
await archive.deleteOlderThan(7);
```

### CheckpointId 约定

- `runId`：非空字符串，且不应包含 `:`（用于分隔）
- `checkpointId`：`${runId}:${timestamp}`，必要时 `${runId}:${timestamp}-${seq}`
  - `timestamp` 为数字字符串（通常是毫秒时间戳）
  - `seq` 为数字字符串，用于同毫秒内生成多个 checkpoint 时去重

## 适配器

- `MapAdapter`: 内存存储，适合 Node/测试
- `IndexedDBAdapter`: 浏览器持久化，可用 `clear()`/`close()`；IndexedDB 不可用会抛错
- `FallbackAdapter`: IndexedDB 不可用时自动回退 MapAdapter
- 自定义适配器需实现 `StorageAdapter`：`get/set/delete/keys` (Promise)

## 检查点

CheckpointType: `PRE_ACTION`, `PAUSE`, `COMPRESS`, `ARCHIVE`。schema version 常量为 `CHECKPOINT_SCHEMA_VERSION`。

```javascript
import {
  CheckpointType,
  createCheckpoint,
  validateCheckpoint,
  migrateCheckpoint,
} from 'js/agents/core/archive/checkpoint-schema.js';

// 创建（字段以 schema 为准）
const checkpoint = createCheckpoint(agentState, {
  type: CheckpointType.PRE_ACTION,
});

// 运行时校验（读取旧数据/外部数据时必须校验 + 必要时迁移）
validateCheckpoint(checkpoint);
// const upgraded = migrateCheckpoint(checkpoint);
```
