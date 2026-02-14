# js/agents - AI Agent 微内核系统

基于微内核架构的 Agent 运行时，提供插件化、事件驱动的 AI Agent 基础设施。

## 技术栈

- **Language**: JavaScript + JSDoc (无 TypeScript 编译依赖，最大化跨端兼容)
- **Runtime**: ES Modules (Browser / Node.js / Bun)
  - **Deno**: 可检测但不完全支持 — VFS 回退到浏览器路径 (OPFS/Memory)，Skills 使用浏览器加载器，MCP stdio transport 不可用
- **Architecture**: Microkernel + Plugin + Event Bus
- **Protocols**: MCP (Model Context Protocol)
- **Storage**: VFS abstraction (Memory / OPFS / Storage)

> **设计哲学**: 纯 JS + JSDoc 类型注解，无需构建步骤即可在浏览器/服务端运行，最大化可移植性。

## 快速入口

```javascript
import { quickKernel, AgentBuilder, createAgent } from 'js/agents';

// Level 0: 一行创建
const kernel = await quickKernel('standard');

// Level 1: Builder 模式
const kernel = await KernelBuilder.create()
  .withPreset('deepsearch')
  .withPlugin(myPlugin)
  .build();

// Level 2: SDK
const agent = await createAgent({ model: 'gpt-4o', skills: ['search'] });
```

## 模块索引 (Layer 2)

| 模块 | 路径 | 职责 |
|------|------|------|
| **core** | `core/CLAUDE.md` | 微内核：Kernel, EventBus, StateBus, ServiceBus, MessageBus, Plugin |
| **runtime** | `runtime/CLAUDE.md` | 运行时：AgentLoop, Orchestrator, Tools, Hooks |
| **ingest** | `ingest/CLAUDE.md` | 文档摄取：多格式适配器 |
| **llm** | `llm/CLAUDE.md` | LLM 层：ModelRouter, Provider |
| **mcp** | `mcp/CLAUDE.md` | MCP 协议：Client, Provider |
| **skills** | `skills/CLAUDE.md` | 技能系统 |
| **vfs** | `vfs/CLAUDE.md` | 虚拟文件系统 |
| **prompts** | `prompts/CLAUDE.md` | 提示词模板 |
| **plugins** | `plugins/CLAUDE.md` | 内置插件 |
| **stages** | `stages/CLAUDE.md` | 业务阶段 |
| **sdk** | `sdk/CLAUDE.md` | 高层 API |
| **retrieval** | `retrieval/CLAUDE.md` | 检索系统 |
| **storage** | `storage/CLAUDE.md` | 存储抽象 |
| **shared** | `shared/CLAUDE.md` | 工具库 |
| **cli** | `cli/CLAUDE.md` | 命令行 |
| **eval** | `eval/CLAUDE.md` | 评估框架 |
| **testing** | `testing/CLAUDE.md` | 测试工具 |

## 深层索引 (Layer 3-4)

### core/
- `crdt/CLAUDE.md` - CRDT 共识层
- `sandbox/CLAUDE.md` - 沙箱隔离 (WASM + System)

### runtime/
- `core/CLAUDE.md` - 核心组件
- `compression/CLAUDE.md` - 上下文压缩
- `telemetry/CLAUDE.md` - 遥测追踪
- `memory/CLAUDE.md` - 记忆系统
- `hooks/CLAUDE.md` - 钩子系统 (HookRegistry)
- `middleware/CLAUDE.md` - 中间件链 (MiddlewareChain + Stage)
- `di/CLAUDE.md` - 依赖注入
- `tools/CLAUDE.md` - 内置工具
- `parallel/CLAUDE.md` - 并行任务
- `deps/CLAUDE.md` - Python 依赖
- `events/CLAUDE.md` - 事件类型
- `safety/CLAUDE.md` - 安全检查
- `analysis/CLAUDE.md` - 行为分析

### stages/
- `deepsearch/CLAUDE.md` - 深度搜索
  - `tools/CLAUDE.md` - DeepSearch 工具
- `design/CLAUDE.md` - 设计阶段
  - `generators/CLAUDE.md` - 生成器
  - `dsl/CLAUDE.md` - 幻灯片 DSL
  - `subagents/CLAUDE.md` - 子 Agent
  - `edit-mode/CLAUDE.md` - 编辑模式
  - `refiner/CLAUDE.md` - 精调
- `codesearch/CLAUDE.md` - 代码搜索
  - `indexing/CLAUDE.md` - 索引
  - `phases/CLAUDE.md` - 阶段

### ingest/
- `adapters/CLAUDE.md` - 文档适配器

### shared/
- `utils/CLAUDE.md` - 工具函数
- `embeddings/CLAUDE.md` - 向量嵌入
- `archive/CLAUDE.md` - 归档检查点

## 核心概念

### 四总线架构

```
EventBus   ─→ 发布/订阅事件（Lamport Clock 排序）
StateBus   ─→ 状态订阅（细粒度响应式）
ServiceBus ─→ 服务注册/发现（支持 Retry/Timeout/Cache 代理）
MessageBus ─→ RPC over EventBus，跨 Agent/Stage 请求-响应通信
```

### 插件系统

```javascript
const myPlugin = createPlugin({
  name: 'my-plugin',
  setup(ctx) {
    ctx.events.on('agent:step', handler);
    ctx.services.register('myService', impl);
  },
  teardown(ctx) { /* cleanup */ }
});
```

### 预设 (Presets)

- `minimal`: 最小内核，无插件
- `standard`: 标准配置
- `deepsearch`: 深度搜索优化
- `production`: 生产环境（含监控/压缩）

## 文件统计

| 模块 | 文件数 | 入口 |
|------|--------|------|
| **stages** | 148 | `stages/index.js` |
| **runtime** | 138 | `runtime/index.js` |
| **core** | 52 | `core/index.js` |
| **plugins** | 38 | `plugins/index.js` |
| **shared** | 35 | `shared/index.js` |
| **ingest** | 21 | `ingest/index.js` |
| **vfs** | 20 | `vfs/index.js` |
| **mcp** | 19 | `mcp/index.js` |
| **llm** | 11 | `llm/index.js` |
| **prompts** | 11 | `prompts/index.js` |
| **retrieval** | 10 | `retrieval/index.js` |
| **skills** | 9 | `skills/index.js` |
| **eval** | 9 | `eval/index.js` |
| **sdk** | 7 | `sdk/index.js` |
| **cli** | 5 | `cli/index.js` |
| **storage** | 3 | `storage/index.js` |
| **testing** | 1 | `testing/index.js` |
| **合计** | **544** | `index.js` |

- 类型定义：`events.d.ts`, `core/types.d.ts` (JSDoc 生成的 `.d.ts`)

## 约定

- 使用 ES Modules (`"type": "module"`)
- 类型通过 JSDoc 注解，配合 `@typedef` / `@param` / `@returns`
- 导出命名导出 + default 导出
- 事件名格式：`domain:action` (如 `agent:step`, `llm:complete`)
- 服务名格式：camelCase
