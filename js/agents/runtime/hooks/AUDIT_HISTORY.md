# Audit History - hooks

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc-any
*Archived: 2026-01-19T20:43:57.838Z*

- **File**: js/agents/runtime/hooks/event-bus-hooks.js:11
- **Description**: JSDoc 使用 `{any}`，违反“禁止 any 类型”的项目规范，降低类型可读性与约束力。
- **Suggestion**: 定义并复用 EventBusLike/HookRegistry 接口的具体 typedef，替代 `any`。
```
* @param {any} eventBus
```

---

## Archived: 2026-01-19

### [RESOLVED] hook-error-blocks-flow
*Archived: 2026-01-19T20:43:45.668Z*

- **File**: js/agents/runtime/hooks/hook-runner.js:517
- **Description**: PreAgent 钩子在 handler 抛异常时默认阻断主流程（blocking=true），违反“异常不应中断主流程”的约定，可能导致单点故障放大。
- **Suggestion**: 将异常视为非阻断：记录告警并继续执行；如需控制可新增 `blockOnError` 开关且默认 false。
```
catch (err) { if (blocking) { ... return { skip: true, reason }; } }
```

---

## Archived: 2026-01-19

### [RESOLVED] error-message-leak
*Archived: 2026-01-19T20:43:28.884Z*

- **File**: js/agents/runtime/hooks/hook-runner.js:404
- **Description**: 工具/钩子异常信息直接拼接到 reason 返回给调用方，可能将内部错误细节暴露给用户。
- **Suggestion**: 对外返回通用错误码/友好提示；将详细错误记录到日志或事件总线中。
```
const reason = `Prompt hook blocked: ${err?.message || String(err)}`;
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype-pollution
*Archived: 2026-01-19T20:43:24.641Z*

- **File**: js/agents/runtime/hooks/hook-runner.js:100
- **Description**: `sanitizeArgs` 将不受信任的键直接写入普通对象，若包含 `__proto__`/`constructor`/`prototype` 等键会污染对象原型，影响事件载荷或日志结构。
- **Suggestion**: 将输出对象改为 `Object.create(null)`，并显式跳过 `__proto__`/`constructor`/`prototype` 等危险键；或使用安全映射结构后再序列化。
```
out[k] = visit(obj[k], depth - 1);
```

---

## Archived: 2026-01-18

### [RESOLVED] convention
*Archived: 2026-01-18T21:43:35.357Z*

- **File**: js/agents/runtime/hooks/hook-runner.js:318
- **Description**: 事件名在 emit 时使用了 tool.denied / agent.denied / agent.hook.error，违背项目约定的 domain:action 格式，可能导致监听器匹配失败或风格不一致。
- **Suggestion**: 统一改为 `tool:denied` / `agent:denied` / `agent:hook-error`（或项目约定的命名），并同步更新所有监听端。
```
eventBus?.emit?.("tool.denied", {
  tool: toolName,
  reason,
  args: sanitizeArgs(params),
  policy: { hookType: "restriction", ...(decision.policy || {}) },
});
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:43:35.357Z*

- **File**: js/agents/runtime/hooks/hook-registry.js:30
- **Description**: HookDefinition 的 JSDoc 未声明 handler 及 tool/toolPattern/toolPatterns 等字段，但 runtime 依赖这些字段，类型注解不完整。
- **Suggestion**: 补充 `handler`、`tool`、`toolPattern`、`toolPatterns` 等字段（含类型签名），或拆分为更精确的 HookDefinition 子类型。
```
@typedef {object} HookDefinition
@property {string} type - HookType
@property {boolean=} blocking - Whether the hook can block execution (default true)
@property {string | string[]=} tools - Tool name wildcard(s) to match; omitted => match all
@property {string=} prompt - Prompt template (prompt/agent hooks)
@property {string=} usage - ModelRouter usage (prompt hooks)
@property {string=} agentType - Subagent type (agent hooks)
@property {string=} modelTier - fast/normal/advanced (agent hooks)
```

### [RESOLVED] typescript-syntax
*Archived: 2026-01-18T21:43:35.357Z*

- **File**: js/agents/runtime/hooks/hooks-config-loader.js:97
- **Description**: JSDoc 中使用了 TypeScript utility types（ReturnType/ConstructorParameters），在纯 JSDoc 工具链下可能不被识别。
- **Suggestion**: 改为显式 JSDoc typedef（例如 `@typedef {number|object|null} TimerHandle`）或使用项目允许的 JSDoc 类型表达式，避免 TS utility types。
```
/** @type {ReturnType<typeof setInterval> | null} */
this._watchTimer = null;
```

---

