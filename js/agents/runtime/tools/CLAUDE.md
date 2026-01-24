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

## Handler Context 约定

工具 handler 的统一签名：`async (args, context) => result`。

常见 `context` 字段（具体以 ToolExecutor 传入为准）：

- `context.logger`：用于记录工具执行日志（建议支持 `info/warn/error`）。
- `context.emit(event, payload)`：用于发布运行时事件（事件名格式：`domain:action`，例如 `agent:step`）。

注意：handler 不应假设 `logger/emit` 永远存在；建议对缺失情况做容错或让错误明确向上传播。

## Worker 隔离执行

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

### BacktrackTool

用途：允许模型在发现错误、死胡同或需要尝试不同路径时，请求回溯到之前的 checkpoint。

Handler 工厂：`createBacktrackTool({ backtrackManager })`

参数（args）：

- `reason` (string, required)：为什么要回溯
- `checkpoint_id` (string, optional)：指定回溯点 ID
- `hint` (string, optional)：给“未来的自己”的修正提示

返回：一个“回溯信号”对象，由 AgentLoop 捕获并执行真正的状态还原：

```javascript
{
  ok: true,
  backtrack: {
    checkpointId,
    state,
    reason,
    hint,
  }
}
```

失败时返回：

```javascript
{ ok: false, error: '...' }
```

事件：

- `agent:backtrackRequested`：当回溯信号准备完成并请求执行
- `agent:backtrackFailed`：当准备回溯失败

### DMailTool

用途：软回溯（soft backtrack），标记一段 turn 范围为“已被修正/覆盖”，但不删除历史。

Handler 工厂：`createDMailTool(options?)`

- `options.now?: () => number`：可注入时间戳提供器（ms since epoch）

参数（args）：

- `correction` (string, required)：发送给过去自己的修正信息
- `supersede_from` (number, optional)：起始 turn（>= 0 的整数）
- `supersede_to` (number, optional)：结束 turn（>= 0 的整数，含）
- `severity` ("minor"|"major"|"critical", optional)：严重程度（默认 "minor"）

建议返回结构：

```javascript
{ ok: true, dmail: { correction, supersedeRange, severity, timestamp } }
```

失败时返回：

```javascript
{ ok: false, error: '...' }
```
