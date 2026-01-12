# archive - 归档和检查点

运行状态归档和版本迁移。

## 核心文件

| 文件 | 职责 |
|------|------|
| `archive.js` | Archive, MapAdapter |
| `checkpoint-schema.js` | 检查点类型和迁移 |

## Archive

```javascript
import { Archive, MapAdapter } from 'js/agents/shared/archive';

const archive = new Archive({
  adapter: new MapAdapter(),
});

// 保存
await archive.save('run-123', state);

// 加载
const restored = await archive.load('run-123');

// 列出
const runs = await archive.list();
```

## 检查点

```javascript
import { createCheckpoint, migrateCheckpoint, CheckpointType } from 'js/agents/shared/archive';

const checkpoint = createCheckpoint({
  type: CheckpointType.FULL,
  state: agentState,
  timestamp: Date.now(),
});

// 版本迁移
const migrated = migrateCheckpoint(oldCheckpoint, targetVersion);
```
