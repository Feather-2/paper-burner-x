# Audit History - task

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] JSDoc:any
*Archived: 2026-01-20T00:34:14.205Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:245
- **Description**: JSDoc 使用 any（含 compactResult/compactTaskRecord 与 timer unref cast），违反“禁止 any 类型”约定。
- **Suggestion**: 定义明确类型（如 TaskResult/TaskRecord 或新增 TaskExecutionResult），并替换 any/强制类型转换。
```
* @param {any} result
```

### [RESOLVED] JSDoc-private-tag
*Archived: 2026-01-20T00:34:14.205Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:17
- **Description**: 多处私有辅助函数缺少 `/** @private */` 标记（如 ensureSubagentsRegistered、resolveTaskConfig、compactResult 等）。
- **Suggestion**: 为非导出函数补充 `/** @private */`，或改为导出并补全 JSDoc。
```
async function ensureSubagentsRegistered() {
```

### [RESOLVED] Magic-number
*Archived: 2026-01-20T00:34:14.205Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:446
- **Description**: 存在未命名的魔法数字（如结果摘要 300 字符、waitForTask 默认 60000ms）。
- **Suggestion**: 提取为具名常量（如 DEFAULT_SUMMARY_PREVIEW_CHARS、DEFAULT_WAIT_TIMEOUT_MS）并集中管理。
```
summary: result?.summary || result?.report?.slice(0, 300) || "Completed",
```

### [RESOLVED] Error-handling
*Archived: 2026-01-20T00:34:14.205Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:466
- **Description**: 执行失败时直接返回原始错误消息，且未统一记录日志或使用自定义错误类型，可能导致用户信息不友好/审计不完整。
- **Suggestion**: 记录 error 细节（如 logger.error）并映射为用户友好消息；考虑定义 TaskTimeoutError/SubagentInitError 等错误类。
```
const error = err instanceof Error ? err.message : String(err);
```

### [RESOLVED] Test-gap
*Archived: 2026-01-20T00:34:14.205Z*

- **File**: tests/integration/agents/stages/deepsearch/tools-index.test.js:73
- **Description**: Task tool 被统一 mock，缺少对该模块异步/同步、超时、中断和边界输入的真实测试覆盖。
- **Suggestion**: 新增针对 `js/agents/stages/deepsearch/tools/task/handler.js` 的集成/单测，覆盖正常流程、超时、中断、输入边界与并发限制。
```
vi.mock("../../../../js/agents/stages/deepsearch/tools/task/handler.js", () => mockToolModule(hoisted.task));
```

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T22:03:34.270Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:234
- **Description**: subagent_type / prompt / sourceIds 未做严格类型与白名单校验，仅判断 prompt 存在并直接使用 registry，可能执行非预期子代理或引发运行时错误。
- **Suggestion**: 对 args 做类型检查并限制 subagent_type ∈ {"researcher","analyzer"}；校验 prompt 为非空字符串且长度上限；校验 sourceIds 为字符串数组并过滤非法项。
```
const { subagent_type = "researcher", prompt, sourceIds, async: isAsync = true } = args;

if (!prompt) {
  return { success: false, error: "prompt is required" };
}

const factory = globalSubagentRegistry.getFactory(subagent_type);
```

### [RESOLVED] timeout-handling
*Archived: 2026-01-18T22:03:34.270Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:295
- **Description**: 子代理执行没有强制超时，仅 waitForTask 的超时返回不会取消 subagent.run；当 stageApi.signal 不存在时，任务可能无限运行并占用资源。
- **Suggestion**: 为每个子任务创建带截止时间的 AbortSignal（或 AbortController + setTimeout）并传入 run；超时后更新 TaskManager 状态并触发清理。
```
const result = await subagent.run(
  { task: prompt, L0: { sources: targetSources } },
  { signal: stageApi?.signal, stageApi, taskId }
);
```

### [RESOLVED] resource-leak
*Archived: 2026-01-18T22:03:34.270Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:406
- **Description**: waitForTask 创建的 timeout 定时器在任务提前完成时不会清理，频繁调用会堆积定时器直到触发。
- **Suggestion**: 保存 timerId 并在 task.promise 先完成时 clearTimeout；或使用 AbortSignal.timeout 以避免多余定时器。
```
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error("Task timeout")), timeout)
);
```

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T22:03:34.270Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:28
- **Description**: JSDoc 使用 any，违反“禁止 any 类型”的约定；环境与任务记录应给出明确类型定义。
- **Suggestion**: 用 @typedef 定义 Env/TaskRecord 等类型，替换 any 为具体结构或联合类型。
```
/** @type {any} */
const nodeProcess = /** @type {any} */ (globalThis).process;
```

### [RESOLVED] jsdoc-public-api
*Archived: 2026-01-18T22:03:34.270Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:386
- **Description**: 导出的 getTaskStatus/waitForTask 等公共 API 只有简短注释，缺少 @param/@returns/@throws 的完整 JSDoc。
- **Suggestion**: 为导出函数补全 JSDoc（@param/@returns/@throws），私有函数加 /** @private */ 标记。
```
/**
 * 获取任务状态（供 get-task-result 使用）
 */
export function getTaskStatus(taskId) {
```

---

