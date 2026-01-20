# Audit History - sdk

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] error-handling
*Archived: 2026-01-19T23:50:05.069Z*

- **File**: js/agents/sdk/agent-factory.js:407
- **Description**: 异常被吞掉（空 catch），失败原因不可见，排障困难。
- **Suggestion**: 至少记录 warn 日志或在调试模式下抛出，以便定位配置问题。
```
try {
  eventBus.enableBackpressure({ deferNonCoalesced: opts.deferNonCoalesced ?? false, ...opts });
} catch {
  // ignore
}
```

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc-type-safety
*Archived: 2026-01-19T23:50:00.764Z*

- **File**: js/agents/sdk/AgentBuilder.js:34
- **Description**: 公共 API 的 JSDoc 使用 any 且缺少参数描述，违反类型安全与文档规范，降低 IDE 校验和维护性。
- **Suggestion**: 为公开方法补齐参数描述，并使用具体 typedef 替换 any。
```
/**
 * @param {string} name
 * @param {any} config
 * @returns {AgentBuilder}
 */
useCapability(name, config) {
```

---

## Archived: 2026-01-19

### [RESOLVED] maintainability
*Archived: 2026-01-19T23:49:46.953Z*

- **File**: js/agents/sdk/DefaultAgentLoop.js:290
- **Description**: DefaultAgentLoop.run 过长且嵌套层级深，违反单一职责和 50 行限制，增加回归与维护成本。
- **Suggestion**: 拆分为输入解析、checkpoint、模型调用、工具执行等私有函数，降低嵌套层级。
```
/**
 * Run the agent loop with the given input.
 * @param {any} input - Query string, tool request, or run config object
 * @param {StageApiLike} [stageApi] - Stage API context (model caller, signal, emit, etc.)
 */
async run(input, stageApi = {}) {
```

---

## Archived: 2026-01-19

### [RESOLVED] sandbox-escape
*Archived: 2026-01-19T23:49:46.904Z*

- **File**: js/agents/sdk/agent-factory.js:470
- **Description**: 能力/工具执行直接在主进程运行，并允许从 capability._module 动态导入未校验模块；若能力配置来源不可信，存在任意代码执行/沙箱逃逸风险。
- **Suggestion**: 对不可信能力引入隔离执行环境（Worker/iframe/vm），为 module 路径加 allowlist/签名校验，或明确仅支持可信插件来源。
```
const toolExecutor = async (name, params, context) => {
  const capability = capabilities.get(name);
  if (capability?._module && !capability.handler) {
    const mod = await import(capability._module);
    capability.handler = mod.default?.handler || mod.handler;
    executor.register(name, capability);
  }

  return executor.execute(name, params, capabilityContext);
};
```

---

## Archived: 2026-01-18

### [RESOLVED] 事件命名规范
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/DefaultAgentLoop.js:461
- **Description**: emit 使用 `archive.checkpoint.saved` 与 `agent.dmail_processed` 点分事件名，违反 domain:action 约定，可能导致订阅规则不一致。
- **Suggestion**: 改为 `archive:checkpointSaved` / `agent:dmailProcessed` 等 domain:action 格式，并同步更新监听方。
```
emit?.("archive.checkpoint.saved", {
```

### [RESOLVED] 事件命名规范
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/agent-factory.js:269
- **Description**: Agent 生命周期事件使用 `${actorPrefix}.agent.started`/`${this.actor}.agent.failed` 点分格式，违反 domain:action 约定。
- **Suggestion**: 改为 `${actorPrefix}:agentStarted`、`${this.actor}:agentFailed` 等 domain:action 格式，并同步订阅者。
```
this.eventBus.emit(`${actorPrefix}.agent.started`, { runId: context.runId || Date.now().toString() });
```

### [RESOLVED] 事件命名规范
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/AlertMonitor.js:102
- **Description**: AlertMonitor 监听/发射 `*.tool.completed`、`deepsearch.gap.evaluated`、`agent.iteration`、`alertmonitor.force_backtrack` 等点分事件名，未遵循 domain:action。
- **Suggestion**: 统一改为 `tool:completed`、`deepsearch:gapEvaluated`、`agent:iteration`、`alertmonitor:forceBacktrack` 等格式，并更新对应 emit/subscribe。
```
this.agent.on("*.tool.completed", async (event) => {
```

### [RESOLVED] 事件命名规范
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/DiscoveryManager.js:174
- **Description**: DiscoveryManager 发射 `deepsearch.gap.evaluated` 点分事件名，和 domain:action 约定不符。
- **Suggestion**: 改为 `deepsearch:gapEvaluated` 并更新监听方（包括 AlertMonitor）。
```
this.emit("deepsearch.gap.evaluated", {
```

### [RESOLVED] JSDoc 缺失
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/injection-scanner.js:308
- **Description**: 导出函数 `getGlobalInjectionScanner`/`scanForInjection`/`sanitizeOutput`/`isCleanOutput` 缺少 @param/@returns 类型注解，JSDoc 覆盖不完整。
- **Suggestion**: 为每个导出函数补充 @param/@returns，明确输入输出类型。
```
export function getGlobalInjectionScanner() {
```

### [RESOLVED] JSDoc 缺失
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/SubagentRegistry.js:129
- **Description**: 导出函数 `quarantineOutput` 无 JSDoc 类型注解。
- **Suggestion**: 补充 @param/@returns（包含隔离输出结构）。
```
function quarantineOutput(output, schema, subagentType, injectionScanner) {
```

### [RESOLVED] JSDoc 缺失
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/DefaultAgentLoop.js:288
- **Description**: `DefaultAgentLoop.run` 作为公开 API 缺少 @returns 类型注解。
- **Suggestion**: 添加 @returns {Promise<...>} 描述返回结构。
```
async run(input, stageApi = {}) {
```

### [RESOLVED] 浏览器兼容性
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/config-loader.js:95
- **Description**: `loadAgentConfig` 动态导入 `node:path`/`node:fs/promises`，即使有 isNodeLike() 判断，浏览器打包可能仍解析 node: 依赖。
- **Suggestion**: 将 Node-only 逻辑拆到 Node 入口或使用条件导出/构建配置排除 node: 依赖。
```
const pathModule = await import("node:path");
```

### [RESOLVED] 错误处理
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/config-loader.js:117
- **Description**: `loadAgentConfig` 捕获所有异常后直接返回默认配置，解析失败/权限问题被静默吞掉。
- **Suggestion**: 记录错误或区分“文件不存在”和“解析失败”，便于排查。
```
} catch {
```

### [RESOLVED] 异步错误处理
*Archived: 2026-01-18T21:25:55.462Z*

- **File**: js/agents/sdk/DefaultAgentLoop.js:474
- **Description**: `DefaultAgentLoop.run` 中模型调用/工具执行缺少局部 try/catch，异常会中断循环并跳过 checkpoint/事件记录。
- **Suggestion**: 对 `callModel`/`toolExecutor` 包裹 try/catch，在失败时保存 checkpoint 或发射错误事件后再抛出。
```
const resp = await runWithMiddleware(
```

---

