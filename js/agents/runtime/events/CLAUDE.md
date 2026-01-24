# events - 事件类型

运行时事件定义与事件总线兼容层。

## 核心文件

| 文件 | 职责 |
|------|------|
| `events.js` | 运行时事件名枚举（`EventStatus` / `*Events`），作为事件名单一真源 |
| `event-bus.js` | 兼容层：重导出 `core/event-bus` 的 `EventBus`（含 `default`）、`LamportClock`、`RunStoreAdapter`、`createEventRecord`、`isValidEventName`、`matchPattern` |

## 兼容层导出（event-bus.js）

- `EventBus` / `default`：事件总线实现（旧代码可继续 `import EventBus from ...`）
- `LamportClock`：Lamport 逻辑时钟
- `RunStoreAdapter`：RunStore 适配器
- `createEventRecord(options)`：创建标准事件记录
- `isValidEventName(name)`：事件名合法性校验
- `matchPattern(pattern, eventName)`：事件名模式匹配

### 类型提示（JSDoc，仅用于编辑器/类型检查）

- `CreateEventRecordOptions`：`createEventRecord` 的 options 入参类型（来自 core 定义推导）
- `EventRecord`：`createEventRecord` 的返回值类型（来自 core 定义推导）

## 事件类型

注意：`events.js` 是事件名的**单一真源**；本节仅展示常用/顶部节选，新增或变更事件请以源码为准。

```javascript
// 事件状态
export const EventStatus = Object.freeze({
  STARTED: 'started',
  PROGRESS: 'progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  WARNING: 'warning',
  INFO: 'info',
});

// Runtime
export const RuntimeEvents = Object.freeze({
  RUN_STARTED: 'run:started',
  RUN_COMPLETED: 'run:completed',
  RUN_FAILED: 'run:failed',
  RUN_CANCELLED: 'run:cancelled',

  STAGE_STARTED: 'stage:started',
  STAGE_PROGRESS: 'stage:progress',
  STAGE_COMPLETED: 'stage:completed',
  STAGE_FAILED: 'stage:failed',
  STAGE_INJECTED: 'stage:injected',
});

// ReviewRules
export const ReviewEvents = Object.freeze({
  REVIEW_STARTED: 'review:started',
  REVIEW_COMPLETED: 'review:completed',
  REVIEW_FAILED: 'review:failed',
});

// AsyncCompressor
export const CompressionEvents = Object.freeze({
  COMPRESSION_SCHEDULED: 'compression:scheduled',
  COMPRESSION_APPLIED: 'compression:applied',
  COMPRESSION_FAILED: 'compression:failed',
  COMPRESSION_ADVISED: 'compression:advised',
  COMPRESSION_FORCED: 'compression:forced',
});

// Archive
export const ArchiveEvents = Object.freeze({
  CHECKPOINT_SAVED: 'archive:checkpoint:saved',
  CHECKPOINT_RESTORED: 'archive:checkpoint:restored',
  CHECKPOINT_DELETED: 'archive:checkpoint:deleted',
});

// ... 其他 *Events 参见 events.js
```
