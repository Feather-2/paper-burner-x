# sdk - 高层 API

面向应用层的 Agent 构建和配置 API（Browser-first，Node.js compatible）。

> **文件统计**: 17 个 JS 文件

## 核心文件

| 文件 | 职责 |
|------|------|
| `AgentBuilder.js` | fluent facade，委托 AgentConfig/AgentFactory 完成配置与实例构建；支持 capability 批量注册与元信息配置 |
| `DefaultAgentLoop.js` | LLM 驱动 + 工具执行 + 中间件钩子 + checkpoint 生命周期控制 |
| `SoftBacktrackManager.js` | D-Mail 软回溯：限制次数、标记 superseded 消息、插入纠错 |
| `SubagentRegistry.js` | 子 Agent 注册表 |
| `AlertMonitor.js` | 异步规则告警监控：订阅事件、生成告警记录、必要时触发回退策略 |
| `BacktrackManager.js` | 硬回溯管理（与 SoftBacktrackManager 互补） |
| `DiscoveryManager.js` | 服务发现 |
| `agent-factory.js` | Agent 工厂函数 |
| `agent-config.js` | Agent 配置定义与校验 |
| `config-loader.js` | 配置加载器 |
| `injection-scanner.js` | 注入检测 |

## 使用示例

```javascript
import { createAgent, AgentBuilder } from 'js/agents/sdk';

// 快速创建 (fluent builder)
const agent = createAgent({ actor: 'demo' })
  .useCapability('echo', async (args) => {
    const text = typeof args?.text === 'string' ? args.text : '';
    return { ok: true, data: { echoed: text } };
  })
  .useHook('before', async ({ tool, params }) => {
    // 可在这里做审计或权限检查
  })
  .build();

// Builder 模式
const agent2 = new AgentBuilder({ actor: 'demo2' })
  .useCapabilities({
    greet: async (args) => ({
      ok: true,
      data: { message: `Hello, ${String(args?.name || 'World')}!` }
    })
  })
  .build();

// 运行
const result = await agent.run({ query: '分析这份文档' });
```

## AgentBuilder: capability 注册

`AgentBuilder.useCapability(name, config)` 支持两种形式的 `config`：

1) 直接传入 handler 函数（最简单）
2) 传入对象（用于携带 `definition` / `module` 等元信息）

```javascript
import { AgentBuilder } from 'js/agents/sdk';

// 1) handler 形式
const builder = new AgentBuilder({ actor: 'demo' }).useCapability(
  'echo',
  async (args) => ({ ok: true, data: { echoed: String(args?.text || '') } })
);

// 2) 对象形式（definition/handler/module）
builder.useCapability('echo', {
  definition: { /* 见 CapabilityInterface 的定义 */ },
  handler: async (args) => ({ ok: true, data: { echoed: String(args?.text || '') } }),
  module: 'my-capabilities/echo'
});
```

批量注册能力可用 `useCapabilities(capabilitiesMap)`：

```javascript
builder.useCapabilities({
  echo: async (args) => ({ ok: true, data: { echoed: String(args?.text || '') } }),
  greet: async (args) => ({ ok: true, data: { message: `Hi, ${String(args?.name || '')}` } })
});
```

安全提示：
- `capability name` 不应直接使用未信任输入；需要过滤保留键（如 `__proto__` / `constructor` / `prototype`）。
- 若使用 `module`/`_module` 做动态加载，请务必做 allowlist + 路径约束（避免加载任意模块）。

## Hook

`useHook(phase, fn)` 用于注册生命周期钩子（当前公开 phase：`before` / `after`）。钩子的参数结构由 loop/toolExecutor 传递，建议只依赖稳定字段（如 `tool` / `params` / `result`）。

## DefaultAgentLoop 配置

```javascript
import { DefaultAgentLoop, SoftBacktrackManager } from 'js/agents/sdk';

const sbm = new SoftBacktrackManager({ messageManager });

const loop = new DefaultAgentLoop({
  toolExecutor,
  capabilities,
  maxIterations: 10,

  // Action 执行模式 (默认: 'sequential')
  actionExecution: 'parallel',  // 'sequential' | 'parallel'
  maxParallelActions: 5,        // 并行模式下最大并发数

  // 可选：启用 D-Mail 软回溯
  softBacktrackManager: sbm
});
```

### 执行模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `sequential` | 串行执行，按顺序一个个跑 | 默认，actions 有隐式依赖时 |
| `parallel` | 并行执行，Promise.all + 限流 | 独立 actions，如多个命令或多个工具调用 |

**注意**：并行模式下用户需自行保证 actions 无依赖冲突。

## AlertMonitor

`AlertMonitor` 用于在不增加 token 的前提下，对 Agent 行为做本地规则监控，并生成结构化告警（可用于 UI 提示、日志、策略升级等）。当启发式不足时，可配置备用 `model` 做进一步审计（注意敏感信息最小化）。

```javascript
import { AlertMonitor } from 'js/agents/sdk';

const monitor = new AlertMonitor({
  agent,                 // 关联的 agent 实例
  logger,                // 可选：用于输出告警与调试信息
  policy: 'advisor',     // 例如: advisor / governor
  model: 'haiku'         // 可选：仅在需要时启用
});
```

建议：
- 只记录必要字段，避免把 tool params / results 中的敏感信息直接打日志。
- 对外展示的告警信息应为用户友好消息，避免暴露内部堆栈/实现细节。
