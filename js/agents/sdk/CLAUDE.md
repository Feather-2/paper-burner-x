# sdk - 高层 API

面向应用层的 Agent 构建和配置 API。

## 核心文件

| 文件 | 职责 |
|------|------|
| `AgentBuilder.js` | createAgent, AgentBuilder, AgentInstance |
| `DefaultAgentLoop.js` | 默认 Agent 循环实现 |
| `SubagentRegistry.js` | 子 Agent 注册表 |
| `AlertMonitor.js` | 告警监控 |
| `BacktrackManager.js` | 回溯管理 |
| `DiscoveryManager.js` | 服务发现 |
| `agent-factory.js` | Agent 工厂函数 |
| `agent-config.js` | Agent 配置定义 |
| `config-loader.js` | 配置加载器 |
| `injection-scanner.js` | 注入检测 |

## 使用示例

```javascript
import { createAgent, AgentBuilder } from 'js/agents/sdk';

// 快速创建
const agent = await createAgent({
  model: 'gpt-4o',
  skills: ['search', 'code'],
  tools: [myCustomTool],
});

// Builder 模式
const agent = AgentBuilder.create()
  .withModel('claude-3')
  .withSkills(['deepsearch'])
  .withEventBus(eventBus)
  .build();

// 运行
const result = await agent.run('分析这份文档');
```

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

## 示例代码

见 `examples/` 目录：
- `basic-usage.js` - 基础用法
- `subagent-usage.js` - 子 Agent
- `memory-recall.js` - 记忆检索
- `backtrack-usage.js` - 回溯
- `webarranger-resilience.js` - 容错
