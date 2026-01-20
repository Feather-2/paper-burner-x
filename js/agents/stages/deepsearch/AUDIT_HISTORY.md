# Audit History - deepsearch

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 浏览器兼容性 (Node-only API)
*Archived: 2026-01-19T23:44:00.392Z*

- **File**: js/agents/stages/deepsearch/tools/skill/handler.js:69
- **Description**: skill 工具同样读取 globalThis.process.cwd 且依赖文件系统加载器，在浏览器环境会失败或引入不必要的 Node polyfill。
- **Suggestion**: 在 browser 环境短路返回友好错误或通过 stageApi 提供 loader/cwd，避免直接读取 process。
```
const nodeProcess = /** @type {any} */ (globalThis).process;
const cwd =
  stageApi.cwd ||
  (typeof nodeProcess?.cwd === "function" ? nodeProcess.cwd() : ".");
```

---

## Archived: 2026-01-19

### [RESOLVED] 原型污染风险
*Archived: 2026-01-19T23:43:41.907Z*

- **File**: js/agents/stages/deepsearch/state/memory-methods.js:74
- **Description**: setScratchpad 对任意 key/object 直接 Object.assign/索引赋值，若 key 来自不可信输入可写入 __proto__/constructor/prototype 触发原型污染。
- **Suggestion**: scratchpad 使用 Object.create(null) 或在赋值前过滤危险键，Object.assign 前先剔除保留 key。
```
if (isPlainObject(key) && value === undefined) Object.assign(this.L2.scratchpad, key);
else this.L2.scratchpad[/** @type {string} */ (key)] = value;
```

---

## Archived: 2026-01-19

### [RESOLVED] 浏览器兼容性 (Node-only API)
*Archived: 2026-01-19T23:43:26.067Z*

- **File**: js/agents/stages/deepsearch/phases/planning-phase.js:281
- **Description**: planning-phase 依赖 globalThis.process.cwd 获取 cwd，browser-first 环境可能不存在或触发 polyfill，导致技能目录构建失败。
- **Suggestion**: 优先使用 stageApi.cwd/依赖注入，缺失时跳过 skills catalog 或返回可用性提示，避免直接依赖 process。
```
const nodeProcess = /** @type {any} */ (globalThis).process;
const cwd =
  stageApi.cwd ||
  (typeof nodeProcess?.cwd === "function" ? nodeProcess.cwd() : ".");
```

---

## Archived: 2026-01-19

### [RESOLVED] 不安全反序列化
*Archived: 2026-01-19T23:43:21.494Z*

- **File**: js/agents/stages/deepsearch/todos.js:182
- **Description**: LLM 输出直接 JSON.parse，缺少长度/结构校验且异常被静默吞掉，可能导致解析异常被隐藏或被大输入拖垮。
- **Suggestion**: 对 candidate 加长度上限并做 schema 校验（数组元素字段白名单），解析失败记录 warn 并返回友好错误。
```
const candidate = extractJsonCandidate(result?.content);
if (!candidate) return null;
const parsed = JSON.parse(candidate);
if (Array.isArray(parsed)) return parsed;
if (isPlainObject(parsed) && Array.isArray(parsed.todos)) return parsed.todos;
return null;
} catch {
  return null;
}
```

---

## Archived: 2026-01-18

### [RESOLVED] information-leak
*Archived: 2026-01-18T21:36:26.896Z*

- **File**: js/agents/stages/deepsearch/tools/index.js:218
- **Description**: executeTool 在返回错误时无条件附带 stack，可能泄露内部路径/环境信息给模型或调用方。
- **Suggestion**: 默认去掉 stack，仅在 debug/受控环境通过开关显式返回；或使用日志系统记录堆栈。
```
const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : null;
...
return {
  success: false,
  error: msg,
  errorName,
  ...(code !== null ? { errorCode: code } : {}),
  ...(stack ? { stack } : {}),
};
```

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:36:26.896Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:29
- **Description**: 多处直接读取 globalThis.process / process.env（任务限额与 cwd），违反“浏览器兼容性（无 Node-only API）”约定。
- **Suggestion**: 改为从 stageApi 注入配置（如 stageApi.env/cwd），或在非 Node 环境禁用相关功能并提供安全默认值。
```
const nodeProcess = /** @type {any} */ (globalThis).process;
const env = nodeProcess?.env || {};
const MAX_RUNNING_TASKS = toPositiveInt(env.DEEPSEARCH_MAX_RUNNING_TASKS, 50);
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:36:26.896Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:273
- **Description**: 事件名使用 dot（如 deepsearch.subagent.started），不符合约定的 domain:action 格式，可能导致跨模块订阅不一致。
- **Suggestion**: 统一为 domain:action，例如 deepsearch:subagent.started，并同步更新事件常量与订阅方。
```
emit?.("deepsearch.subagent.started", { taskId, type: subagent_type, prompt, sourceCount: targetSources.length, async: isAsync });
...
emit?.("deepsearch.subagent.completed", { taskId, type: subagent_type, ok: result?.ok !== false });
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:36:26.896Z*

- **File**: js/agents/stages/deepsearch/deepsearch-helpers.js:21
- **Description**: 多处导出函数缺少 @param/@returns 类型注解（JSDoc 不完整），不符合项目约定。
- **Suggestion**: 为导出函数补充 JSDoc 类型注解（至少 @param/@returns），保持类型可读性与一致性。
```
/**
 * 深度排序用于稳定 JSON 输出
 */
export function deepSortForStableJson(value, seen = new WeakSet()) {
  ...
}
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:36:26.896Z*

- **File**: js/agents/stages/deepsearch/source-manager.js:593
- **Description**: semanticSearch 的嵌入调用未捕获异常，embed 失败会直接抛错，违背“best-effort”语义并导致工具失败。
- **Suggestion**: 对 embed 包裹 try/catch，失败时回退到关键词候选或直接返回 candidates，并记录日志。
```
const vectors = await svc.embed([trimmed, ...snippets], { ...(timeoutMs ? { timeoutMs } : {}) });
if (!Array.isArray(vectors) || vectors.length !== snippets.length + 1) {
  return candidates.slice(0, maxResults);
}
```

---

