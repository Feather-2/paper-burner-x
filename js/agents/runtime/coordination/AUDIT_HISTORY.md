# Audit History - coordination

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc any 类型
*Archived: 2026-01-18T21:43:43.659Z*

- **File**: js/agents/runtime/coordination/tab-coordinator.js:21
- **Description**: TabCoordinatorOptions 使用 `any` 定义 logger，违反“禁止 any 类型”规范，弱化 API 约束。
- **Suggestion**: 新增 `LoggerLike` typedef（如 `{ warn?: (...args: unknown[]) => void }`）并替换 `any`，其余入参用 `unknown` + 校验收敛。
```
/**
 * @typedef {Object} TabCoordinatorOptions
 * @property {string} [channelName]
 * @property {number} [heartbeatMs]
 * @property {(sessionId: string) => void} [onEviction]
 * @property {(sessionId: string) => void} [onAccess]
 * @property {any} [logger]
 */
```

### [RESOLVED] JSDoc any 类型
*Archived: 2026-01-18T21:43:43.659Z*

- **File**: js/agents/runtime/coordination/process-coordinator.js:24
- **Description**: ProcessCoordinator 的 options/cluster 类型多处使用 `any`（logger/IPC message/listener args），违反规范且降低可读性。
- **Suggestion**: 为 logger、IPC message、listener 参数定义显式类型（`LoggerLike`/`ProcessCoordinatorMessage`/`Listener` 等），用 `unknown` 代替 `any` 并在解析处校验。
```
/**
 * @typedef {object} ProcessCoordinatorOptions
 * @property {(sessionId: string) => void} [onEviction]
 * @property {(sessionId: string) => void} [onAccess]
 * @property {any} [logger]
 */
```

### [RESOLVED] 错误处理
*Archived: 2026-01-18T21:43:43.659Z*

- **File**: js/agents/runtime/coordination/process-coordinator.js:126
- **Description**: `loadClusterModule` 捕获异常后直接返回 `null`，错误被吞掉，调试困难；与“异常需记录或重新抛出”的规范不符。
- **Suggestion**: 改为 `catch (err) { throw err; }` 让 `init()` 统一记录，或在此处记录 warn 并保留错误上下文。
```
try {
  /** @type {string} */
  const specifier = "node:cluster";
  const mod = await import(/* @vite-ignore */ specifier);
  clusterModule = normalizeClusterModule(mod);
  return clusterModule;
} catch {
  return null;
}
```

### [RESOLVED] 浏览器兼容性
*Archived: 2026-01-18T21:43:43.659Z*

- **File**: js/agents/runtime/coordination/process-coordinator.js:79
- **Description**: 模块内引用 `globalThis.process`/`node:cluster` 属于 Node-only API；若被打包进浏览器构建可能触发解析或运行问题。
- **Suggestion**: 确保该模块仅在 Node 入口导出或使用条件导出/构建别名隔离浏览器包。
```
const g = /** @type {any} */ (globalThis);
const p = g.process;
if (!p || typeof p !== "object") return null;
```

---

