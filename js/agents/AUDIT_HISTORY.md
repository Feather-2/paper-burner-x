# Audit History - agents

Archived issues from security audits.

---

## Archived: 2026-02-06 (Phase 0 — 止血)

### [RESOLVED] A1. SharedContext 并行写入无保护 — HIGH
*Archived: 2026-02-06*

- **File**: `runtime/core/context/unified-agent-context.js`
- **Description**: SharedContext 的 addFinding/signal/recordDecision 无并发保护，并行 Stage 写入会丢数据。
- **Fix**: 在 UnifiedAgentContext 中引入 AsyncMutex，addClaim/signal/recordDecision 改为 async 并串行化写操作。

### [RESOLVED] A3. CRDT version vector 是空壳声明 — HIGH
*Archived: 2026-02-06*

- **File**: `core/crdt/sync-manager.js:73`
- **Description**: `this._versionVectors = new Map()` 被声明但从未使用，误导维护者。
- **Fix**: 删除死字段，添加注释说明 version vector 未实现，并引用 AUDIT.md A3。

### [RESOLVED] B1. SyncManager.dispose() 不清理 transport 订阅 — HIGH
*Archived: 2026-02-06*

- **File**: `core/crdt/sync-manager.js`
- **Description**: `_startPeerSync()` 注册了 EventBus 订阅但 `dispose()` 不清理，导致内存泄漏。
- **Fix**: 保存 bound handler 引用，添加 `dispose()` 方法清理 transport/documents/peers/pendingOps。

### [RESOLVED] E5. structuredClone 兼容——至少 4 种不同 fallback 写法 — MEDIUM
*Archived: 2026-02-06*

- **File**: 多处 (state-bus.js, BacktrackManager.js, serialization.js, state-diff.js, design-blackboard.js, tools.js, config-validator.js, tool-executor.js, checkpoint.js)
- **Description**: 每个位置自行判断 structuredClone 可用性并实现 fallback，检测方式和 fallback 行为不一致。
- **Fix**: 统一收敛到 `shared/utils/value-utils.js` 的 `deepClone()`（支持 Map/Set/循环引用/TypedArray）。删除 9 处重复实现，清除 checkpoint.js 中 ~90 行 hasCycle/cloneValueFallback 死代码。

---

## Archived: 2026-01-18

### [RESOLVED] security-eval
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/core/sandbox/skill-executor.js:897
- **Description**: Fallback sandbox 通过 new Function/with 执行代码；若不可信输入进入该路径，存在逃逸/主线程执行风险。
- **Suggestion**: 将 fallback 明确限定为 trusted-only，默认禁用不可信输入；优先使用 WASM/Worker 沙箱并在配置中硬性约束。
```
const fn = new Function('sandbox', wrappedCode);
```

### [RESOLVED] security-eval
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/runtime/core/js-adapter.js:437
- **Description**: JS 运行时适配器同样使用 new Function 执行动态代码，存在与上相同的执行风险。
- **Suggestion**: 仅在可信执行策略下启用；建议迁移到 Worker/WASM 沙箱并禁用 eval fallback。
```
const fn = new Function('sandbox', `
```

### [RESOLVED] browser-compat
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/runtime/transports/process-transport.js:8
- **Description**: 非 .node 文件中直接引入 node:child_process，若被浏览器打包路径误引用会导致构建/运行失败。
- **Suggestion**: 确保仅通过 Node 入口导出（条件 exports/动态导入），或改为 .node.js 并提供 browser stub。
```
import { spawn } from "node:child_process";
```

### [RESOLVED] browser-compat
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/runtime/tools/tool-executor-worker.js:2
- **Description**: node:worker_threads 导入使该模块在浏览器环境不可用，需防止被错误引用。
- **Suggestion**: 限定在 Node-only 入口使用，或增加浏览器替代实现并做条件加载。
```
import { parentPort } from "node:worker_threads";
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/vfs/path.js:80
- **Description**: VFS 路径工具导出函数缺少 JSDoc（dirnameVfsPath/basenameVfsPath/joinVfsPath）。
- **Suggestion**: 为每个导出函数补充 @param/@returns，保持 JSDoc 覆盖率一致。
```
export function dirnameVfsPath(inputPath) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/vfs/glob.js:53
- **Description**: Glob 工具导出函数缺少 JSDoc（expandBraces/globToRegExp/matchGlob）。
- **Suggestion**: 补充参数/返回值类型与错误行为说明的 JSDoc。
```
export function expandBraces(pattern) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/llm/rate-limit.js:48
- **Description**: Rate-limit 导出函数缺少 JSDoc（normalizeRateLimitConfig/loadRateLimitConfig）。
- **Suggestion**: 补充 @param/@returns 并注明 storage fallback 行为。
```
export function normalizeRateLimitConfig(input, fallback = {}) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/llm/provider.js:5
- **Description**: 模型校验导出函数缺少 JSDoc（normalizeModelTags/assertModelEntry/assertUsageConfig/assertChatMessages/assertChatResponse/assertProvider）。
- **Suggestion**: 为所有导出 helper 增加 JSDoc 类型注解，保持公共 API 一致性。
```
export function normalizeModelTags(tags) {
```

### [RESOLVED] logging
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/core/state-bus.js:414
- **Description**: 核心模块直接使用 console.error，绕过统一日志体系，影响可观测性与日志收敛。
- **Suggestion**: 改为 createLogger() 并使用统一日志等级，或用 DEBUG 条件包裹。
```
console.error(`[StateBus] Subscriber error for "${pattern}":`, err);
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/vfs/vfs.storage.js:437
- **Description**: async 方法内 catch 仅 rethrow，未增加上下文或处理策略，属于冗余错误处理。
- **Suggestion**: 移除该 catch，或使用 `new Error(..., { cause: err })` 追加上下文。
```
throw err;
```

### [RESOLVED] todo
*Archived: 2026-01-18T21:05:10.093Z*

- **File**: js/agents/runtime/core/js-adapter.js:10
- **Description**: 存在未完成的沙箱增强 TODO，影响安全层次的完整性。
- **Suggestion**: 尽快跟踪为 Issue 并实现或移除 TODO 标记。
```
* TODO(AI4Sci): 添加 quickjs-emscripten WASM 沙箱作为第三层
```

---

