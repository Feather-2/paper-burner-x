# utils (shared) - 工具函数

通用工具函数集合。

## JSON 处理

| 文件 | 函数 | 用途 |
|------|------|------|
| `robust-json.js` | robustParseJson | 容错 JSON 解析 |
| `safe-json.js` | safeJsonParse | 安全 JSON 解析 |
| `json-candidate.js` | extractJsonCandidate | 从文本提取 JSON |

## 错误处理

| 文件 | 函数 | 用途 |
|------|------|------|
| `error-utils.js` | safeExec, catchAndLog, makeSafe | 安全执行 |
| `error-utils-extended.js` | toErrorMessage, safeExecAsync, withRetry | 扩展错误处理 |
| `error-classifier.js` | 错误分类 |

## 数据结构

| 文件 | 类 | 用途 |
|------|-----|------|
| `deque.js` | Deque | 双端队列 |
| `lru-cache.js` | LRUCache | LRU 缓存 |

## 容错

| 文件 | 类/函数 | 用途 |
|------|---------|------|
| `circuit-breaker.js` | CircuitBreaker | 熔断器 |
| `cancellation.js` | CancellationToken, checkCancelled, withCancellation, isAbortError | 取消令牌与 AbortSignal 取消支持（含 reason 透传） |

## 存储

| 文件 | 用途 |
|------|------|
| `storage-quota.js` | 存储配额检测 |
| `storage-crypto.js` | 存储加密 |
| `token-cache.js` | Token 缓存 |

## 验证

| 文件 | 用途 |
|------|------|
| `schema-validator.js` | 输入验证 |
| `value-utils.js` | isPlainObject, toNonEmptyString |
| `safe-regex.js` | 安全正则 |

## 事件与监控

| 文件 | 类/函数 | 用途 |
|------|---------|------|
| `event-emitter.js` | EventEmitter | 事件发射器 |
| `file-watcher.js` | FileWatcher, createFileWatcher | 文件监听（原生/轮询） |

## 响应限制

| 文件 | 函数 | 用途 |
|------|------|------|
| `response-limits.js` | readTextWithLimit, readJsonWithLimit | 响应体大小限制 |

## 预算与运行时控制

| 文件 | 类/函数 | 用途 |
|------|---------|------|
| `budget.js` | BudgetManager, BudgetAction | Token 预算记账、阈值回调、降级/停止策略 |

## 其他

| 文件 | 用途 |
|------|------|
| `logger.js` | 日志 |
| `message-utils.js` | 消息处理 |
| `stage-api.js` | Stage API 创建 |
| `secure-id.js` | 安全 ID 生成 |
| `wasm-support.js` | WASM 支持检测 |