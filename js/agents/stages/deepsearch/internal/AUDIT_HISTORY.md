# Audit History - runtime

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] logic
*Archived: 2026-01-20T00:12:43.191Z*

- **File**: js/agents/stages/deepsearch/internal/writing-phase-handler.js:117
- **Description**: minWords 使用 `||` 导致显式配置为 0 时被忽略，无法通过配置禁用字数门槛，可能触发不必要的写作阶段（getStats 也有同样逻辑）。
- **Suggestion**: 改用空值合并（??）或显式数值判断，让 0 生效；同样调整 getStats 的 minWords 计算。
```
const minWords = reportConfig.minWords || { quick: 4000, wider: 6000, deeper: 10000 }[mode] || 4000;
```

### [RESOLVED] robustness
*Archived: 2026-01-20T00:12:43.191Z*

- **File**: js/agents/stages/deepsearch/internal/shared-context.js:336
- **Description**: buildBlackboardPrompt 直接 JSON.stringify signal payload，若 payload 含循环引用/BigInt 会抛错，导致黑板构建失败。
- **Suggestion**: 为 JSON.stringify 添加 try-catch 或使用安全序列化函数并提供降级文本。
```
const msg = payload.message || payload.reason || payload.value || JSON.stringify(payload);
```

### [RESOLVED] robustness
*Archived: 2026-01-20T00:12:43.191Z*

- **File**: js/agents/stages/deepsearch/internal/writing-phase-handler.js:280
- **Description**: 写作阶段将工具输出直接 JSON.stringify 写入提示；若结果含循环引用/BigInt 会抛错并中断写作循环。
- **Suggestion**: 使用安全序列化或捕获 stringify 异常并回退为简短摘要。
```
JSON.stringify(payloadForPrompt, null, 2)
```

---

## Archived: 2026-01-18

### [RESOLVED] error-info-leak
*Archived: 2026-01-18T21:33:55.398Z*

- **File**: js/agents/stages/deepsearch/runtime/backtrack-manager.js:122
- **Description**: 回溯失败时把原始 stack 回传给调用方，如果该结果直接暴露给用户，会泄露内部路径/实现细节。
- **Suggestion**: 仅在内部日志记录 stack，返回给上层/用户的对象移除 stack 或用 debug 开关控制。
```
const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : null;
return { success: false, reason: "restore_failed", error: msg, ...(stack ? { stack } : {}) };
```

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T21:33:55.398Z*

- **File**: js/agents/stages/deepsearch/runtime/backtrack-manager.js:15
- **Description**: JSDoc 使用了 any 类型（archive/logger/sideEffects 等），违反“禁止 any 类型”的约定。
- **Suggestion**: 为 archive/logger/sideEffects 定义具体接口类型，或拆分成 @typedef 以便在调用点校验。
```
* @property {any=} archive
* @property {any=} logger
* @property {any=} sideEffects
```

### [RESOLVED] jsdoc-missing-descriptions
*Archived: 2026-01-18T21:33:55.398Z*

- **File**: js/agents/stages/deepsearch/runtime/backtrack-manager.js:60
- **Description**: 公共方法的 @param/@returns 缺少描述，不符合 JSDoc 规范。
- **Suggestion**: 为每个 @param/@returns 添加简短说明；私有方法标注 /** @private */。
```
* @param {DeepSearchState} state
* @param {string|null} checkpointId
* @param {BacktrackArgs=} options
* @returns {Promise<BacktrackResult>}
```

### [RESOLVED] public-api-missing-jsdoc
*Archived: 2026-01-18T21:33:55.398Z*

- **File**: js/agents/stages/deepsearch/runtime/checkpoint.js:14
- **Description**: 导出的 helper（normalizeCheckpointStrategy 等）缺少 JSDoc，违反“public API 必须有完整 JSDoc”。
- **Suggestion**: 为导出函数补充 JSDoc（含 @param/@returns 描述）。
```
export function normalizeCheckpointStrategy(v) {
  const raw = toNonEmptyString(v);
}

export function getCheckpointStrategyFromState(state, override) {
```

### [RESOLVED] silent-catch
*Archived: 2026-01-18T21:33:55.398Z*

- **File**: js/agents/stages/deepsearch/runtime/checkpoint.js:118
- **Description**: structuredClone 失败被静默吞掉，违背“异常需记录或重新抛出”的规则。
- **Suggestion**: 至少 debug 级别记录一次失败原因，或在开发环境抛出以便定位。
```
try {
  if (!hasCycle(v)) return structuredClone(v);
} catch { /* intentional: structuredClone may fail on certain objects */ }
```

---

