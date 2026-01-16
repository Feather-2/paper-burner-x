# tools - 运行时工具

内置工具定义和执行器。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块入口，统一导出 |
| `tool-executor.js` | ToolExecutor - 工具执行器 |
| `TaskTool.js` | 子任务分发工具 |
| `RecallTool.js` | 记忆检索工具 |
| `BacktrackTool.js` | 状态回溯工具 |
| `schema-validator.js` | 工具参数 Schema 验证 |
| `tool-quotas.js` | 工具配额管理 |

## 子目录

| 目录 | 职责 |
|------|------|
| `platform/` | 跨平台工具适配器 (Browser/Node) |

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

## Platform Tools

跨平台工具适配器，根据运行环境自动选择正确的实现。

```javascript
import { createPlatformTools, hasCapability } from 'js/agents/runtime/tools';

// 自动检测平台并创建适配器
const tools = await createPlatformTools({
  vfs,        // Browser: 必需
  basePath,   // 工作目录
});

// 文件操作 (两端可用)
const { files } = await tools.glob({ pattern: '**/*.js' });
const { matches } = await tools.grep({ pattern: 'TODO', path: 'src/' });
const { content } = await tools.read({ path: 'package.json' });
await tools.write({ path: 'notes.md', content: '# Notes' });
const { entries } = await tools.list({ path: 'src/' });

// 命令执行 (仅 Node)
if (tools.bash) {
  const { stdout, exitCode } = await tools.bash({ command: 'npm test' });
}

// 能力检测
if (hasCapability('bash')) {
  // Node 端才有
}
```

### 能力矩阵

| Tool | Browser | Node-like |
|------|---------|-----------|
| `glob` | VFS.glob / 内存遍历 | fast-glob / fs.readdir |
| `grep` | 内存搜索 | ripgrep / 手动搜索 |
| `read` | VFS.readText | fs.readFile |
| `write` | VFS.writeText | fs.writeFile |
| `list` | VFS.list | fs.readdir |
| `bash` | ❌ null | child_process |
