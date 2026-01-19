# parallel - 并行任务图

DAG (有向无环图) 任务调度，支持依赖管理和分层并行执行。

## 核心类

### TaskGraph

```javascript
import { TaskGraph } from 'js/agents/runtime/parallel';

const graph = new TaskGraph();

// 添加任务（带依赖）
graph.addTask('fetch-data');
graph.addTask('parse', ['fetch-data']);      // 依赖 fetch-data
graph.addTask('validate', ['fetch-data']);   // 依赖 fetch-data
graph.addTask('process', ['parse', 'validate']); // 依赖多个
graph.addTask('save', ['process']);

// 获取分层结果（可并行的任务分组）
const levels = graph.getLevels();
// [
//   ['fetch-data'],           // Level 0
//   ['parse', 'validate'],    // Level 1 (可并行)
//   ['process'],              // Level 2
//   ['save'],                 // Level 3
// ]
```

## 算法

使用 **Kahn 算法** 进行分层拓扑排序：

```
1. 计算每个节点的入度 (依赖数)
2. 入度为 0 的节点放入第一层
3. 移除当前层节点，更新后续节点入度
4. 重复直到所有节点处理完毕
5. 检测循环依赖（若有节点未被处理）
```

## API

| 方法 | 说明 |
|------|------|
| `clear()` | 清空任务图 |
| `dispose()` | 释放图（`clear()` 别名） |
| `addTask(id, deps?)` | 添加任务，可选依赖列表 |
| `getTask(id)` | 获取任务节点，不存在返回 `null` |
| `getLevels(options?)` | 获取分层拓扑排序结果 |

### getLevels 选项

```javascript
graph.getLevels({
  allowMissingDependencies: true,  // 允许依赖不存在（跳过）
});
```

## 错误处理

- **循环依赖**：抛出 `Error: TaskGraph: cycle detected among tasks: a, b`
- **缺失依赖**：抛出 `Error: TaskGraph: missing dependency "x" required by "y"`
- **空任务 ID**：抛出 `TypeError: TaskGraph.addTask(taskId): taskId must be a non-empty string`

## 使用场景

- Agent 多工具并行调用
- 文档批量处理流水线
- PPT 多页并行渲染
- DeepSearch 多文档并行分析

## 与 Orchestrator 集成

```javascript
import { AgentOrchestrator } from 'js/agents/runtime';

const orchestrator = new AgentOrchestrator({
  taskGraph: graph,
  maxConcurrency: 4,
});

await orchestrator.execute();
```
