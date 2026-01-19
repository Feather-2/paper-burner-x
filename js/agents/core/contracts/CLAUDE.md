# contracts - 运行时契约验证

Agent 边界的轻量级结构验证，防止类型欺骗。

## 设计原则

- **边界验证，非全量验证** - 只在 Agent 边界检查
- **宽进严出** - 入口容错解析，出口严格格式化
- **fail-fast 但不 crash** - 返回结构化错误，不抛异常

## 文件索引

| 文件 | 职责 |
|------|------|
| `rpc-message.js` | 跨 Agent RPC 消息契约 |
| `llm-response.js` | LLM 响应结构契约 |
| `tool-result.js` | 工具执行结果契约 |
| `disposable.js` | 资源生命周期 Disposable 契约 |

## 使用示例

```javascript
import {
  validateRpcRequest,
  validateLlmResponse,
  normalizeToolResult,
} from 'js/agents/shared/contracts';

// 验证 RPC 请求
const result = validateRpcRequest(incomingMessage);
if (!result.ok) {
  console.warn('Invalid RPC:', result.error);
  return;
}
const { type, payload } = result.value;

// 验证 LLM 响应
const llmResult = validateLlmResponse(response);
if (!llmResult.ok) {
  // 降级处理
}

// 标准化工具结果
const normalized = normalizeToolResult(rawResult);
// 保证有 { ok, success, data, error?, meta? }
```

```javascript
import { disposeAll, safeDispose, using } from 'js/agents/shared/contracts/disposable.js';

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
│  ┌──────────┐    ┌──────────┐           │
│  │ LLM 响应 │ ←─ │validateLlmResponse   │
│  └──────────┘    └──────────┘           │
│       ↓                                 │
│  ┌──────────┐    ┌──────────┐           │
│  │ Tool结果 │ ←─ │normalizeToolResult   │
│  └──────────┘    └──────────┘           │
└─────────────────────────────────────────┘
        ↑
        │ MessageBus
        │
┌───────┴─────────────────────────────────┐
│  ┌──────────┐    ┌──────────┐           │
│  │ RPC 消息 │ ←─ │validateRpcRequest    │
│  └──────────┘    └──────────┘           │
│  Agent B                                │
└─────────────────────────────────────────┘
```

## 返回格式

所有验证函数返回统一格式：

```typescript
type ValidationResult<T> =
  | { ok: true, value: T }
  | { ok: false, error: string }
```
