# parallel - 并行任务

任务图和并行执行。

## 核心文件

| 文件 | 职责 |
|------|------|
| `task-graph.js` | TaskGraph - DAG 任务图 |

## TaskGraph

```javascript
import { TaskGraph } from 'js/agents/runtime/parallel';

const graph = new TaskGraph();

// 添加任务
graph.addTask('fetch-data', fetchTask);
graph.addTask('process', processTask, ['fetch-data']);  // 依赖 fetch-data
graph.addTask('save', saveTask, ['process']);

// 并行执行
const results = await graph.execute({ maxConcurrency: 4 });
```
