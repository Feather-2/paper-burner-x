# hooks - 钩子系统

工具调用和 Agent 运行的拦截和处理。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口，导出所有钩子 API |
| `hook-registry.js` | HookRegistry - 钩子注册表，HookType/HookEvent 常量 |
| `hook-runner.js` | 钩子工厂函数 (createPreToolUseHook/createPreAgentHook/createPostAgentHook) |
| `event-bus-hooks.js` | EventBus 钩子增强 |
| `hooks-config-loader.js` | HooksConfigLoader - VFS 配置加载 + 热重载 |

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
  PRE_AGENT: 'PreAgent',   // 请求入口：鉴权、限流、审计初始化
  POST_AGENT: 'PostAgent', // 请求结束：用量上报、持久化、清理

  // LLM 级别 - 每次 LLM 调用
  PRE_LLM_CALL: 'PreLLMCall',
  POST_LLM_CALL: 'PostLLMCall',

  // Tool 级别 - 每次工具调用
  PRE_TOOL_USE: 'PreToolUse',
  POST_TOOL_USE: 'PostToolUse',
};
```

## 钩子实现类型 (HookType)

```javascript
const HookType = {
  COMMAND: 'command',  // 命令分类器/自定义函数
  PROMPT: 'prompt',    // LLM 审批
  AGENT: 'agent',      // Subagent 审批
};
```

## 使用示例

### Agent 级别钩子

```javascript
import {
  enhanceEventBusWithHooks,
  HookEvent,
} from 'js/agents/runtime/hooks';

// 增强 EventBus
const eventBus = enhanceEventBusWithHooks(rawEventBus);

// 注册 PreAgent 钩子 - 速率限制
eventBus.registerHook('PreAgent', {
  type: 'command',
  handler: async (ctx) => {
    const allowed = await checkRateLimit(ctx.sessionId);
    if (!allowed) {
      return { skip: true, reason: 'Rate limit exceeded' };
    }
    return null; // 允许继续
  },
});

// 注册 PostAgent 钩子 - 用量上报
eventBus.registerHook('PostAgent', {
  type: 'command',
  blocking: false,
  handler: async (ctx) => {
    await reportUsage({
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      duration: ctx.duration,
      error: ctx.error?.message,
    });
  },
});
```

### Tool 级别钩子

```javascript
import { HookRegistry, HookType, createPreToolUseHook } from 'js/agents/runtime/hooks';

const registry = new HookRegistry();

// 注册 Pre-Tool 钩子
registry.register('PreToolUse', {
  type: HookType.COMMAND,
  tools: ['bash', 'exec*'],  // 支持通配符
  blocking: true,
});
```

## 执行流程

```
用户请求
    ↓
┌─────────────────────────────────────────┐
│ [PreAgent] ← 请求入口，只执行 1 次       │
│    ↓                                     │
│    ┌─────────────────────────────────┐  │
│    │ Agent Loop (可能循环多次)         │  │
│    │    ↓                             │  │
│    │ [PreLLMCall]                     │  │
│    │    ↓                             │  │
│    │  Model.call()                    │  │
│    │    ↓                             │  │
│    │ [PostLLMCall]                    │  │
│    │    ↓                             │  │
│    │ [PreToolUse]                     │  │
│    │    ↓                             │  │
│    │  Tool.execute()                  │  │
│    │    ↓                             │  │
│    │ [PostToolUse]                    │  │
│    └─────────────────────────────────┘  │
│    ↓                                     │
│ [PostAgent] ← 请求结束，只执行 1 次      │
└─────────────────────────────────────────┘
    ↓
用户响应
```

## 与 EventBus 集成

```javascript
import { enhanceEventBusWithHooks } from 'js/agents/runtime/hooks';

const enhancedBus = enhanceEventBusWithHooks(eventBus);

// 现在可以使用 eventBus.registerHook()
enhancedBus.registerHook('PreAgent', {
  type: 'command',
  handler: async (ctx) => { ... }
});
```

## HooksConfigLoader (热重载)

从 VFS 加载 hooks 配置文件，支持轮询热重载：

```javascript
import { HooksConfigLoader, HookRegistry } from 'js/agents/runtime/hooks';

const registry = new HookRegistry();
const loader = new HooksConfigLoader({
  vfs,
  registry,
  configPath: '.agents/hooks.json',  // 可选，默认值
  pollIntervalMs: 2000,              // 可选，轮询间隔
});

await loader.init();  // 加载配置，启动监听

// 配置格式 (.agents/hooks.json)
// {
//   "hooks": [
//     { "event": "PreToolUse", "type": "command", "tools": ["bash"], "blocking": true },
//     { "event": "PreAgent", "type": "command", "blocking": true }
//   ]
// }

// 清理
await loader.dispose();
```

特性：
- FNV-1a 哈希变更检测
- 配置解析错误只警告不抛出
- 无效 hook 定义跳过并警告
- DisposableBase 继承，正确清理

