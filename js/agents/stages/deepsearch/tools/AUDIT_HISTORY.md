# Audit History - tools

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:32:26.763Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:29
- **Description**: 使用 Node-only 的 process.env 读取配置，违反浏览器兼容性约定；在浏览器环境下会失效或引入 polyfill 依赖。
- **Suggestion**: 通过 context/stageApi 注入配置，或在浏览器环境中显式降级为静态默认值并避免依赖 process.env。
```
const nodeProcess = /** @type {any} */ (globalThis).process;
const env = nodeProcess?.env || {};
const MAX_RUNNING_TASKS = toPositiveInt(env.DEEPSEARCH_MAX_RUNNING_TASKS, 50);
```

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:32:26.763Z*

- **File**: js/agents/stages/deepsearch/tools/skill/handler.js:69
- **Description**: Skill 工具依赖 process.cwd() 与文件系统加载器，在浏览器环境不可用。
- **Suggestion**: 在无文件系统环境下直接返回可用性错误，或通过 stageApi 提供 loader/cwd 以避免直接使用 process。
```
const nodeProcess = /** @type {any} */ (globalThis).process;
const cwd =
  stageApi.cwd ||
  (typeof nodeProcess?.cwd === "function" ? nodeProcess.cwd() : ".");
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:32:26.763Z*

- **File**: js/agents/stages/deepsearch/tools/advise-task/handler.js:81
- **Description**: 事件名使用点号分隔，不符合 domain:action 约定，可能影响事件校验/订阅。
- **Suggestion**: 改为 domain:action 格式（如 `deepsearch:advice.sent` 或 `deepsearch:advice_sent`），并同步更新监听方。
```
emit?.("deepsearch.advice.sent", { taskId, advice, priority, type });
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:32:26.763Z*

- **File**: js/agents/stages/deepsearch/tools/list-docs/handler.js:17
- **Description**: 导出的 handler JSDoc 缺少 @returns（多个文件存在该问题），不符合 JSDoc 类型完整性要求。
- **Suggestion**: 为各 handler 补充 @returns 并明确返回结构（例如 `Promise<{success: boolean, ...}>`）。
```
/**
 * @param {Object} args - 无参数
 * @param {Object} context - { state, emit }
 */
export async function handler(args, context) {
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:32:26.763Z*

- **File**: js/agents/stages/deepsearch/tools/search-docs/handler.js:160
- **Description**: 本地搜索路径缺少 try/catch；semanticSearch/search 抛错会直接冒泡，导致调用方收不到统一的失败结构。
- **Suggestion**: 为 runLocalSearch 添加 try/catch，统一返回 { success: false, error } 并按需 emit 失败事件。
```
const rawResults =
  embeddingService && typeof manager.semanticSearch === "function"
    ? await manager.semanticSearch(query, {
        sources: targetSources,
        limit: effectiveLimit,
        embeddingService,
        ...(semanticTimeoutMs ? { timeoutMs: semanticTimeoutMs } : {}),
      })
    : manager.search(query, { sources: targetSources, limit: effectiveLimit });
```

---

