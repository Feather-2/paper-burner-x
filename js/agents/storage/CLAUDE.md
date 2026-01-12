# storage - 存储抽象

运行时数据持久化。

## 核心文件

| 文件 | 职责 |
|------|------|
| `run-store.js` | RunStore - 运行记录存储 |

## RunStore

存储 Agent 运行的状态、事件和检查点。

```javascript
import { RunStore } from 'js/agents/storage';

const store = new RunStore({ vfs });

// 保存运行状态
await store.save(runId, {
  status: 'completed',
  events: [...],
  checkpoint: {...},
});

// 加载运行状态
const run = await store.load(runId);

// 列出所有运行
const runs = await store.list();
```

## 与 VFS 集成

RunStore 使用 VFS 抽象层，支持：
- 浏览器：OPFS / localStorage
- Node.js：文件系统
- 测试：内存

```javascript
import { createVfs } from 'js/agents/vfs';
import { RunStore } from 'js/agents/storage';

const vfs = await createVfs();
const store = new RunStore({ vfs });
```
