# contracts - 运行时契约验证

Agent 边界的轻量级结构验证，防止类型欺骗；并补充多 Agent 协作契约（消息、注册、任务分发、领导者选举）。

## 设计原则

- **边界验证，非全量验证** - 只在 Agent 边界检查
- **宽进严出** - 入口容错解析，出口严格格式化
- **fail-fast 但不 crash** - 返回结构化错误（`{ ok, value?, error? }`），不抛异常
- **协议先行** - 先定义消息/状态/任务契约，再接入运行时
- **可观测协作** - 通过统一事件广播协调状态变化

## 文件索引

| 文件 | 职责 |
|------|------|
| `index.js` | Contracts 聚合导出（推荐入口） |
| `rpc-message.js` | 跨 Agent RPC request/response 消息契约 |
| `agent-message.js` | 多 Agent 通信协议（task-request/result, status-update, knowledge-share） |
| `llm-response.js` | LLM 响应与 Tool Call 契约 |
| `tool-result.js` | 工具执行结果契约（validate + normalize） |
| `disposable.js` | 资源生命周期 Disposable 契约与释放辅助 |
| `agent-coordinator.js` | Coordinator 生命周期、心跳、Leader Election 与任务分配节拍 |
| `agent-registry.js` | Agent 描述、状态、能力与注册表契约 |
| `shared-task-board.js` | 共享任务板与任务协作契约 |

## 使用示例

```javascript
import {
  validateRpcRequest,
  validateRpcResponse,
  validateLlmResponse,
  validateToolCall,
  validateToolResult,
  normalizeToolResult,
  createCompositeDisposable,
  validateAgentMessage,
  createTaskRequest,
  createTaskResult,
  createStatusUpdate,
  createKnowledgeShare,
  AgentCoordinator,
} from 'js/agents/core/contracts';

// 验证 RPC 请求
const req = validateRpcRequest(incomingMessage);
if (!req.ok) {
  console.warn('Invalid RPC request:', req.error);
  return;
}

// 验证 Agent 消息
const taskReq = createTaskRequest('agent-a', 'search:execute', { query: 'hello' });
const taskReqValidated = validateAgentMessage(taskReq);
if (!taskReqValidated.ok) return;

// 构造任务结果 / 状态广播 / 知识共享
const taskRes = createTaskResult('agent-b', taskReq.correlationId, 'completed', { data: { ok: true } });
const status = createStatusUpdate('agent-a', 'busy', { progress: 50 });
const ks = createKnowledgeShare('agent-a', 'findings', { topK: 5 }, { contentType: 'json' });

// 验证 LLM 响应
const llm = validateLlmResponse(response);
if (!llm.ok) return;

// 验证并规范化 Tool 结果
const toolRes = validateToolResult(rawToolResult);
if (!toolRes.ok) return;
const safeToolRes = normalizeToolResult(toolRes.value);

// Disposable helper
const bag = createCompositeDisposable([]);

// Coordinator（registry/taskBoard/events 由外部注入）
const coordinator = new AgentCoordinator({
  agentId: 'coordinator-1',
  registry,
  taskBoard,
  events,
  heartbeatMs: 5000,
  assignIntervalMs: 2000,
});

coordinator.start();
coordinator.stop();
```

## 校验返回约定

所有 `validate*` API 统一返回：

```javascript
{ ok: true, value: ... }
// 或
{ ok: false, error: '...' } // error 为字符串
```

## 边界与职责

- `contracts` 负责**结构正确性**与**协议一致性**，不承担业务逻辑执行。
- 复杂业务校验（权限、配额、重试策略）应在 runtime/service 层处理。
- 协调器仅编排与调度，不直接耦合具体业务 Agent 实现。
