# Audit History - agents

Archived issues from security audits.

---

## Archived: 2026-02-14 (代码质量补充修复)

### [RESOLVED] E4. Ingest 适配器全局依赖注入不统一 — MEDIUM
*Archived: 2026-02-14*

- **Files**: ingest/adapters/docx.js, epub.js, html.js, pptx.js, pdf.js, audio.js, video.js, resolve-deps.js
- **Resolution**: 在 resolve-deps.js 中实现统一的依赖解析器（resolveOcrManager、resolveWhisperApi、resolveTurndownService、resolveMammoth、resolvePptxParser），所有 7 个适配器已迁移使用统一解析函数。解析优先级：stageApi 注入 → globalThis → 动态 import。
- **Commit**: 4a0967c7

### [RESOLVED] H1. 空 catch 继续蔓延（部分） — MEDIUM
*Archived: 2026-02-14*

- **Files**: event-bus.js (8处), orchestrator-core.js (10处), user-store.js (6处), glob.js (4处), pool.js (1处)
- **Resolution**: 修复 29 处空 catch 块，改为 `logger.debug()` 记录错误信息。剩余空 catch 块主要在 Python 代码字符串中（dependency-manager.js）或特殊沙箱场景。
- **Commit**: 4a0967c7

### [RESOLVED] P1. JSON.parse 无 reviver 验证（部分） — MEDIUM
*Archived: 2026-02-14*

- **Files**: robust-json.js, websocket-transport.js
- **Resolution**: 在高风险路径添加 protoSafeReviver 防止原型污染。robust-json.js 的两处 JSON.parse 和 websocket-transport.js 的 CRDT 消息解析已修复。
- **Commit**: 4a0967c7

---

## Archived: 2026-02-13 (代码质量审查)

### [RESOLVED] AH1. `.map(async)` 未正确处理 Promise 数组 — MEDIUM
*Archived: 2026-02-13*

- **Files**: eval/graders/content.js:294, eval/harness.js:360, mcp/mcp-client.js:275/295, mcp/resource-manager.js:695, prompts/prompt-loader.js:429, runtime/core/orchestrator.js:119, skills/user-store.js:289/367, stages/codesearch/phases/execution-phase.js:565, stages/deepsearch/phases/execution-phase.js:184, stages/design/generators/batch-generator.js:414
- **Resolution**: 全面审计确认所有 `.map(async)` 实例均已正确使用 `await Promise.all()` 或 `await Promise.allSettled()` 包裹。无需修复。

### [RESOLVED] AH2. 超大文件违反单一职责原则 — MEDIUM
*Archived: 2026-02-13*

- **Files**: core/sandbox/skill-executor.js (810 行), runtime/core/orchestrator.js (814 行)
- **Resolution**:
  - skill-executor.js (810 行) → 4 个文件：skill-validation.js (120 行)、skill-sandbox.js (480 行)、skill-executor-core.js (230 行)、skill-executor.js (21 行入口)
  - orchestrator.js (814 行) → 4 个文件：scheduling-strategies.js (280 行)、agent-coordination.js (150 行)、orchestrator-core.js (410 行)、orchestrator.js (入口)
  - ✅ 所有测试通过（80 个测试）
  - ✅ 向后兼容性验证通过
  - ✅ 无循环依赖
- **Commit**: bdc40eae

### [RESOLVED] E8. node-io.js 平台检测重复 platform.js 逻辑 — LOW
*Archived: 2026-02-13*

- **File**: ingest/adapters/node-io.js:14
- **Resolution**: 已在提交 83858ef4 中修复，替换自定义 isNodeEnvironment() 为共享的 isNodeLike()，统一平台检测逻辑。
- **Commit**: 83858ef4

---

## Archived: 2026-02-06 (Phase 3 — 协同基础)

### [RESOLVED] A2. SyncManager op log 裁剪后无快照 fallback — HIGH
*Archived: 2026-02-06*

- **Fix**: `core/crdt/sync-manager.js` — `_boundSyncResponseHandler` now detects `complete === false` and falls back to requesting full snapshot via `sinceVersion: null`. Added `crdt:snapshot-response` handler with `doc.applySnapshot()` support.

### [RESOLVED] A4. Worker Pool 无 graceful shutdown — MEDIUM
*Archived: 2026-02-06*

- **Fix**: `runtime/core/worker-pool.js` — added `drain(timeoutMs)` method that waits for in-flight tasks to complete (polling every 100ms) with configurable timeout before force-terminating.

### [RESOLVED] C5. StageApiFactory 参数推断脆弱 — MEDIUM
*Archived: 2026-02-06*

- **Fix**: `runtime/core/api/stage-api-factory.js` — `createStageApiFactory()` now prefers options object `{ stageName, services }` while maintaining backward compatibility with legacy positional forms.

