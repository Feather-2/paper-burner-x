# sdk - 高层 API

面向应用层的 Agent 构建和配置 API。

> **文件统计**: 17 个 JS 文件

## 核心文件

| 文件 | 职责 |
|------|------|
| `AgentBuilder.js` | fluent facade，委托 AgentConfig/AgentFactory 完成配置与实例构建 |
| `DefaultAgentLoop.js` | LLM 驱动 + 工具执行 + 中间件钩子 + checkpoint 生命周期控制 |
| `SoftBacktrackManager.js` | D-Mail 软回溯：限制次数、标记 superseded 消息、插入纠错 |
| `SubagentRegistry.js` | 子 Agent 注册表 |
| `AlertMonitor.js` | 告警监控 |
| `BacktrackManager.js` | 硬回溯管理 (与 SoftBacktrackManager 互补) |
| `DiscoveryManager.js` | 服务发现 |
| `agent-factory.js` | Agent 工厂函数 |
| `agent-config.js` | Agent 配置定义 |
| `config-loader.js` | 配置加载器 |
| `injection-scanner.js` | 注入检测 |

## 使用示例

```javascript
import { createAgent, AgentBuilder } from 'js/agents/sdk';

// 快速创建 (fluent builder)
const agent = createAgent({ actor: 'demo' })
  .useCapability('echo', async (args) => {
    const text = typeof args.text === 'string' ? args.text : '';
    return { ok: true, data: { echoed: text } };
  })
  .useHook('before', async ({ tool, params }) => {
    // 可在这里做审计或权限检查
  })
  .build();

// Builder 模式
const agent2 = new AgentBuilder({ actor: 'demo2' })
  .useCapability('greet', async (args) => ({
    ok: true,
    data: { message: `Hello, ${String(args?.name || 'World')}!` },
  }))
  .build();

// 运行
const result = await agent.run({ query: '分析这份文档' });
```

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
  softBacktrackManager: sbm,
});
```

### 执行模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `sequential` | 串行执行，按顺序一个个跑 | 默认，actions 有隐式依赖时 |
| `parallel` | 并行执行，Promise.all + 限流 | 独立 actions，如多个 bash 命令 |

**注意**：并行模式下用户需自行保证 actions 无依赖冲突。

## SoftBacktrackManager (D-Mail)

软回溯机制，允许 Agent 在执行过程中发送"时间纠错信号"，标记历史消息为 superseded 并插入纠错内容。

```javascript
import { SoftBacktrackManager } from 'js/agents/sdk';

const sbm = new SoftBacktrackManager({
  messageManager,      // 必需：MessageManager 实例
  maxDMails: 5,        // 最大 D-Mail 次数 (默认 5)
  l3Storage: storage,  // 可选：L3Storage 用于 snapshot 同步
});

// 检查是否还能发送 D-Mail
if (sbm.canSendDMail()) {
  // 处理 D-Mail 信号 (由工具返回 { ok, dmail } 触发)
  await sbm.processDMailSignal({
    correction: '纠正后的内容',
    supersedeRange: { from: 5, to: 10 },
    severity: 'major',
    timestamp: Date.now(),
  });
}

// 查询状态
sbm.dmailCount;      // 已发送次数
sbm.remaining;       // 剩余次数
sbm.getDMailHistory(); // 历史记录

// 重置
sbm.reset();
```

### D-Mail 工作流

1. 工具执行返回 `{ ok: true, dmail: { correction, supersedeRange, severity, timestamp } }`
2. DefaultAgentLoop 调用 `sbm.processDMailSignal(dmail)`
3. SBM 标记 supersedeRange 内消息为 superseded，插入 correction
4. 若配置 L3Storage，同步 snapshot
5. emit `agent:dmailProcessed` 事件

## 预构建 Agents

```javascript
import { DeepSearchAgentLoop, DesignAgentLoop, CodeSearchStage } from 'js/agents/sdk';
```

## 内置 Tools

| Tool | 文件 | 用途 |
|------|------|------|
| TaskTool | `runtime/tools/TaskTool.js` | 子任务分发 |
| RecallTool | `runtime/tools/RecallTool.js` | 记忆检索 |
| BacktrackTool | `runtime/tools/BacktrackTool.js` | 状态回溯 |
| DMailTool | `runtime/tools/DMailTool.js` | 软回溯 (D-Mail) 信号 |

## 示例代码

见 `examples/` 目录：
- `basic-usage.js` - 基础用法
- `subagent-usage.js` - 子 Agent
- `memory-recall.js` - 记忆检索
- `backtrack-usage.js` - 回溯
- `webarranger-resilience.js` - 容错
