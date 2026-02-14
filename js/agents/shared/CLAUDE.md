# shared - 工具库

跨模块共享的工具函数、数据结构、运行时契约与跨平台能力。

## 关键概念

- 统一导出：`index.js` 聚合高频 API，支持按文件路径细粒度导入。
- 平台检测：`platform.js` 统一 Node/Bun/Deno/Browser 判定，并提供 `isNodeLike`。
- Deno 兼容边界：可识别 Deno，但 VFS/Skills/MCP stdio 仍按降级路径运行（非完整支持）。
- 生命周期契约：`contracts/disposable.js` + `base/disposable-base.js` 统一资源注册与释放。
- 稳健性与安全：预算、熔断、取消、错误分类、响应限制、safe regex、防原型污染 JSON 解析。
- 跨端能力：Tree-sitter WASM、存储配额检测、WebCrypto AES-GCM、本地缓存与 token 估算。

## 核心文件列表

| 文件 | 职责 |
|------|------|
| `index.js` | shared 聚合导出入口（Platform/Base/Utils/Storage/Resilience 等） |
| `platform.js` | 运行时检测（node/bun/deno/browser）与 `isNodeLike` |
| `base/disposable-base.js` | `DisposableBase` 基类，统一 `dispose` 生命周期 |
| `contracts/disposable.js` | Disposable 契约与安全释放工具 |
| `contracts/rpc-message.js` | RPC 请求/响应结构验证 |
| `contracts/llm-response.js` | LLM 响应与 ToolCall 结构验证 |
| `contracts/tool-result.js` | 工具结果标准化 |
| `archive/archive.js` | `Archive` 与 `MapAdapter` 归档读写 |
| `archive/checkpoint-schema.js` | 检查点结构定义与迁移 |
| `parser/tree-sitter-wasm.js` | 浏览器 Tree-sitter WASM 初始化与语言加载 |
| `tokenizers/adaptive-token-counter.js` | 自适应 token 计数（启发式 + tiktoken/WASM） |
| `embeddings/embedding-service.js` | `EmbeddingService` 与工厂函数 |
| `embeddings/vector-index.js` | `VectorIndex` 向量存储与检索 |
| `embeddings/hnsw-lite.js` | `HnswLiteIndex` 近似最近邻索引 |
| `utils/message-utils.js` | 系统提示注入与消息处理辅助 |
| `utils/stage-api.js` | Stage API 创建、合并、校验与子 API 派生 |
| `utils/budget.js` | token/递归预算管理 |
| `utils/logger.js` | 统一日志、工具调用追踪、事件日志 |
| `utils/error-utils.js` | `safeExec`/`catchAndLog` 等错误包装 |
| `utils/error-utils-extended.js` | Error 包装、Result 风格返回、错误消息规范化 |
| `utils/error-classifier.js` | DeepSearch/Design 错误分类与重试判定 |
| `utils/cancellation.js` | `AbortSignal` 取消检查与信号合并 |
| `utils/robust-json.js` | 容错 JSON 解析 |
| `utils/safe-json.js` | 安全 JSON 解析与 `protoSafeReviver` |
| `utils/json-candidate.js` | 文本 JSON 片段提取与思维标签剥离 |
| `utils/schema-validator.js` | 搜索/分块/grep 结果结构校验与错误码 |
| `utils/response-limits.js` | 文本/JSON 响应体大小限制与超限错误 |
| `utils/safe-regex.js` | ReDoS 风险检测与安全匹配 |
| `utils/value-utils.js` | 值转换、规范化、深拷贝、token 估算 |
| `utils/token-cache.js` | token 估算缓存与统计 |
| `utils/deque.js` | 双端队列基础结构 |
| `utils/event-emitter.js` | 轻量事件发射器 |
| `utils/lru-cache.js` | LRU 缓存与自动清理缓存 |
| `utils/file-watcher.js` | 文件监听抽象与原生监听能力检测 |
| `utils/secure-id.js` | 安全随机 ID/UUID/时间戳 ID 生成 |
| `utils/storage-quota.js` | LocalStorage/IndexedDB 容量估算与清理策略 |
| `utils/storage-crypto.js` | 存储加密前缀管理与 AES-GCM 字符串加解密 |
| `utils/circuit-breaker.js` | 熔断器与全局注册表 |

## 使用建议

- 浏览器侧优先使用 `safeJsonParse` + `schema-validator` 处理外部输入。
- 涉及大响应体读取时统一使用 `readTextWithLimit` / `readJsonWithLimit`。
- 涉及插件或工具执行链时，优先组合 `cancellation`、`budget`、`circuit-breaker` 控制风险。