### [RESOLVED] C6. registerStage() 无声明式 manifest — MEDIUM
*Archived: 2026-02-06*

- **Fix**: `runtime/core/orchestrator.js` — `registerStage()` now accepts manifest fields (`requiredServices`, `statePrefix`, `tools`, `dependencies`). Added `getStageManifest(name)` for introspection.

### [RESOLVED] F3. MessageBus 广播无定向路由 — LOW
*Archived: 2026-02-06*

- **Fix**: `core/message-bus.js` — added `channel` field to Message typedef, `onChannel(channel, type, handler)` for topic-based subscription, and channel-aware dispatch in `_dispatch()`.

---

## Archived: 2026-02-06 (Phase 2 — 跨运行时稳固)

### [RESOLVED] E1. TLA 在非叶子模块 — MEDIUM
*Archived: 2026-02-06*

- **Fix**: `plugins/transports/index.js` — replaced top-level await with lazy `getImpl()` async getter + proxy exports.

### [RESOLVED] E6. Intl.Segmenter 无 fallback — LOW
*Archived: 2026-02-06*

- **Fix**: `retrieval/bm25.js` and `retrieval/mmr.js` — added one-time `logger.warn` when Intl.Segmenter unavailable. Existing bigram fallback already handles CJK tokenization.

### [RESOLVED] E7. Module Worker 缺少能力检测 — LOW
*Archived: 2026-02-06*

- **Fix**: `vfs/glob.js`, `vfs/diff.js`, `vfs/vfs-scan-async.js` — `canUseWorker()` now probes Module Worker support with cached Blob-based test.

### [PARTIAL] D1. 空 catch 滥用 — HIGH
*Archived: 2026-02-06*

- **Fix**: Critical path catch blocks in `degradation-matrix.js`, `defaults.js`, `prompt-template.js` converted to catch-and-log. Remaining defensive catches in user-store.js/error-boundary.js retained (acceptable for browser API edge cases).

### [RESOLVED] D2. ErrorBoundary 不区分暂时/永久错误 — MEDIUM
*Archived: 2026-02-06*

- **Fix**: Added `isRetryable(error)` classifier (NETWORK/TIMEOUT/QUOTA/429/5xx). `wrap()` now supports `maxRetries` option with exponential backoff for retryable errors.

---

## Archived: 2026-02-06 (Phase 1 — 统一性)

### [RESOLVED] C1. DI 注入路径不统一 — HIGH
*Archived: 2026-02-06*

- **Fix**: Promote `_resolveDependency(serviceId, context, fallback)` to BaseAgentLoop. Remove duplicates from CodeSearchStage and DesignAgentLoop.

### [RESOLVED] E3. VFS Platform.isNode 不含 Bun — MEDIUM
*Archived: 2026-02-06*

- **Fix**: `vfs/index.js` — `Platform.isNode` → `isNodeLike()`.

### [RESOLVED] E8. node-io.js 自定义 isNodeEnvironment — LOW
*Archived: 2026-02-06*

- **Fix**: Replace with shared `isNodeLike()` import.

### [RESOLVED] E4. Ingest 适配器依赖解析重复 — MEDIUM
*Archived: 2026-02-06*

- **Fix**: Extract `resolve-deps.js` with shared `resolveTurndownService` + `resolveDOMParser`. Remove 3 duplicates from html.js, docx.js, epub.js.

### [RESOLVED] C2. ToolPermissions/PolicyEngine 双轨权限 — HIGH
*Archived: 2026-02-06*

- **Fix**: `ToolPermissions.check()` now consults PolicyEngine first. `setPolicyEngine()` for post-construction binding.

### [PARTIAL] E10. console 散布收敛到 logger — MEDIUM
*Archived: 2026-02-06*

- **Fix**: Replaced 13 console.warn/error in core/ and runtime/ with structured logger. Remaining in stages/plugins deferred.

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

## 2026-02-07 - [HIGH] C1. DI 注入路径不一致——部分 Stage 用 DI、部分不用

- **File**: stages/codesearch/codesearch-stage.js:152
- **Type**: unknown
- **Resolution**: Auto-fixed by audit-fix
- **Description**: 两种注入路径并存。同一个服务可能通过两条不同路径被实例化两次（特别是 TRANSIENT scope 的服务如 Watchdog）。

## 2026-02-07 - [HIGH] O1. Fallback Eval 正则绕过风险

- **File**: core/sandbox/skill-executor.js:52
- **Type**: security_sandbox
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `FALLBACK_BLOCK_PATTERNS` 使用正则检测危险代码，但存在绕过风险：

## 2026-02-07 - [HIGH] O2. Proxy 沙箱可逃逸

