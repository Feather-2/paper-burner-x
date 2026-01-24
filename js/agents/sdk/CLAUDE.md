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
| `AlertMonitor.js` | 异步规则告警监控：订阅事件、生成告警记录；支持 policy/model 配置与必要时的回退策略 |
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
2) 传入对象（用于携带 `definition` / `module` 等元信息；`handler` 可选）

说明：
- `module`：能力来源模块标识（用于追踪/归因/调试）
- `_module`：内部字段（通常由加载器/打包器注入），外部代码不建议依赖

```javascript
import { AgentBuilder } from 'js/agents/sdk';

// 1) handler 形式
const builder = new AgentBuilder({ actor: 'demo' }).useCapability(
  'echo',
  async (args) => ({ ok: true, data: { echoed: String(args?.text || '') } })
);

// 2) 对象形式（definition/handler/module）
builder.useCapability('echo', {
  definition: {
    // 见 CapabilityInterface 的定义
  },
  handler: async (args) => ({ ok: true, data: { echoed: String(args?.text || '') } }),
  module: 'my-capabilities/echo'
});
```

## AlertMonitor: 告警监控（可选）

用于在 Agent 运行期间基于本地规则生成告警记录，并按 `policy` 进行升级；当启发式不足时可配置 `model` 作为备用审计模型（仅在需要时使用）。
