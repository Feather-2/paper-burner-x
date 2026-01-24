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

注意：

- 内置工具可能会直接调用 `context.logger.*` / `context.emit`；ToolExecutor 应保证注入最小实现。
- 如果你在测试/独立调用 handler，请传入最小 `context`（例如提供 no-op 的 `logger/emit`），或让缺失时抛出明确的配置错误。

## 内置工具信号 (AgentLoop 约定)

部分工具会返回控制流信号（signal），由上层 AgentLoop 捕获并执行对应动作，而不是把结果当成普通工具输出继续对话。

目前约定的信号形态：

- Backtrack：`{ ok: true, backtrack: { checkpointId, state, reason, hint } }`
- DMail：`{ ok: true, dmail: { correction, supersedeRange, severity, timestamp } }`

失败时通常返回：`{ ok: false, error: '...' }`。

## BacktrackTool

用途：硬回溯到某个 Checkpoint（由 AgentLoop 执行真正的状态还原）。

参数：

- `reason`：为什么要回溯（必填）。
- `checkpoint_id`：可选的特定回溯点 ID。
- `hint`：给未来的自己/后续步骤的修正提示（可选）。

事件：

- `agent:backtrackRequested`：回溯请求已生成（payload 为 `backtrack` 对象）。
- `agent:backtrackFailed`：回溯准备失败（payload 包含 `checkpoint_id` 与失败原因）。

返回：

- 成功：`{ ok: true, backtrack: { checkpointId, state, reason, hint } }`
- 失败：`{ ok: false, error: 'Backtrack failed: ...' }`

## DMailTool

用途：软回溯（不删除历史），把一段 turn 标记为已被更正/作废（superseded）。

参数：

- `correction`：更正信息（必填）。
- `supersede_from` / `supersede_to`：要标记为 superseded 的 turn 区间（可选，非负整数；闭区间）。
- `severity`：严重级别（可选：`minor` / `major` / `critical`，默认 `minor`）。

可选创建参数：

- `now()`：注入时间戳提供器（返回 ms since epoch），便于测试。

返回：

- 成功：`{ ok: true, dmail: { correction, supersedeRange, severity, timestamp } }`
- 失败：`{ ok: false, error: '...' }`

## Worker 隔离执行

```javascript
const tool = {
  definition: SOME_TOOL_DEFINITION,
  handler,
  worker: {
    moduleUrl: './tools/some-tool.js',
    exportName: 'handler',
    // ... 其他 worker 配置
  },
};
```
