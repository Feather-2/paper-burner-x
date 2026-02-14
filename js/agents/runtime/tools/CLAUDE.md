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
| `BacktrackTool.js` | 硬回溯工具（返回 `backtrack` 控制信号） |
| `DMailTool.js` | 软回溯工具（标记 superseded 区间，返回 `dmail` 控制信号） |
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
  createDMailTool,
  TASK_TOOL_DEFINITION,
  RECALL_TOOL_DEFINITION,
  BACKTRACK_TOOL_DEFINITION,
  DMAIL_TOOL_DEFINITION,
} from 'js/agents/runtime/tools';

const taskTool = createTaskTool({ registry });
const recallTool = createRecallTool({ compressor });
const backtrackTool = createBacktrackTool({ backtrackManager });
const dmailTool = createDMailTool();

const executor = createToolExecutor({
  tools: {
    Task: { definition: TASK_TOOL_DEFINITION, handler: taskTool },
    Recall: { definition: RECALL_TOOL_DEFINITION, handler: recallTool },
    Backtrack: { definition: BACKTRACK_TOOL_DEFINITION, handler: backtrackTool },
    DMail: { definition: DMAIL_TOOL_DEFINITION, handler: dmailTool },
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

注意：

- 内置工具会调用 `context.logger.*` / `context.emit`；ToolExecutor 应保证注入最小实现。
- 建议默认注入 no-op `logger/emit`，避免工具因上下文缺失而抛错。
- 如果在测试/独立调用 handler，请显式传入最小 `context`（或在缺失时抛出明确配置错误）。

## 参数契约（内置工具）

- `Backtrack`
  - `reason`：非空字符串，说明回溯原因。
  - `checkpoint_id`：可选字符串，指定目标检查点。
  - `hint`：可选字符串，提供修正提示。
- `DMail`
  - `correction`：非空字符串，修正信息。
  - `supersede_from` / `supersede_to`：可选非负整数（turn 索引）。
  - `severity`：`minor | major | critical`，默认 `minor`。

## 内置工具信号 (AgentLoop 约定)

部分工具会返回控制流信号（signal），由上层 AgentLoop 捕获并执行对应动作，而不是把结果当成普通工具输出继续。

- `Backtrack` 信号：

```javascript
{
  ok: true,
  backtrack: {
    checkpointId,
    state,
    reason,
    hint,
  },
}
```

- `DMail` 信号：

```javascript
{
  ok: true,
  dmail: {
    correction,
    supersedeRange: { from, to } | null,
    severity: 'minor' | 'major' | 'critical',
    timestamp,
  },
}
```

实现建议：

- `backtrack.state` 可能较大且包含敏感上下文，避免在不可信日志/遥测通道中明文扩散。
- 失败分支返回结构化错误对象，并保持 `ok: false` 契约一致。