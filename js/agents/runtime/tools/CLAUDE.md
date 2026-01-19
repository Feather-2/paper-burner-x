# tools - 运行时工具

内置工具定义和执行器。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块入口，统一导出 |
| `tool-executor.js` | ToolExecutor - 工具执行器 |
| `tool-executor-worker-shared.js` | Worker 执行器共享逻辑 (Web/Node) |
| `tool-executor-webworker.js` | Web Worker 入口 (浏览器隔离执行) |
| `tool-executor-worker.js` | Node worker_threads 入口 |
| `python-runtime-worker.js` | Pyodide Python 运行时 Worker |
| `TaskTool.js` | 子任务分发工具 |
| `RecallTool.js` | 记忆检索工具 |
| `BacktrackTool.js` | 状态回溯工具 |
| `DMailTool.js` | D-Mail 软回溯工具 (Steins;Gate 梗) |
| `schema-validator.js` | 工具参数 Schema 验证与 hook |
| `tool-quotas.js` | 工具配额管理与契约验证 |

## 子目录

| 目录 | 职责 |
|------|------|
| `platform/` | 跨平台工具适配器 (Browser/Node) |

## ToolExecutor

```javascript
import {
  createToolExecutor,
  createTaskTool,
  createRecallTool,
  createBacktrackTool,
  TASK_TOOL_DEFINITION,
  RECALL_TOOL_DEFINITION,
  BACKTRACK_TOOL_DEFINITION,
} from 'js/agents/runtime/tools';

const taskTool = createTaskTool({ registry });
const recallTool = createRecallTool({ compressor });
const backtrackTool = createBacktrackTool({ backtrackManager });

const executor = createToolExecutor({
  tools: {
    Task: { definition: TASK_TOOL_DEFINITION, handler: taskTool },
    Recall: { definition: RECALL_TOOL_DEFINITION, handler: recallTool },
    Backtrack: { definition: BACKTRACK_TOOL_DEFINITION, handler: backtrackTool },
  },
  hooks: hookRegistry,
});

const result = await executor.execute('Task', {
  subagent_type: 'Coder',
  prompt: 'search web',
});
```

### Worker 隔离执行

```javascript
const tool = {
  definition: SOME_TOOL_DEFINITION,
  handler,
  worker: {
    moduleUrl: './tools/some-tool.js',
    exportName: 'handler',
    moduleUrlPolicy: 'sameOrigin', // allow | sameOrigin | local
    allowedOrigins: ['https://example.com'],
  },
};
```

## 内置工具

### TaskTool

```javascript
import { createTaskTool } from 'js/agents/runtime/tools';

const taskTool = createTaskTool({ registry });

// 定义
TASK_TOOL_DEFINITION = {
  name: 'Task',
  description: 'Launch a specialized agent to handle a complex task.',
  parameters: {
    subagent_type: 'string',
    prompt: 'string',
    context_mode: 'string',
    model_tier: 'string',
  },
};
```

### RecallTool

```javascript
import { createRecallTool } from 'js/agents/runtime/tools';

const recallTool = createRecallTool({ compressor });

// 定义
RECALL_TOOL_DEFINITION = {
  name: 'Recall',
  description: 'Recall relevant memories',
  parameters: { action: 'string', query: 'string', archive_id: 'string', limit: 'number' },
};
```

### BacktrackTool

```javascript
import { createBacktrackTool } from 'js/agents/runtime/tools';

const backtrackTool = createBacktrackTool({ backtrackManager });

// 定义
BACKTRACK_TOOL_DEFINITION = {
  name: 'Backtrack',
  description: 'Revert to a previous state',
  parameters: { reason: 'string', checkpoint_id: 'string', hint: 'string' },
};
```

### DMailTool

```javascript
import { createDMailTool, DMAIL_TOOL_DEFINITION } from 'js/agents/runtime/tools';

const dmailTool = createDMailTool();

// 调用 (发送 D-Mail 软回溯)
const result = await dmailTool(
  { correction: '前面的 API 调用应该用 POST 而不是 GET', severity: 'major' },
  { emit: (event, payload) => eventBus.emit(event, payload) }
);

// 定义
DMAIL_TOOL_DEFINITION = {
  name: 'DMail',
  description: 'Soft backtrack: send correction to past self without deleting history',
  parameters: { correction: 'string', supersede_from: 'number?', supersede_to: 'number?', severity: 'minor|major|critical' },
};
```

## Schema Validator

提供工具参数验证与验证 hook：

- `validateArgs(args, schema)`
- `normalizeSchema(schema)`
- `createValidationHook(options)`

## Python Runtime Worker

`python-runtime-worker.js` 在独立 Worker 中运行 Pyodide，支持：

- SRI 校验加载 `pyodide.mjs`
- preload 计划：builtin/micropip/wheels
- 可选 VFS Proxy 挂载 (/vfs + aliases)

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
