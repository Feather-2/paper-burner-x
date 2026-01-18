# Audit History - task

Archived issues from security audits.

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

