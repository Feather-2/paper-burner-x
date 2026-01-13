# runtime - Agent 运行时

Agent Loop 基础设施，包括生命周期、工具执行、压缩、遥测和依赖注入。

## 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| **AgentLoop** | `core/agent-loop.js` | BaseAgentLoop 基类，Step 执行循环 |
| **Orchestrator** | `orchestrator.js` | 多 Agent 编排，调度模式 |
| **ToolRegistry** | `core/tool-registry.js` | 工具注册/解析/执行 |
| **ToolExecutor** | `tools/tool-executor.js` | 工具执行器 |
| **Hooks** | `hooks/` | Pre/Post Tool Use 钩子 |
| **StatusController** | `core/status-controller.js` | Agent 状态机 |
| **MessageManager** | `core/message-manager.js` | 消息历史管理 |

## 子模块索引

| 子模块 | 路径 | 职责 |
|--------|------|------|
| **core** | `core/CLAUDE.md` | AgentLoop, ToolRegistry, MessageManager, StatusController |
| **compression** | `compression/` | Watchdog + CicadaCompressor + Coordinator |
| **telemetry** | `telemetry/` | TokenTracker, TraceContext, Replay |
| **memory** | `memory/` | MemoryStore, StateEngine, RetrievalEngine |
| **parallel** | `parallel/` | TaskGraph 并行任务图 |
| **hooks** | `hooks/CLAUDE.md` | 钩子系统 (HookRegistry + HookEvent) |
| **middleware** | `middleware/CLAUDE.md` | 中间件链 (MiddlewareChain + Stage + 内置中间件) |
| **di** | `di/` | 依赖注入容器 |
| **deps** | `deps/` | Python Skill 依赖管理 |
| **events** | `events/` | 事件类型定义 |
| **api** | `api/` | StageApiFactory |
| **context** | `context/` | UnifiedAgentContext |
| **safety** | `safety/` | 命令分类器 |
| **analysis** | `analysis/` | 行为分析 |
| **transports** | `transports/CLAUDE.md` | 外部二进制通信 (ProcessTransport, BinarySkillProvider) |

## 状态机

```
AgentStatus: IDLE → RUNNING → PAUSED/COMPLETED/FAILED/CANCELLED
StepStatus:  PENDING → RUNNING → COMPLETED/FAILED/SKIPPED
```

## 调度模式

```javascript
import { AgentOrchestrator, SchedulingMode } from 'js/agents/runtime';

const orchestrator = new AgentOrchestrator({
  mode: SchedulingMode.PARALLEL,  // SERIAL | PARALLEL | PRIORITY
});
```

## Hooks

```javascript
import { HookRegistry, HookType, createPreToolUseHook } from 'js/agents/runtime';

const hook = createPreToolUseHook((toolName, args) => {
  if (toolName === 'bash') return classifyCommand(args.command);
  return { allow: true };
});
```
