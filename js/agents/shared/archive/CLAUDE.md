# archive - 归档和检查点

运行状态归档、差量快照与检查点迁移（Browser-first，Node.js 可用）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `archive.js` | Archive, MapAdapter, IndexedDBAdapter, FallbackAdapter（差量快照/恢复缓存） |
| `checkpoint-schema.js` | Checkpoint 类型、版本、创建/校验/迁移 |

## Archive

```javascript
import { Archive, FallbackAdapter } from 'js/agents/shared/archive/archive.js';

// 优先 IndexedDB，失败时自动回退到 MapAdapter
const archive = new Archive(new FallbackAdapter(), {
  diff: {
    enabled: true,
    fullSnapshotEvery: 10,
    minSavingsBytes: 1024,
    maxOps: 5000,
    maxDepth: 12,
  },
  restoreCacheMax: 200,
});

// 保存
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

## 适配器

- `MapAdapter`: 内存存储，适合 Node/测试
- `IndexedDBAdapter`: 浏览器持久化，可用 `clear()`/`close()`
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
} from 'js/agents/shared/archive/checkpoint-schema.js';

const checkpoint = createCheckpoint(agentState, {
  type: CheckpointType.PRE_ACTION,
  runId: 'run-123',
  iteration: 2,
});

const ok = validateCheckpoint(checkpoint);
const migrated = migrateCheckpoint(legacyCheckpoint);
```
