# hooks - 钩子系统

工具调用和 Agent 运行的拦截和处理。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口，导出所有钩子 API |
| `hook-registry.js` | HookRegistry - 钩子注册表，HookType/HookEvent 常量，HookDefinition 规范化 + toolPattern 通配符匹配 |
| `hook-runner.js` | 钩子工厂函数 (createPreToolUseHook/createPreAgentHook/createPostAgentHook) |
| `event-bus-hooks.js` | EventBus 钩子增强（为 EventBus-like 对象挂载 HookRegistry；提供 enhanceEventBusWithHooks/getHookRegistry） |
| `hooks-config-loader.js` | HooksConfigLoader - VFS 配置加载 + 热重载 |

## EventBus 增强

`enhanceEventBusWithHooks(eventBus)` 会把一个 `HookRegistry` 挂载到 EventBus-like 对象上（内部使用 `Symbol.for('paperburner.hookRegistry.v1')`，属性为非枚举），并在缺失时注入以下方法：

- `registerHook(eventName, hookDef)`：注册钩子定义（委托给 `registry.register`）
- `getHooks(eventName)`：列出某事件的钩子（委托给 `registry.list`）
- `clearHooks(eventName?)`：清空某事件（或全部）钩子（委托给 `registry.clear`）

`getHookRegistry(eventBus)` 用于安全地拿到内部 registry（不存在或类型不匹配时返回 `null`）。

注意：
- 增强函数是幂等的；重复调用不会重复挂载。
- `Symbol.for(...)` 不是权限边界：如果把 eventBus 暴露给不受信任代码，对方仍可通过同名 Symbol 访问 registry。

## HookDefinition（钩子定义）

HookRegistry 以 `HookDefinition` 作为统一配置输入，常用字段：

- `type`：`command` / `prompt` / `agent`
- `blocking`：是否允许阻断主流程（默认 true）
- `tools`（以及 `tool` / `toolPattern` / `toolPatterns` 别名）：限定匹配的工具名（支持 `*` 通配符）；省略则匹配所有工具
- `handler`：command hook 的自定义处理函数
- `prompt` / `usage` / `agentType` / `modelTier`：prompt/agent hook 的配置

工具名匹配使用安全的通配符匹配实现（避免使用 RegExp 以降低 ReDoS 风险）。

## 钩子工厂函数

| 函数 | 用途 |
|------|------|
| `createPreToolUseHook(options)` | 工具调用前拦截（命令分类、权限检查） |
| `createPreAgentHook(options)` | 请求入口拦截（鉴权、限流、审计初始化） |
| `createPostAgentHook(options)` | 请求结束处理（用量上报、持久化、清理） |

### AgentLoop 集成

`BaseAgentLoop.execute()` 已内置 PreAgent/PostAgent 钩子调用：

```javascript
// agent-loop.js 内部流程
const preResult = await createPreAgentHook()({ sessionId, runId, input, context });
if (preResult?.skip) return { ok: false, error: preResult.reason };

const result = await this.run(input, context);

await createPostAgentHook()({ sessionId, runId, result, duration, context });
```

## 钩子事件 (HookEvent)

```javascript
const HookEvent = {
  // Agent 级别 - 每次 execute() 只执行一次
  PRE_AGENT: 'PreAgent',        // 请求入口：鉴权、限流、审计初始化
  POST_AGENT: 'PostAgent',      // 请求结束：用量上报、持久化、清理

  // LLM 级别 - 每次 LLM 调用
  PRE_LLM_CALL: 'PreLLMCall',   // LLM 调用前：请求改写、参数检查
  POST_LLM_CALL: 'PostLLMCall', // LLM 调用后：结果审计、统计

  // Tool 级别 - 每次工具调用
  PRE_TOOL_USE: 'PreToolUse',   // 工具调用前：权限/参数检查、审计
  POST_TOOL_USE: 'PostToolUse', // 工具调用后：结果过滤、审计、清理
}
```

建议：在代码中统一使用 `HookEvent.*` 常量作为 eventName，避免拼写错误导致钩子不生效。
