# plugins - 内置插件

Kernel 插件集合，按功能分类。

## 子目录上下文

| 子目录 | 说明 | 入口 |
|--------|------|------|
| `analysis/` | 行为分析与收敛检测 | `analysis/CLAUDE.md` |
| `checkpoints/` | 运行检查点持久化 | `checkpoints/CLAUDE.md` |
| `compression/` | 上下文压缩与监控（Cicada/Watchdog） | `compression/CLAUDE.md` |
| `compression/impl/` | 压缩内部实现 | `compression/impl/CLAUDE.md` |
| `coordination/` | 跨 Tab/进程 协调 | `coordination/CLAUDE.md` |
| `debug/` | 运行时检查与结构化日志 | `debug/CLAUDE.md` |
| `deps/` | Pyodide 依赖与 Python Skill 执行 | `deps/CLAUDE.md` |
| `memory/` | 记忆存储与检索 | `memory/CLAUDE.md` |
| `memory/l3-storage/` | L3 索引与持久化 | `memory/l3-storage/CLAUDE.md` |
| `plan/` | 计划模型与结构化规划 | `plan/CLAUDE.md` |
| `policy/` | 策略匹配与审批 | `policy/CLAUDE.md` |
| `resilience/` | 容错与降级 | `resilience/CLAUDE.md` |
| `routing/` | 性能感知路由 | `routing/CLAUDE.md` |
| `services/` | 内核基础服务注册 | `services/CLAUDE.md` |
| `side-effects/` | 可回滚副作用日志 | `side-effects/CLAUDE.md` |
| `stages/` | 阶段插件（DeepSearch） | - |
| `telemetry/` | 遥测/追踪/回放 | `telemetry/CLAUDE.md` |
| `transports/` | 外部进程通信 | `transports/CLAUDE.md` |

## 插件索引

### compression/ - 压缩

| 文件 | 插件 | 职责 |
|------|------|------|
| `cicada.js` | `compression/cicada` | Cicada 上下文压缩 |
| `watchdog.js` | `compression/watchdog` | Token 监控告警与自动压缩 |

### analysis/ - 分析

| 文件 | 插件 | 职责 |
|------|------|------|
| `fingerprint.js` | `analysis/fingerprint` | 行为指纹/去重 |
| `convergence-detector.js` | `analysis/convergence` | 语义收敛检测 |
| `behavior-fingerprint.js` | `analysis/behavior` | 行为指纹与上下文蒸馏 |

### telemetry/ - 遥测

| 文件 | 插件 | 职责 |
|------|------|------|
| `token-tracker.js` | `telemetry/token-tracker` | Token 使用统计 |
| `trace-context.js` | `telemetry/trace` | 分布式追踪上下文 |
| `replay-controller.js` | `telemetry/replay` | 运行回放控制 |

### memory/ - 记忆

| 文件 | 插件 | 职责 |
|------|------|------|
| `memory-store.impl.js` | `memory/store` | 记忆存储插件 |
| `state-engine.js` | `memory/state-engine` | 状态引擎插件 |
| `retrieval-engine.js` | `memory/retrieval` | 记忆检索插件 |

### coordination/ - 协调

| 文件 | 插件 | 职责 |
|------|------|------|
| `tab-coordinator.js` | `coordination/tab` | BroadcastChannel 跨 Tab 协调 |
| `process-coordinator.js` | `coordination/process` | cluster IPC 跨进程协调 |

### checkpoints/ - 检查点

| 文件 | 插件 | 职责 |
|------|------|------|
| `agent-checkpoint-store.js` | `checkpoints/store` | 运行检查点持久化 |

### deps/ - 依赖

| 文件 | 插件 | 职责 |
|------|------|------|
| `index.js` | `deps/python` | Pyodide 依赖解析与 Python Skill 执行 |

### plan/ - 计划

| 文件 | 插件 | 职责 |
|------|------|------|
| `plan-store.js` | `plan/store` | 运行计划与持久化 |
| `structured-plan.js` | `plan/structured` | 结构化计划构建与校验 |

### policy/ - 策略

| 文件 | 插件 | 职责 |
|------|------|------|
| `engine.js` | `policy/engine` | 规则匹配与决策 |
| `manager.js` | `policy/manager` | 审批流程与规则管理 |

### routing/ - 路由

| 文件 | 插件 | 职责 |
|------|------|------|
| `performance-router.js` | `routing/performance` | 性能感知路由 |

### transports/ - 传输

| 文件 | 插件 | 职责 |
|------|------|------|
| `index.js` | `transports/process` | Node/Browser 传输分发 |

### side-effects/ - 副作用

| 文件 | 插件 | 职责 |
|------|------|------|
| `side-effect-journal.js` | `side-effects/journal` | 可回滚副作用日志 |

### resilience/ - 容错

| 文件 | 插件 | 职责 |
|------|------|------|
| `retry.js` | `resilience/retry` | ServiceBus 自动重试 |
| `degradation-matrix.js` | - | 运行降级矩阵与策略 |

### services/ - 服务

| 文件 | 插件 | 职责 |
|------|------|------|
| `llm.js` | `service/llm` | LLM 服务注册 |
| `mcp.js` | `service/mcp` | MCP 服务注册 |
| `scheduler.js` | `service/scheduler` | 调度器服务 |
| `vfs.js` | `service/vfs` | VFS 读写与 Glob |

### debug/ - 调试

| 文件 | 插件 | 职责 |
|------|------|------|
| `inspector.js` | `debug/inspector` | 运行时检查器 |
| `logger.js` | `debug/logger` | 结构化日志 |

### stages/ - 阶段

| 文件 | 插件 | 职责 |
|------|------|------|
| `deepsearch.js` | `stage/deepsearch` | DeepSearch 阶段插件 |

### core/ - 内核扩展

| 文件 | 插件 | 职责 |
|------|------|------|
| `../core/sandbox/plugin.js` | `sandbox` | 沙箱插件 |

## 使用示例

```javascript
import { Kernel } from 'js/agents/core';

const kernel = new Kernel();
await kernel.use('compression/cicada', { threshold: 0.8 });
await kernel.use('compression/watchdog', { maxTokens: 100000 });
await kernel.use('debug/logger', { level: 'debug' });
```

## 创建自定义插件

```javascript
import { createPlugin } from 'js/agents/core';

export default createPlugin({
  name: 'my-plugin',
  version: '1.0.0',

  setup(ctx) {
    ctx.events.on('agent:step', handleStep);
    ctx.services.register('myService', myImpl);
  },

  teardown(ctx) {
    // cleanup
  }
});
```