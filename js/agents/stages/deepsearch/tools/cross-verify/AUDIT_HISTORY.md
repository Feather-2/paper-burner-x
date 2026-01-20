# Audit History - cross-verify

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] JSDoc
*Archived: 2026-01-20T00:24:55.862Z*

- **File**: js/agents/stages/deepsearch/tools/cross-verify/handler.js:43
- **Description**: 多个私有辅助函数未按规范标注 @private 且缺少 @param/@returns 说明
- **Suggestion**: 为私有 helper 添加 /** @private */ 与完整 JSDoc，或合并到公共 API 注释中
```
function normalizeStringArray(value) {
```

### [RESOLVED] CodeStyle
*Archived: 2026-01-20T00:24:55.862Z*

- **File**: js/agents/stages/deepsearch/tools/cross-verify/handler.js:305
- **Description**: handler 函数超过 50 行且承担输入校验、证据收集、任务启动、异步回写等多职责，违反单一职责/长度约束
- **Suggestion**: 拆分为输入验证、启动任务、异步回写、同步等待等小函数
```
export async function handler(args, context) {
```

### [RESOLVED] MagicNumber
*Archived: 2026-01-20T00:24:55.862Z*

- **File**: js/agents/stages/deepsearch/tools/cross-verify/handler.js:135
- **Description**: 证据行数与片段长度使用硬编码数值（如 12、400），不符合避免魔法数字规范
- **Suggestion**: 提取为命名常量（如 MAX_EVIDENCE_LINES/MAX_SNIPPET_LENGTH）
```
const evidenceLines = (Array.isArray(evidences) ? evidences : []).slice(0, 12)
```

---

## Archived: 2026-01-18

### [RESOLVED] prototype-pollution
*Archived: 2026-01-18T19:29:57.294Z*

- **File**: js/agents/stages/deepsearch/tools/cross-verify/handler.js:75
- **Description**: factId 来自用户输入，直接作为普通对象 key 写入 crossVerify map，攻击者可用 __proto__/constructor 造成原型污染并影响全局状态。
- **Suggestion**: 使用 Map 或 Object.create(null) 存储；写入前拒绝 __proto__/constructor/prototype 等危险 key，或对 key 进行安全编码。
```
const existing = isPlainObject(map[factId]) ? map[factId] : { factId };
  map[factId] = { ...existing, ...patch };
```

### [RESOLVED] logic-duplicate-finalize
*Archived: 2026-01-18T19:29:57.294Z*

- **File**: js/agents/stages/deepsearch/tools/cross-verify/handler.js:395
- **Description**: 同步模式仍注册了任务 promise 的完成回调，随后又在 async=false 分支调用 finalizeVerification，可能导致重复写入状态/索引及重复事件。
- **Suggestion**: 当 async=false 时跳过注册回调，或在 finalize 处加一次性去重标记，确保只执行一次。
```
if (promise && typeof promise.then === "function") {
  promise.then((taskResult) =>
    finalizeVerification({ ... })
  );
}
...
if (!isAsync) {
  const taskResult = await waitForTask(taskId, timeoutMs);
  const verification = await finalizeVerification({ ... });
}
```

### [RESOLVED] input-validation
*Archived: 2026-01-18T19:29:57.294Z*

- **File**: js/agents/stages/deepsearch/tools/cross-verify/handler.js:295
- **Description**: factId/contradiction/sourceIds 仅做非空处理，未做长度/字符集/数量限制，可能放大 prompt/黑板写入并带来性能或滥用风险。
- **Suggestion**: 为 factId/contradiction 增加长度与字符集校验，限制 sourceIds 数量与单项长度，并在构造 prompt 前进行截断或拒绝异常输入。
```
const factId = toNonEmptyString(args?.factId);
const contradiction = toNonEmptyString(args?.contradiction);
...
const requestedSourceIds = normalizeStringArray(args?.sourceIds ?? args?.sources ?? args?.sourceId);
```

### [RESOLVED] style-function-size
*Archived: 2026-01-18T19:29:57.294Z*

- **File**: js/agents/stages/deepsearch/tools/cross-verify/handler.js:292
- **Description**: handler/finalizeVerification 单函数超过 50 行且承担多职责，违反项目约定，降低可读性与可测试性。
- **Suggestion**: 拆分为输入校验、证据收集、任务启动、结果回写等小函数，并复用现有 helper。
```
export async function handler(args, context) {
  const { state, emit, discoveryManager, stageApi, sharedContext } = context;
  ...
}
```

---

