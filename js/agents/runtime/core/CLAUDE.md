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
| `persisted-output.js` | 大输出持久化处理 |

## 持久化输出 (Persisted Output)

防止工具返回的大输出撑爆 token 窗口。

### 数据流

```
Tool.execute()
    ↓
[After Hook] createPersistedOutputHook()
    ↓
result.data > 400KB? → wrapPersistedOutput() → <persisted-output>预览</persisted-output>
    ↓
MessageManager.addMessage()
    ↓
压缩触发时 → cleanOldOutputs(3) → 保留最近 3 个大输出
```

### 使用方式

```javascript
import {
  ToolRegistry,
  createPersistedOutputHook,
  MessageManager,
} from 'js/agents/runtime';

// 方式 1: ToolRegistry after hook (推荐)
const registry = new ToolRegistry({ tools });
registry.useHook('after', createPersistedOutputHook());

// 方式 2: ToolExecutor hooks
const executor = new ToolExecutor({
  tools,
  hooks: { after: [createPersistedOutputHook()] },
});

// 方式 3: MessageManager 手动包装
const mm = new MessageManager();
const wrapped = mm.wrapToolOutput(largeContent);
mm.cleanOldOutputs(3);  // 清理旧大输出
mm.dispose();           // 不再使用时清理定时器/压缩任务
```

### 常量

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `OUTPUT_THRESHOLD` | 400000 | 触发包装的字节阈值 |
| `PREVIEW_SIZE` | 2000 | 预览字符数 |
| `KEEP_RECENT_OUTPUTS` | 3 | 保留的大输出数量 |

## 运行时适配

| 文件 | 职责 |
|------|------|
| `runtime-adapter.js` | RuntimeAdapter 基类 |
| `js-adapter.js` | JSRuntimeAdapter |
| `python-adapter.js` | PythonRuntimeAdapter |
| `scheduler.js` | RuntimeScheduler |
| `worker-pool.js` | Worker 池 |
| `worker-rpc.js` | Worker RPC |

## Worker 与沙箱

| 文件 | 职责 |
|------|------|
| `worker-factory.js` | 跨平台 Worker 创建/终止 |
| `js-sandbox-worker.js` | 浏览器 Worker 沙箱 |
| `js-sandbox-worker.node.js` | Node.js Worker 沙箱 |

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
| `persisted-output.js` | 大输出持久化处理 |
| `shared-memory.js` | 共享内存 |
| `mechanisms.js` | 核心机制 |

## VFS 代理

| 文件 | 职责 |
|------|------|
| `vfs-proxy.js` | VFS 代理入口 |
| `vfs-proxy-client.js` | Worker 侧 VFS 客户端 |
| `vfs-proxy-host.js` | Host 侧 VFS 处理 |
| `vfs-proxy-protocol.js` | 协议/消息常量 |