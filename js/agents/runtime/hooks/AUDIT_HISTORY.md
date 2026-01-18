# Audit History - hooks

Archived issues from security audits.

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

