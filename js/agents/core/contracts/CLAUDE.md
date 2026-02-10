# contracts - 运行时契约验证

Agent 边界的轻量级结构验证，防止类型欺骗。

## 设计原则

- **边界验证，非全量验证** - 只在 Agent 边界检查
- **宽进严出** - 入口容错解析，出口严格格式化
- **fail-fast 但不 crash** - 返回结构化错误（`{ ok, value?, error? }`），不抛异常

## 文件索引

| 文件 | 职责 |
|------|------|
| `index.js` | Contracts 聚合导出（推荐入口） |
| `rpc-message.js` | 跨 Agent RPC request/response 消息契约 |
| `agent-message.js` | 多 Agent 通信协议（task-request/result, status-update, knowledge-share） |
| `llm-response.js` | LLM 响应与 Tool Call 契约 |
| `tool-result.js` | 工具执行结果契约（validate + normalize） |
| `disposable.js` | 资源生命周期 Disposable 契约与释放辅助 |

## 使用示例

```javascript
import {
  validateRpcRequest,
  validateRpcResponse,
  validateLlmResponse,
  validateToolCall,
  validateToolResult,
  normalizeToolResult,
} from 'js/agents/core/contracts';

// 验证 RPC 请求
const req = validateRpcRequest(incomingMessage);
if (!req.ok) {
  console.warn('Invalid RPC request:', req.error);
  return;
}

// ... 处理 req.value

// 验证 RPC 响应（发送前）
const res = validateRpcResponse(outgoingMessage);
if (!res.ok) {
  console.warn('Invalid RPC response:', res.error);
}

// === 多 Agent 通信协议 ===
import {
  validateAgentMessage,
  createTaskRequest,
  createTaskResult,
  createStatusUpdate,
  createKnowledgeShare,
} from 'js/agents/core/contracts';

// 创建并验证任务请求
const taskReq = createTaskRequest('agent-a', 'search:execute', { query: 'hello' });
const validated = validateAgentMessage(taskReq);

// 创建任务结果
const result = createTaskResult('agent-b', taskReq.correlationId, 'completed', { data: {...} });

// 广播状态更新
const status = createStatusUpdate('agent-a', 'busy', { progress: 50 });

// 共享知识
const knowledge = createKnowledgeShare('agent-a', 'findings', { ... }, { contentType: 'json' });

// 验证 LLM 响应
const llm = validateLlmResponse(response);
if (!llm.ok) {
  // 降级处理
  return;
}

// 验证单个 Tool Call（可选：逐个校验更精确的错误位置）
const call0 = validateToolCall(llm.value.toolCalls?.[0], 0);
if (!call0.ok) {
  console.warn('Invalid tool call:', call0.error);
}

// 严格验证工具结果（出站）
const toolResult = validateToolResult(rawResult);
if (!toolResult.ok) {
  console.warn('Invalid tool result:', toolResult.error);
}

// 或：宽进严出的标准化（入站/兼容旧格式）
const normalized = normalizeToolResult(rawResult);
// 保证有 { ok, success, data, error?, meta? }
```

```javascript
import { disposeAll, safeDispose, using } from 'js/agents/core/contracts/disposable.js';

// 安全释放单个资源
await safeDispose(resource, {
  onError: (error) => reportError(error),
});

// 批量释放
const results = await disposeAll(resources);

// 使用资源后自动释放
const value = await using(resource, async (r) => r.read());
```

## 验证边界

```
┌─────────────────────────────────────────┐
│  Agent A                                │
│                                         │
│  ┌──────────┐    ┌───────────────────┐  │
│  │ LLM 响应 │ ←─ │ validateLlmResponse│  │
│  └──────────┘    └───────────────────┘  │
│       ↓                                 │
│  ┌──────────┐    ┌───────────────────┐  │
│  │ ToolCalls│ ←─ │ validateToolCall   │  │
│  └──────────┘    └───────────────────┘  │
│       ↓                                 │
│  ┌──────────┐    ┌───────────────────┐  │
│  │ Tool结果 │ ←─ │ normalizeToolResult│  │
│  └──────────┘    └───────────────────┘  │
└─────────────────────────────────────────┘
        ↑
        │ MessageBus / RPC
        │
┌───────┴─────────────────────────────────┐
│  Agent B                                │
│  ┌──────────┐    ┌───────────────────┐  │
│  │ RPC 请求 │ ←─ │ validateRpcRequest │  │
│  └──────────┘    └───────────────────┘  │
│       ↓                                 │
│  ┌──────────┐    ┌───────────────────┐  │
│  │ RPC 响应 │ →─ │ validateRpcResponse│  │
│  └──────────┘    └───────────────────┘  │
└─────────────────────────────────────────┘
```
