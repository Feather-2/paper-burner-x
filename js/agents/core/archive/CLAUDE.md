# archive - 归档和检查点

运行状态归档、差量快照与检查点迁移（Browser-first，Node.js 可用）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `archive.js` | 入口导出：`Archive`、`MapAdapter`、`IndexedDBAdapter`、`FallbackAdapter`；浏览器持久化与降级策略 |
| `archive-core.js` | `Archive` 主逻辑（保存/恢复、差量快照、恢复缓存、输入校验、适配器契约校验） |
| `map-adapter.js` | `MapAdapter`（内存存储） |
| `storage-adapter.js` | `StorageAdapter` 接口定义 |
| `serialization.js` | JSON patch/diff 构建与应用（含大小估算/安全限制） |
| `checkpoint-schema.js` | Checkpoint 类型、版本、创建/校验/迁移 |

## 快速使用

```javascript
import { Archive, FallbackAdapter } from 'js/agents/core/archive/archive.js';

const archive = new Archive(new FallbackAdapter(), {
  diff: { enabled: true, fullSnapshotEvery: 10, minSavingsBytes: 1024, maxOps: 5000, maxDepth: 12 },
  restoreCacheMax: 200,
  restoreMaxDepth: 50,
});

const checkpointId = await archive.save('run-123', {
  nodeStates: state,
  metadata: { runId: 'run-123', iteration: 1 },
});

const latest = await archive.load('run-123');
const exact = await archive.restore(checkpointId);
const list = await archive.listCheckpoints('run-123');
await archive.deleteOlderThan(7);
```

## 配置归一化规则

- `diff` 配置会归一化到正整数，缺失字段回退默认值
- 默认值：`fullSnapshotEvery=10`、`minSavingsBytes=1024`、`maxOps=5000`、`maxDepth=12`
- `restoreCacheMax` 支持：
  - `Infinity`：不做数量上限裁剪
  - `0` 或负值：关闭恢复缓存
  - 其他数值：向下取整为非负整数
- `restoreMaxDepth` 默认 `50`，用于限制恢复链路深度

## CheckpointId 约定

- `runId`：非空字符串，且不应包含 `:`
- `checkpointId`：`${runId}:${timestamp}`，必要时 `${runId}:${timestamp}-${seq}`
- `timestamp`/`seq` 均为数字字符串（用于同毫秒去重）
- 解析规则：按首个 `:` 分割 `runId` 与时间段；不匹配格式时返回无效

## 适配器契约

- 存储适配器必须实现：`get` / `set` / `delete` / `keys`（均为 Promise 风格）
- 适配器接口不完整时应抛出 `TypeError`
- `MapAdapter`：内存存储，适合 Node/测试
- `IndexedDBAdapter`：浏览器持久化，可用 `clear()` / `close()`
- `FallbackAdapter`：IndexedDB 不可用时自动回退 `MapAdapter`

## 检查点 Schema

- `CheckpointType`：`PRE_ACTION`、`PAUSE`、`COMPRESS`、`ARCHIVE`
- 版本常量：`CHECKPOINT_SCHEMA_VERSION`
- 建议流程：`createCheckpoint` → `validateCheckpoint` → `migrateCheckpoint`

## 安全与恢复约束

- diff 应用受 `maxOps` 和 `maxDepth` 限制
- restore 受 `restoreMaxDepth` 限制，防止深链路恢复放大
- restore 缓存由 `restoreCacheMax` 控制，避免无限增长
- 输入校验失败应抛错，不应吞掉异常

## 兼容性

- Browser-first：优先 `IndexedDBAdapter`
- Node.js/测试：建议 `MapAdapter` 或 `FallbackAdapter`
- 模块规范：ES Modules + JSDoc