- **File**: core/sandbox/skill-executor.js:125
- **Type**: unknown
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `createFallbackProxyGlobals()` 使用 Proxy 拦截全局访问，但存在已知绕过：

## 2026-02-07 - [MEDIUM] E3. VFS 入口 Platform 判断不一致——Bun 走错路径

- **File**: vfs/index.js:42
- **Type**: compat_platform
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `vfs/index.js:42` 用 `Platform.isNode`（不包含 Bun），而 `skills/loader.js:33` 用 `isNodeLike()`（包含 Bun）。Bun 环境下：VFS 走浏览器路径（OPFS/Memory），Skills 走 Node 路径（扫描文件系统）。

## 2026-02-07 - [MEDIUM] I1. LWWMap 直接 import 全局 Lamport Clock

- **File**: core/crdt/lww-map.js:8
- **Type**: unknown
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `import { nextTick, compare } from '../lamport-clock.js'` 直接引用模块级全局时钟。虽然支持 `clockService` 注入，但默认路径绕过 DI。

## 2026-02-07 - [MEDIUM] O3. `with` 语句在严格模式下不可用

- **File**: core/sandbox/skill-executor.js:953
- **Type**: unknown
- **Resolution**: Auto-fixed by audit-fix
- **Description**: 如果用户代码以 `"use strict";` 开头，`with` 会抛出语法错误。

## 2026-02-07 - [MEDIUM] U1. 顶层 await 在旧环境不支持

- **File**: mcp/index.js:35
- **Type**: compat_tla
- **Resolution**: Auto-fixed by audit-fix
- **Description**: 顶层 await 需要 ES2022+，旧版 Node.js (<14.8) 或打包工具可能不支持。

## 2026-02-07 - [MEDIUM] W2. URL 摄取 SSRF 防护不完整

- **File**: ingest/ingest-stage.js:594
- **Type**: security_ssrf
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `fetchUrlText()` 有三条路径：

## 2026-02-07 - [MEDIUM] V1. OPFS 操作无并发保护

- **File**: vfs/vfs.opfs.js:159
- **Type**: concurrency
- **Resolution**: Auto-fixed by audit-fix
- **Description**: 如果同一文件被并发写入，可能导致数据损坏或 `InvalidStateError`。

## 2026-02-07 - [MEDIUM] AB2. InjectionScanner.sanitize 未覆盖 Unicode 绕过

- **File**: sdk/injection-scanner.js:259
- **Type**: security_xss
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `sanitize()` 只移除已知的 ASCII 控制标记，但未处理：

## 2026-02-07 - [MEDIUM] AC1. safeJsonParse 未过滤 __proto__

- **File**: shared/utils/safe-json.js:31
- **Type**: security_json
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `safeJsonParse()` 是项目的"安全" JSON 解析工具，但仅做了大小限制，未添加 reviver 过滤 `__proto__`/`constructor`/`prototype`。所有使用 `safeJsonParse()` 的调用点仍面临原型污染风险。

## 2026-02-07 - [MEDIUM] AF1. atomicWrite 无 rename 时有数据丢失窗口

- **File**: vfs/operations.js:624
- **Type**: vfs_concurrency
- **Resolution**: Auto-fixed by audit-fix
- **Description**: 当 VFS 不支持 `rename()` 时，fallback 策略为：

## 2026-02-07 - [MEDIUM] AE1. AlertMonitor 无 dispose/cleanup 方法

- **File**: sdk/AlertMonitor.js:98
- **Type**: security_sandbox
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `_setupListeners()` 通过 `this.agent.on()` 订阅三个事件（`*:toolCompleted`、`deepsearch:gapEvaluated`、`agent:iteration`），但没有 `dispose()` 方法移除这些订阅。

## 2026-02-07 - [MEDIUM] AG1. 6+ 处 deprecated 全局 getter 仍为主要入口

- **File**: shared/utils/circuit-breaker.js:338
- **Type**: deprecated_api
- **Resolution**: Auto-fixed by audit-fix
- **Description**: 标记 `@deprecated` 但被公开 API 函数直接调用，形成 deprecated→active 反模式。开发者无从判断应该使用 DI 还是全局 getter。

## 2026-02-07 - [LOW] E9. Skills sandbox-adapter.js 的 import() 检测正则误报

- **File**: skills/sandbox-adapter.js:134
- **Type**: security_sandbox
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `{ pattern: /import\s*\(/, risk: 'medium' }` 会匹配注释和字符串中的 `import(`。

## 2026-02-07 - [LOW] F2. ProcessCoordinator 只是 LRU 广播，非通用分布式锁

