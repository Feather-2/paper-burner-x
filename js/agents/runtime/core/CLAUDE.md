# core (runtime/core) - 运行时核心

Agent Loop 的核心组件。

## 核心文件

| 文件 | 职责 |
|------|------|
| `agent-loop.js` | BaseAgentLoop - 基础循环 |
| `agent-status.js` | AgentStatus, StepStatus 枚举 |
| `lifecycle.js` | 生命周期事件 |
| `status-controller.js` | StatusController - 状态控制 |
| `message-manager.js` | MessageManager - 消息管理 |
| `tool-registry.js` | ToolRegistry - 工具注册 |

## 运行时适配

| 文件 | 职责 |
|------|------|
| `js-adapter.js` | JSRuntimeAdapter |
| `python-adapter.js` | PythonRuntimeAdapter |
| `scheduler.js` | RuntimeScheduler |
| `worker-pool.js` | Worker 池 |
| `worker-rpc.js` | Worker RPC |

## 错误和安全

| 文件 | 职责 |
|------|------|
| `stage-errors.js` | StagePausedError, StageCancelledError |
| `error-boundary.js` | 错误边界 |
| `resource-guard.js` | 资源守卫 |
| `retry-strategy.js` | 重试策略 |

## 配置和上下文

| 文件 | 职责 |
|------|------|
| `constants.js` | ActorType, OrchestratorState |
| `config-validator.js` | 配置验证 |
| `context-config.js` | 上下文配置 |
| `vfs-proxy.js` | VFS 代理 |
| `shared-memory.js` | 共享内存 |
| `mechanisms.js` | 核心机制 |
