# shared - 工具库

跨模块共享的工具函数、数据结构、运行时契约与跨平台能力。

## 关键概念

- 入口与导出：`index.js` 仅聚合常用 API，其余工具需按文件路径导入。
- 平台检测：`platform.js` 统一 Node/Bun/Deno/Browser 运行时判定。
- 资源生命周期：`contracts/disposable.js` 定义契约，`base/disposable-base.js` 提供可复用基类。
- 稳健性：预算管理、熔断、取消、错误分类/包装，避免级联故障。
- Token 计数：自适应计数器先启发式、WASM/tiktoken 可用时升级。
- WASM 能力：`wasm-support.js` 探测 WebAssembly；Tree-sitter 仅在 Web 初始化。
- 存储与安全：localStorage/IndexedDB 配额检测 + WebCrypto AES-GCM 加密。
- 响应限制与安全：响应体限制、safe regex、防 ReDoS。

## 核心文件列表

| 文件 | 职责 |
|------|------|
| `index.js` | shared 聚合导出（Archive/Utils/Contracts/Embeddings 等） |
| `platform.js` | 运行时检测（node/bun/deno/browser）与 isNodeLike |
| `base/disposable-base.js` | DisposableBase 基类，统一 dispose、注册清理 |
| `parser/tree-sitter-wasm.js` | 浏览器 Tree-sitter WASM 初始化与语言加载 |
| `tokenizers/adaptive-token-counter.js` | 自适应 token 计数（启发式 + tiktoken/WASM） |
| `archive/archive.js` | Archive, MapAdapter（归档存取） |
| `archive/checkpoint-schema.js` | 检查点结构与迁移 |
| `contracts/rpc-message.js` | RPC 请求/响应结构验证 |
| `contracts/llm-response.js` | LLM 响应/ToolCall 验证 |
| `contracts/tool-result.js` | 工具结果标准化 |
| `contracts/disposable.js` | Disposable 契约与安全释放 |
| `embeddings/embedding-service.js` | EmbeddingService / createEmbeddingService |
| `embeddings/vector-index.js` | VectorIndex（向量存储与检索） |
| `embeddings/hnsw-lite.js` | HnswLiteIndex（近似最近邻） |
| `utils/budget.js` | Token 预算与递归预算管理 |
| `utils/circuit-breaker.js` | 熔断器与全局注册表 |
| `utils/cancellation.js` | AbortSignal 取消检查/链式信号 |
| `utils/error-utils.js` | safeExec/catchAndLog 等错误包装 |
| `utils/error-utils-extended.js` | Result/重试/边界封装 |
| `utils/error-classifier.js` | DeepSearch/Design 错误分类 |
| `utils/robust-json.js` | 容错 JSON 解析 |
| `utils/safe-json.js` | 安全 JSON 解析 |
| `utils/json-candidate.js` | 文本中提取 JSON/剥离标签 |
| `utils/schema-validator.js` | 搜索/工具结果结构校验 |
| `utils/response-limits.js` | 响应体大小限制（Text/JSON） |
| `utils/safe-regex.js` | ReDoS 规避与 glob→regex |
| `utils/value-utils.js` | 值转换与 token 估算 |
| `utils/token-cache.js` | token 估算缓存 |
| `utils/logger.js` | 统一日志与 trackToolCall |
| `utils/message-utils.js` | 注入 system hint（缓存友好） |
| `utils/stage-api.js` | stageApi 校验/合并/派生/工具调用 |
| `utils/event-emitter.js` | 跨平台 EventEmitter |
| `utils/file-watcher.js` | FileWatcher（Node 原生/浏览器轮询） |
| `utils/storage-quota.js` | localStorage/IndexedDB 配额检测与安全写入 |
| `utils/storage-crypto.js` | WebCrypto AES-GCM 加解密 |
| `utils/secure-id.js` | 密码学随机 ID/UUID |
| `utils/wasm-support.js` | WASM/线程支持检测 |
| `utils/deque.js` | 双端队列 |
| `utils/lru-cache.js` | LRU 缓存 |

## 子模块索引

- `archive/` 归档与检查点 → `js/agents/shared/archive/CLAUDE.md`
- `contracts/` 运行时契约/Disposable → `js/agents/shared/contracts/CLAUDE.md`
- `embeddings/` 向量嵌入与索引 → `js/agents/shared/embeddings/CLAUDE.md`
- `utils/` 通用工具集合 → `js/agents/shared/utils/CLAUDE.md`
- `tokenizers/` Token 计数器（自适应 + tiktoken/WASM）
- `base/` DisposableBase 基类（资源释放、订阅/定时器注册）
- `parser/` Tree-sitter WASM 封装（浏览器初始化与语言加载）