- **File**: plugins/coordination/process-coordinator.js:0
- **Type**: unknown
- **Resolution**: Auto-fixed by audit-fix
- **Description**: 实际只做 session eviction/access 广播（跨 Tab/进程 LRU 缓存一致性），没有 `acquireLock()` / `releaseLock()` / 信号量。

## 2026-02-07 - [LOW] F1. TabCoordinator leader election 存在竞态条件

- **File**: plugins/coordination/tab-coordinator.js:0
- **Type**: concurrency
- **Resolution**: Auto-fixed by audit-fix
- **Description**: 选主逻辑基于心跳，用 `setTimeout` 而非 `setInterval`。`_checkLeader()` 和 `_handleHeartbeat()` 之间没有互斥。BroadcastChannel 消息无总序保证。

## 2026-02-07 - [LOW] I2. PluginContext._createScopedState 路径拼接脆弱

- **File**: core/plugin.js:81
- **Type**: api_design
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `_createScopedState()` 用字符串拼接 `` `plugins.${pluginName}` ``，如果 `pluginName` 含 `.`（如 `compression.cicada`），会导致路径层级混乱。

## 2026-02-07 - [LOW] V2. 路径遍历未完全防护

- **File**: vfs/vfs.opfs.js:72
- **Type**: unknown
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `getDirHandle()` 按 `/` 分割路径遍历目录，但未检查 `..`。

## 2026-02-07 - [LOW] W4. persistResume 错误静默吞没

- **File**: ingest/ingest-stage.js:387
- **Type**: silent_catch
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `persistResume()` 和最终 `await persistQueue` 均有 `catch { // ignore }`。持久化失败意味着断点续传数据丢失。

## 2026-02-07 - [LOW] Y3. deleteDatabase onblocked 静默 resolve

- **File**: storage/run-store.js:165
- **Type**: storage_idb
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `deleteDatabase` 的 `onblocked` 直接 `resolve()`，即使数据库未真正删除。

## 2026-02-07 - [LOW] Y2. IndexedDB onblocked Promise 永久挂起

- **File**: storage/run-store.js:119
- **Type**: storage_idb
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `onblocked` 仅 `logger.warn()`，未 resolve/reject。如果 DB 被旧版本连接阻塞，`open()` 返回的 Promise 永久挂起。

## 2026-02-07 - [LOW] Z1. createLimiter 队列无 shutdown 机制

- **File**: eval/harness.js:73
- **Type**: unknown
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `createLimiter()` 内部队列项通过 `new Promise(resolve => queue.push(resolve))` 等待。如果 harness 销毁或进程退出，队列中的 Promise 永远不会 resolve。

## 2026-02-07 - [LOW] AB4. BacktrackManager 默认 console 日志

- **File**: sdk/BacktrackManager.js:17
- **Type**: unknown
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `this._logger = options.logger || console` — 默认使用全局 console。

## 2026-02-07 - [LOW] AB3. getGlobalInjectionScanner deprecated 但仍活跃使用

- **File**: sdk/injection-scanner.js:309
- **Type**: deprecated_api
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `getGlobalInjectionScanner()` 标记 `@deprecated` 但被 `scanForInjection()`、`sanitizeOutput()`、`isCleanOutput()` 三个公开 API 调用。

## 2026-02-07 - [LOW] AC3. getGlobalTokenTracker() 全局单例绕过 DI

- **File**: llm/internal/call-executor.js:3
- **Type**: di_inconsistency
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `import { getGlobalTokenTracker } from "../../plugins/telemetry/index.js"` — 直接使用全局单例而非从 DI 容器获取。同 I1/M3/AB3 模式。

## 2026-02-07 - [LOW] AD2. logEvent deprecated 但仍导出

- **File**: shared/utils/logger.js:110
- **Type**: console_log
- **Resolution**: Auto-fixed by audit-fix
- **Description**: `logEvent()` 标记 `@deprecated` 但仍公开导出，使用原始 `console.log`。

## 2026-02-13 - [LOW] AH3. 空 catch 块持续蔓延

- **File**: 10 处分布在多个模块
  - core/contracts/agent-coordinator.js:172, 235
  - core/contracts/taskboard-orchestrator-bridge.js:205
  - core/contracts/trace-propagator.js:224
  - core/node-compat/create-node-env.js:64
  - core/node-compat/execution-strategy.js:22, 34
  - core/node-compat/module-resolver.js:208
  - core/node-compat/repl.js:72
  - core/sandbox/wasm-sandbox.js:234
- **Type**: empty_catch
- **Resolution**: Fixed by adding logger.debug() or console.warn() to all empty catch blocks
- **Description**: 空 catch 块静默吞没错误，不记录任何日志或上下文信息。已修复 10 处空 catch 块，为每个空 catch 块添加了适当的日志记录（logger.debug() 或 console.warn()），确保错误信息被记录以便调试。
