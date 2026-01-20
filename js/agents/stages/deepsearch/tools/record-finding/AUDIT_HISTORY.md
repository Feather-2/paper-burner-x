# Audit History - record-finding

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] input-validation
*Archived: 2026-01-20T00:13:18.972Z*

- **File**: js/agents/stages/deepsearch/tools/record-finding/handler.js:129
- **Description**: 批量 `findings` 的元素未校验即可解构，若包含 null/undefined/非对象将抛出 TypeError，导致工具崩溃。
- **Suggestion**: 在 processBatchFindings 或 processSingleFinding 中先校验 item 为对象，否则返回结构化错误并跳过。
```
function processSingleFinding(item, context) {
  const { state, emit, sharedContext } = context;
  const { type, content, source, sources, confidence, priority, tags, lineStart, lineEnd } = item;
```

### [RESOLVED] defensive-coding
*Archived: 2026-01-20T00:13:18.972Z*

- **File**: js/agents/stages/deepsearch/tools/record-finding/handler.js:198
- **Description**: SharedContext 在 JSDoc 中为可选方法，但 markSeen/commit 未做函数检查，若传入部分实现会抛错中断。
- **Suggestion**: 使用 optional chaining（sharedContext?.markSeen?./commit?.）或在进入前校验接口完整性。
```
if (sharedContext) {
  sharedContext.markSeen(trimmedContent);
  sharedContext.commit(`finding_${type}`, {
```

### [RESOLVED] tests-coverage
*Archived: 2026-01-20T00:13:18.972Z*

- **File**: tests/unit/agents/stages/design/edit-mode/tools.test.js:44
- **Description**: record-finding 仅覆盖批量 happy-path；缺少对无效 item、gap 预算超限、duplicate、行号反转等边界/异常路径的测试。
- **Suggestion**: 补充边界与异常场景的单元测试，覆盖输入校验与 gap 预算分支。
```
it("DeepSearch tool: record-finding batches and formats refs", async () => {
  const { handler } = await import("../../../js/agents/stages/deepsearch/tools/record-finding/handler.js");
```

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T21:33:23.340Z*

- **File**: `js/agents/stages/deepsearch/tools/record-finding/handler.js`:96
- **Description**: lineStart/lineEnd/priority/tags/sources 等缺少类型与边界校验，可能写入负数或非字符串值并生成错误引用或脏数据。
- **Suggestion**: 对 source/lineStart/lineEnd/priority/sources/tags 做类型与边界校验（正整数、lineStart<=lineEnd、priority 白名单、数组元素为字符串）。
```
if (source) {
  if (lineStart && lineEnd && lineStart !== lineEnd) {
    ref = `[${source}:L${lineStart}-L${lineEnd}]`;
  } else if (lineStart) {
    ref = `[${source}:L${lineStart}]`;
  } else {
    ref = `[${source}]`;
  }
}
...
lineStart: Number.isFinite(lineStart) ? lineStart : null,
lineEnd: Number.isFinite(lineEnd) ? lineEnd : null,
priority: type === "gap" ? (priority || "medium") : null,
tags: Array.isArray(tags) ? tags : [],
```

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T21:33:23.340Z*

- **File**: `js/agents/stages/deepsearch/tools/record-finding/handler.js`:12
- **Description**: JSDoc 使用 any 类型，违反“禁止 any 类型”的约定，降低可维护性与静态检查能力。
- **Suggestion**: 补充具体 typedef（如 Finding、SharedContext、RecordArgs）并替换 any。
```
* @typedef {object} FindingRecordResult
* @property {any=} finding
...
* @param {any} item
* @param {any} context
```

### [RESOLVED] style-length
*Archived: 2026-01-18T21:33:23.340Z*

- **File**: `js/agents/stages/deepsearch/tools/record-finding/handler.js`:153
- **Description**: handler 函数超过 50 行且包含多分支逻辑，违反单一职责/长度约定，增加维护成本。
- **Suggestion**: 将批量处理、单条处理、统计构建拆分为独立函数以降低复杂度。
```
export async function handler(args, context) {
  const { sharedContext, state } = context;
  const gapBudget = resolveGapFindingBudget(state);
  ...
}
```

---

