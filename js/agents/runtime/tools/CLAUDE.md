# tools - 运行时工具

内置工具定义和执行器。

## 核心文件

| 文件 | 职责 |
|------|------|
| `tool-executor.js` | ToolExecutor - 工具执行器 |
| `TaskTool.js` | 子任务分发工具 |
| `RecallTool.js` | 记忆检索工具 |
| `BacktrackTool.js` | 状态回溯工具 |

## ToolExecutor

```javascript
import { ToolExecutor, createToolExecutor } from 'js/agents/runtime/tools';

const executor = createToolExecutor({
  tools: [taskTool, recallTool, backtrackTool],
  hooks: hookRegistry,
});

const result = await executor.execute('task', { goal: 'search web' });
```

## 内置工具

### TaskTool

```javascript
import { createTaskTool, ContextMode } from 'js/agents/runtime/tools';

const taskTool = createTaskTool({
  orchestrator,
  contextMode: ContextMode.INHERIT,
});

// 定义
TASK_TOOL_DEFINITION = {
  name: 'task',
  description: 'Spawn a subtask',
  parameters: { goal: 'string', context: 'object' },
};
```

### RecallTool

```javascript
import { createRecallTool } from 'js/agents/runtime/tools';

const recallTool = createRecallTool({ memoryStore, embeddingService });

// 定义
RECALL_TOOL_DEFINITION = {
  name: 'recall',
  description: 'Recall relevant memories',
  parameters: { query: 'string', limit: 'number' },
};
```

### BacktrackTool

```javascript
import { createBacktrackTool } from 'js/agents/runtime/tools';

const backtrackTool = createBacktrackTool({ stateManager });

// 定义
BACKTRACK_TOOL_DEFINITION = {
  name: 'backtrack',
  description: 'Revert to a previous state',
  parameters: { checkpoint: 'string' },
};
```
