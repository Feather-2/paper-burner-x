# Audit History - phases

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T21:36:38.404Z*

- **File**: js/agents/stages/deepsearch/phases/execution-phase.js:113
- **Description**: 模型输出的 decision.action/actions 与 args 未做结构校验，可能导致非字符串 action 或畸形参数触发异常/意外工具调用。
- **Suggestion**: 在执行前校验 action 为字符串、args 为 plain object，遇到非法项记录告警并跳过或回退到 ask-user。
```
const toolName = item.action;
const toolArgs = item.args || {};
```

### [RESOLVED] timeout
*Archived: 2026-01-18T21:36:38.404Z*

- **File**: js/agents/stages/deepsearch/phases/execution-phase.js:182
- **Description**: 执行工具调用未在本阶段强制超时/AbortSignal，若 handler 挂起会阻塞迭代与回溯链路。
- **Suggestion**: 为每次 tool 调用设置超时或传入受控 AbortSignal（例如 stageApi.signal + 本地超时包装）。
```
const toolResult = await executeTool(decision.action, decision.args || {}, {
```

### [RESOLVED] sensitive-logging
*Archived: 2026-01-18T21:36:38.404Z*

- **File**: js/agents/stages/deepsearch/phases/execution-phase.js:192
- **Description**: toolResult 被直接序列化写入 debug 日志，若包含 token/密钥会泄露到日志系统。
- **Suggestion**: 仅记录元数据（tool 名称、success、字节数）或对敏感字段做脱敏。
```
agent._logger?.debug?.(`Tool result: ${JSON.stringify(toolResult).slice(0, 200)}`);
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:36:38.404Z*

- **File**: js/agents/stages/deepsearch/phases/execution-phase.js:70
- **Description**: sideEffects cursor 获取失败被静默吞掉，可能掩盖 checkpoint 元数据问题。
- **Suggestion**: 记录一次 warn 或使用统一 safeExec/catchAndLog，避免完全静默失败。
```
try {
  return stageApi.sideEffects.getCursor();
} catch {
  return null;
}
```

### [RESOLVED] tests
*Archived: 2026-01-18T21:36:38.404Z*

- **File**: tests/agents/stages/deepsearch/deepsearch-agent-loop.test.js:179
- **Description**: DeepSearch phases 在 agent-loop 测试中被整体 mock，缺少对回溯/超时/异常决策等路径的直接覆盖。
- **Suggestion**: 新增 planning/execution phase 的单测或集成测，覆盖 backtrack handoff、超时控制与边界输入。
```
vi.mock("../../../../js/agents/stages/deepsearch/phases/planning-phase.js", () => ({
```

### [RESOLVED] jsdoc-typing
*Archived: 2026-01-18T21:36:38.404Z*

- **File**: js/agents/stages/deepsearch/phases/execution-phase.js:16
- **Description**: JSDoc 使用 any / Record<string, any>，与项目约定不符，降低类型约束与输入校验能力。
- **Suggestion**: 改为更具体的 typedef（如 Record<string, unknown> 或细化的参数结构）。
```
* @property {Record<string, any>=} args
```

---

