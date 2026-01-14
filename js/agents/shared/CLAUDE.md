# shared - 工具库

跨模块共享的工具函数、数据结构和服务。

## 核心导出

### Archive (归档/检查点)

| 文件 | 职责 |
|------|------|
| `archive/archive.js` | Archive, MapAdapter |
| `archive/checkpoint-schema.js` | 检查点类型定义和迁移 |

### Utils (工具函数)

| 文件 | 职责 |
|------|------|
| `utils/budget.js` | createBudgetManager, BudgetAction |
| `utils/robust-json.js` | robustParseJson (容错 JSON 解析) |
| `utils/safe-json.js` | safeJsonParse |
| `utils/json-candidate.js` | extractJsonCandidate, stripThinkingTags |
| `utils/logger.js` | createLogger, trackToolCall |
| `utils/error-utils.js` | safeExec, catchAndLog, makeSafe, wrapError |
| `utils/circuit-breaker.js` | CircuitBreaker, CircuitBreakerRegistry |
| `utils/value-utils.js` | isPlainObject, toNonEmptyString |
| `utils/deque.js` | 双端队列 |
| `utils/lru-cache.js` | LRU 缓存 |
| `utils/schema-validator.js` | 输入验证 |
| `utils/storage-quota.js` | 存储配额检测 |
| `utils/cancellation.js` | 取消令牌 |
| `utils/secure-id.js` | 安全 ID 生成 |
| `utils/storage-crypto.js` | 存储加密 |

### Platform (平台检测)

| 文件 | 职责 |
|------|------|
| `platform.js` | Platform 对象, isNodeLike() - 统一跨平台检测 |
| `utils/event-emitter.js` | EventEmitter - 跨平台事件发射器 |

### Embeddings (向量)

| 文件 | 职责 |
|------|------|
| `embeddings/embedding-service.js` | EmbeddingService |
| `embeddings/vector-index.js` | VectorIndex |
| `embeddings/hnsw-lite.js` | HNSW 近似最近邻 |

### Tokenizers

| 文件 | 职责 |
|------|------|
| `tokenizers/adaptive-token-counter.js` | 自适应 Token 计数 |

### Contracts (运行时契约)

| 文件 | 职责 |
|------|------|
| `contracts/rpc-message.js` | 跨 Agent RPC 消息验证 |
| `contracts/llm-response.js` | LLM 响应结构验证 |
| `contracts/tool-result.js` | 工具结果标准化 |

### Parser

| 文件 | 职责 |
|------|------|
| `parser/tree-sitter-wasm.js` | Tree-sitter WASM 封装 |

## 常用模式

```javascript
// 平台检测
import { Platform, isNodeLike } from 'js/agents/shared/platform.js';

if (Platform.isNode) {
  // Node.js 特定逻辑
}
if (isNodeLike()) {
  // Node.js 或 Bun
}
```

```javascript
import { robustParseJson, createLogger, CircuitBreaker } from 'js/agents/shared';

// 容错 JSON
const data = robustParseJson(maybeJson, { default: {} });

// 熔断器
const breaker = new CircuitBreaker({ failureThreshold: 3 });
const result = await breaker.call(() => fetchData());
```

```javascript
// 运行时契约验证
import { validateRpcRequest, normalizeToolResult } from 'js/agents/shared';

const req = validateRpcRequest(msg);
if (!req.ok) return console.warn(req.error);

const toolResult = normalizeToolResult(rawOutput);
// { ok, success, data, error?, meta? }
```
