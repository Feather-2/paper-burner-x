# js/agents 架构审查报告

> 生成时间: 2026-01-04
> 代码规模: 327 文件, ~25,400 行

## 一、现状概览

### 1.1 目录结构

```
js/agents/
├── sdk/          # 公共 SDK API (AgentBuilder, SubagentRegistry)
├── runtime/      # Agent 运行时基础设施 (69 文件)
│   ├── core/     # BaseAgentLoop, 状态机, 调度器
│   ├── events/   # EventBus, Lamport Clock
│   ├── memory/   # MemoryStore (L0-L3), StateEngine
│   ├── compression/  # Cicada 压缩, Watchdog
│   └── telemetry/    # Token 追踪, Trace Context
├── stages/       # 具体 Agent 实现
│   ├── deepsearch/   # 深度研究 Agent (~50 文件)
│   ├── design/       # PPT 设计 Agent (~40 文件)
│   └── codesearch/   # 代码搜索 Agent
├── llm/          # ModelRouter, 多模型路由
├── mcp/          # MCP 协议层
├── retrieval/    # 检索层 (BM25, MMR, Grep)
├── ingest/       # 文档解析
├── vfs/          # 虚拟文件系统
├── shared/       # 公共工具
├── skills/       # Skill Catalog
└── storage/      # 持久化存储
```

### 1.2 核心指标

| 指标 | 数值 |
|------|------|
| 源文件数 | 327 |
| 导出类数 | 169 |
| async 函数数 | 420 |
| Promise 使用数 | 109 |
| try-catch 块数 | 167 |
| 测试文件数 | 100 (tests/agents/) |

---

## 二、P0 - 必须解决的问题

### 2.1 工具函数重复定义

**现状**:
- `isPlainObject` 定义 54 处
- `toNonEmptyString` 定义 45 处
- `estimateTokens` 定义 5 处

**问题**: 维护成本高，行为可能不一致

**建议**:
```js
// ❌ 现状：每个文件自己定义
function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

// ✅ 建议：统一从 shared 导入
import { isPlainObject, toNonEmptyString } from "@agents/shared/utils";
```

**工作量**: 1-2 小时

---

### 2.2 深层导入路径

**现状**:
```js
import { robustParseJson } from "../../../../shared/utils/robust-json.js";
import { DiscoveryStatus } from "../../../../sdk/DiscoveryManager.js";
```

**问题**:
- 路径脆弱，重构时容易断裂
- 可读性差

**建议**: 使用 import alias
```js
// vite.config.js / tsconfig.json
{
  "paths": {
    "@agents/*": ["js/agents/*"]
  }
}

// 使用
import { robustParseJson } from "@agents/shared/utils/robust-json";
```

**工作量**: 半天（需配置构建工具）

---

### 2.3 存储层分散

**现状**: 81 处直接访问 `localStorage`/`sessionStorage`

**问题**:
- 无法统一 mock 测试
- 配额管理困难
- SSR/Worker 环境不兼容

**建议**: 统一通过 `storage-adapter.js`
```js
// ❌ 现状
const value = localStorage.getItem("key");

// ✅ 建议
import { getStorage } from "@agents/shared/storage-adapter";
const storage = getStorage(); // 自动降级: OPFS → IndexedDB → localStorage → Memory
const value = await storage.get("key");
```

---

## 三、P1 - 架构债务

### 3.1 缺少依赖注入容器

**现状**: 核心类硬编码实例化
```js
const eventBus = new EventBus();
const modelRouter = new ModelRouter({ ... });
const memoryStore = new MemoryStore();
```

**问题**:
- 测试时需要大量 mock
- 无法灵活替换实现
- 循环依赖风险

**建议**: 引入轻量 DI
```js
// container.js
export function createAgentContainer(overrides = {}) {
  const registry = new Map();

  const defaults = {
    eventBus: () => new EventBus(),
    modelRouter: (c) => new ModelRouter({ logger: c.get('logger') }),
    memoryStore: (c) => new MemoryStore({ eventBus: c.get('eventBus') }),
  };

  return {
    get(key) {
      if (!registry.has(key)) {
        const factory = overrides[key] || defaults[key];
        registry.set(key, factory(this));
      }
      return registry.get(key);
    }
  };
}
```

---

### 3.2 AgentLoop 继承链设计

**现状**: 5 个子类继承 `BaseAgentLoop`
- `DefaultAgentLoop`
- `DeepSearchAgentLoop`
- `DesignAgentLoop`
- `CodeSearchStage`
- `EditAgentLoop`

**问题**: 子类重复实现相似逻辑（phases 执行、消息压缩触发）

**建议**: 提取 Phase Executor 模式
```js
class BaseAgentLoop {
  async runPhases(phases) {
    for (const phase of phases) {
      if (this.shouldSkipPhase(phase)) continue;
      await this.executePhase(phase);
      if (this.shouldEarlyExit()) break;
    }
  }
}

// 子类只需定义 phases
class DeepSearchAgentLoop extends BaseAgentLoop {
  phases = [PlanningPhase, ExecutionPhase, WritingPhase];
}
```

---

### 3.3 类型安全缺失

**现状**: 仅 3 个 `.d.ts` 文件，327 个 `.js` 文件

**问题**:
- IDE 支持有限
- 重构时缺少编译期检查
- API 契约不明确

**建议**: 渐进式 TypeScript
1. 阶段一: 为 `sdk/` 添加 `.d.ts`（不改 .js）
2. 阶段二: `runtime/core/` 迁移到 `.ts`
3. 阶段三: 全量迁移

---

## 四、P2 - 性能优化

### 4.1 Promise 使用密集

**现状**:
- 109 处 `new Promise` 手动包装
- 420 个 async 函数

**问题**: 部分可能是不必要的异步化

**建议**: 审查以下模式
```js
// ❌ 不必要的 Promise 包装
async function getValue() {
  return this.cache.get(key); // 同步操作
}

// ✅ 同步返回
function getValue() {
  return this.cache.get(key);
}
```

---

### 4.2 定时器分散

**现状**: 56 处 `setTimeout`/`setInterval`

**问题**:
- 取消逻辑分散
- 暂停/恢复困难
- 内存泄漏风险

**建议**: 统一定时器管理
```js
class TimerManager {
  schedule(id, fn, delayMs) { ... }
  cancel(id) { ... }
  pauseAll() { ... }
  resumeAll() { ... }
  dispose() { ... } // 清理所有定时器
}
```

---

### 4.3 大文件需拆分

| 文件 | 行数 | 建议 |
|------|------|------|
| `storage/run-store.js` | 1116 | 拆分: `db.js`, `retention.js`, `export.js` |
| `mcp/smart-content-extractor.js` | 930 | 拆分: `html-extractor.js`, `pdf-extractor.js` |
| `mcp/mcp-nexus-provider.js` | 818 | 拆分: `nexus-client.js`, `nexus-tools.js` |
| `llm/model-router.js` | 752 | 拆分: `router.js`, `circuit-breaker.js`, `rate-limiter.js` |

---

## 五、P3 - 可维护性

### 5.1 测试与源码分离

**现状**: 测试在 `tests/agents/`，源码在 `js/agents/`

**建议**: Colocated tests
```
js/agents/runtime/core/
├── agent-loop.js
├── agent-loop.test.js  # 就近放置
└── agent-status.js
```

---

### 5.2 TODO/FIXME 分散

**现状**: 46 个分散在代码中

**建议**: 集中管理
```markdown
# ROADMAP.md
## Technical Debt
- [ ] js-adapter.js:15 - 添加 quickjs-emscripten WASM 沙箱
- [ ] ...
```

---

### 5.3 导出层次不清

**现状**: `index.js` 重导出 46 项

**建议**: 分层导出
```js
// @agents/core - 核心运行时
export { BaseAgentLoop, EventBus, MemoryStore } from "./core";

// @agents/stages - 具体实现
export { DeepSearchAgentLoop, DesignAgentLoop } from "./stages";

// @agents/mcp - MCP 协议
export { McpClient, LocalMcpProvider } from "./mcp";
```

---

## 六、优先级排序

| 优先级 | 任务 | 工作量 | 风险 |
|--------|------|--------|------|
| P0.1 | 工具函数收敛 | 2h | 低 |
| P0.2 | import alias 配置 | 4h | 中 |
| P0.3 | 存储层统一 | 1d | 中 |
| P1.1 | DI 容器引入 | 2d | 中 |
| P1.2 | Phase Executor 重构 | 1d | 中 |
| P2.1 | 大文件拆分 | 2d | 低 |
| P3.1 | TypeScript 迁移 | 长期 | 高 |

---

## 七、理论优化空间（深度分析）

### 7.1 错误处理缺陷

**现状**:
- 362 处 `catch {}` 静默吞错（无变量捕获）
- 仅 82 处 `.catch()` 链式处理

**问题**:
- 调试困难：错误被静默吞掉
- 无法追踪失败根因
- 违反 fail-fast 原则

**建议**:
```js
// ❌ 静默吞错
try { doSomething(); } catch {}

// ✅ 至少记录
try { doSomething(); } catch (err) {
  logger.debug('doSomething failed', { error: err.message });
}

// ✅✅ 结构化错误
try { doSomething(); } catch (err) {
  throw new AgentError('OPERATION_FAILED', { cause: err });
}
```

**影响**: 高 - 生产环境难以排查问题

---

### 7.2 内存管理隐患

**现状**:
- 281 处 `new Map()`/`new Set()` 创建
- 仅 6 处 `WeakMap`/`WeakRef` 使用
- 180 处 `Object.freeze()` 不可变

**问题**:
- Map/Set 未清理可能导致内存泄漏
- 长生命周期对象持有短生命周期引用
- MemoryStore L3 归档层无上限

**建议**:
```js
// ❌ 现状：无限增长
this._cache = new Map();
this._cache.set(key, value);

// ✅ 建议：LRU + TTL
import { LRUCache } from '@agents/shared/utils/lru-cache';
this._cache = new LRUCache({ max: 1000, ttl: 60_000 });

// ✅ 弱引用（适用于缓存）
this._instanceCache = new WeakMap();
```

---

### 7.3 并发控制不足

**现状**:
- `Promise.all` 使用稀少（仅 ~15 处）
- 串行 await 循环存在（`for...await`）
- 无统一并发限制器

**问题**:
- 串行处理慢
- 并发无上限可能压垮下游

**建议**:
```js
// ❌ 串行
for (const item of items) {
  await processItem(item);
}

// ✅ 受控并发
import { pMap } from '@agents/shared/utils/p-map';
await pMap(items, processItem, { concurrency: 5 });
```

---

### 7.4 事件系统效率

**现状**:
- 125 处 `emit/on/off` 调用
- EventBus 支持背压但默认未启用
- 无事件批处理

**问题**:
- 高频事件（如 progress）可能阻塞主线程
- 订阅者泄漏风险

**建议**:
1. 默认启用背压：`eventBus.enableBackpressure({ batchWindowMs: 16 })`
2. 自动清理：`signal.addEventListener('abort', () => eventBus.off(...))`
3. 事件合并：相同 key 的 progress 事件只保留最新

---

### 7.5 状态管理碎片化

**现状**:
- `MemoryStore` L0-L3 分层
- `StateEngine` Redux-like
- `DeepSearchState` 独立状态类
- `UnifiedAgentContext` 门面

**问题**:
- 4 套状态管理并存
- 同步点不明确
- 序列化/反序列化路径多

**建议**:
```
┌────────────────────────────────┐
│  UnifiedAgentContext (门面)    │  ← 唯一对外接口
├────────────────────────────────┤
│  StateEngine (状态机)          │  ← 统一 dispatch
├────────────────────────────────┤
│  MemoryStore (存储)            │  ← 纯存储，无业务逻辑
└────────────────────────────────┘

废弃：DeepSearchState 独立状态 → 迁移到 StateEngine
```

---

### 7.6 日志系统碎片

**现状**:
- 59 处 `createLogger()` 调用
- 16 个文件仍有直接 `console.*`
- 无统一日志级别控制

**建议**:
```js
// 全局配置
Logger.setLevel('warn'); // 生产环境
Logger.setLevel('debug'); // 开发环境

// 命名空间过滤
Logger.enable('agents:deepsearch:*');
Logger.disable('agents:mcp:*');
```

---

### 7.7 取消机制不完整

**现状**:
- 171 处 `AbortController`/`AbortSignal` 使用
- 但许多 async 函数不接受 signal 参数

**问题**:
- 用户取消后，后台任务仍在运行
- 资源浪费

**建议**:
```js
// ❌ 不可取消
async function fetchData() { ... }

// ✅ 可取消
async function fetchData({ signal } = {}) {
  signal?.throwIfAborted();
  const response = await fetch(url, { signal });
  ...
}
```

---

### 7.8 序列化开销

**现状**:
- 179 处 `JSON.parse`/`JSON.stringify`
- 57 处 `deepClone`/`structuredClone`
- 检查点频繁全量序列化

**问题**:
- 大状态对象序列化慢
- 深拷贝开销高

**建议**:
1. **增量序列化**: 只序列化变更部分（已有 `_dirty` 标记）
2. **延迟序列化**: 使用 getter 延迟计算
3. **二进制格式**: 考虑 MessagePack/CBOR 替代 JSON

---

### 7.9 模块循环依赖风险

**现状**:
- `shared/` ← `runtime/` ← `stages/` ← `sdk/`
- 部分文件存在隐式循环

**检测方法**:
```bash
npx madge --circular js/agents
```

**建议**:
- 抽取公共类型到 `types/`
- 使用依赖注入解耦

---

### 7.10 浏览器/Node 兼容性

**现状**:
- 99 处 `globalThis`/`window`/`self` 访问
- 条件导入分散

**建议**:
```js
// 统一环境检测
import { isBrowser, isNode, isWorker } from '@agents/shared/env';

// 统一 API 适配
import { getStorage, getCrypto } from '@agents/shared/platform';
```

---

## 八、效率瓶颈分析

### 8.1 热路径识别

| 热路径 | 频率 | 优化建议 |
|--------|------|----------|
| `MemoryStore.toSnapshot()` | 每轮迭代 | 增量快照（已有 _dirty 标记，需完善） |
| `estimateTokens()` | 每条消息 | 缓存结果，避免重复计算 |
| `JSON.stringify()` in EventBus | 每事件 | 延迟序列化，仅 persist 时执行 |
| `robustParseJson()` | LLM 每响应 | 流式解析，避免全量缓存 |

### 8.2 串行瓶颈

```
DeepSearchAgentLoop.run()
  → loadDeepSearchCapabilities()      // 8 个 dynamic import 串行
  → addInitialDeepSearchMessages()
  → for (iteration) {
      → runPlanningPhaseIteration()   // LLM call (串行)
      → executeDeepSearchDecision()   // 工具调用 (可并行)
    }
```

**优化**: `Promise.all` 并行化 capabilities 加载

### 8.3 内存峰值

| 场景 | 峰值来源 | 优化 |
|------|----------|------|
| 大文档解析 | 全量加载到内存 | 流式解析 (`parseStream`) |
| 长对话 | messages 数组无限增长 | 压缩策略 (Cicada) |
| 多文档检索 | chunks 缓存 | LRU 淘汰 |

---

## 九、架构演进路线图

### 阶段一：技术债清理（2 周）
- [ ] P0.1 工具函数收敛
- [ ] P0.2 import alias
- [ ] 静默 catch 审查

### 阶段二：核心重构（1 月）
- [ ] DI 容器引入
- [ ] 状态管理统一到 StateEngine
- [ ] 取消机制补全

### 阶段三：性能优化（持续）
- [ ] 热路径 profiling
- [ ] 并发控制器
- [ ] 增量序列化

### 阶段四：类型安全（长期）
- [ ] sdk/ 类型定义
- [ ] runtime/core/ TypeScript 迁移
- [ ] 全量迁移

---

## 十、微内核架构分析

### 10.1 当前架构评估

**微内核架构的核心原则**:
1. 最小化内核（只含调度、IPC、内存管理）
2. 服务通过消息传递通信
3. 服务可热插拔
4. 故障隔离

**当前实现 vs 理想微内核**:

| 维度 | 理想微内核 | 当前实现 | 评分 |
|------|-----------|----------|------|
| 内核大小 | <500 行 | 5610 行 (runtime/core) | 🔴 2/10 |
| 服务通信 | 纯消息传递 | 直接方法调用 + EventBus | 🟡 5/10 |
| 插件机制 | 统一接口 | ToolRegistry + MiddlewareChain | 🟡 6/10 |
| 热插拔 | 运行时替换 | 仅启动时注入 | 🔴 3/10 |
| 故障隔离 | 服务崩溃不影响内核 | 共享内存，无隔离 | 🔴 2/10 |

---

### 10.2 内核臃肿问题

**当前 runtime/core/ 包含**:
```
agent-loop.js       732 行  ← 应拆分
shared-memory.js    579 行  ← 底层，可保留
scheduler.js        563 行  ← 应外移到 services/
worker-rpc.js       354 行  ← 底层，可保留
error-boundary.js   313 行  ← 应外移
config-validator.js 308 行  ← 应外移
worker-pool.js      306 行  ← 底层，可保留
message-manager.js  299 行  ← 应外移
...
总计: 5610 行
```

**理想内核应只包含**:
```
micro-kernel.js     ~300 行
├── Scheduler       # 任务调度
├── MessageBus      # IPC（EventBus 精简版）
├── ServiceRegistry # 服务注册/发现
└── MemoryManager   # SharedArrayBuffer 管理
```

---

### 10.3 服务通信问题

**现状**: 直接方法调用 + EventBus 混用

```js
// ❌ 紧耦合：直接调用
const result = await modelRouter.call(messages);
await memoryStore.addMessage(message);
this.checkpoint.save(state);

// ❌ EventBus 仅用于通知，非 RPC
eventBus.emit('deepsearch.progress', { ... });
```

**问题**:
- 服务间硬依赖
- 无法独立测试
- 无法跨进程/Worker 通信

**建议**: 引入 Request-Response 消息模式
```js
// ✅ 消息驱动
const result = await kernel.request('llm.call', { messages });
await kernel.request('memory.addMessage', { message });

// 内核路由消息到对应服务
kernel.registerService('llm', llmService);
kernel.registerService('memory', memoryService);
```

---

### 10.4 插件机制不完整

**已有**:
- `ToolRegistry`: 工具注册 ✅
- `MiddlewareChain`: 中间件 ✅
- `RuntimeAdapter`: 运行时适配器 ✅
- `McpProvider`: MCP 适配器 ✅

**缺失**:
- 统一的 `ServiceProvider` 接口
- 服务生命周期管理 (init/start/stop/destroy)
- 服务依赖声明和自动注入
- 服务版本和兼容性检查

**建议**:
```js
// 统一 ServiceProvider 接口
interface ServiceProvider {
  id: string;
  version: string;
  dependencies: string[];  // 依赖的其他服务

  async initialize(kernel): void;
  async start(): void;
  async stop(): void;
  async destroy(): void;

  // 消息处理
  async handleRequest(type, payload): any;
}

// 使用
kernel.register(new LlmServiceProvider());
kernel.register(new MemoryServiceProvider());
await kernel.startAll(); // 按依赖顺序启动
```

---

### 10.5 故障隔离缺失

**现状**:
- 所有服务共享主线程
- 一个服务崩溃影响全局
- 无熔断隔离

**证据**:
```js
// stages/deepsearch/ 直接 new 核心组件
new MemoryStore({ ... })  // 崩溃影响整个 AgentLoop
new EventBus()            // 无隔离
```

**建议**: Worker 隔离关键服务
```
┌────────────────────────────────────────────┐
│              Main Thread                    │
│  ┌──────────────────────────────────────┐  │
│  │ Micro-Kernel (Scheduler + MessageBus)│  │
│  └──────────────────────────────────────┘  │
│     │             │              │         │
│     ▼             ▼              ▼         │
│  ┌──────┐    ┌──────┐      ┌──────────┐   │
│  │Worker│    │Worker│      │  Worker  │   │
│  │ LLM  │    │Memory│      │ Ingest   │   │
│  └──────┘    └──────┘      └──────────┘   │
└────────────────────────────────────────────┘
```

---

### 10.6 全局状态问题

**当前全局单例**:
```js
getGlobalTokenCounter()   // 全局 Token 计数器
getGlobalTokenTracker()   // 全局 Token 追踪器
globalSubagentRegistry    // 全局子代理注册表
_cached (capabilities)    // 模块级缓存
```

**问题**:
- 测试时难以隔离
- 多实例场景冲突
- 隐式依赖

**建议**: 通过 Kernel 注入
```js
// ❌ 全局单例
const counter = getGlobalTokenCounter();

// ✅ 从 Kernel 获取
const counter = kernel.getService('tokenCounter');
```

---

### 10.7 配置分散

**当前 constants.js 分布**:
```
ingest/constants.js
llm/constants.js
mcp/constants.js
runtime/core/constants.js
stages/deepsearch/constants.js
stages/design/constants.js
stages/textprep/constants.js
```

**问题**:
- 同名常量可能不一致
- 运行时无法修改
- 无环境差异化

**建议**: 统一配置中心
```js
// config/index.js
export const config = {
  llm: {
    defaultModel: 'gpt-4',
    maxRetries: 3,
  },
  memory: {
    maxMessages: 100,
    compressThreshold: 0.8,
  },
  // ...
};

// 支持环境覆盖
config.llm.maxRetries = process.env.LLM_MAX_RETRIES || config.llm.maxRetries;

// 运行时修改
kernel.updateConfig('llm.maxRetries', 5);
```

---

### 10.8 Capability Loader 反模式

**现状**: `capabilities-loader.js` 串行加载 8 个模块

```js
const capabilities = {
  SkillsManager: null,
  BudgetManager: null,
  CheckpointManager: null,
  // ... 8 个
};

try { capabilities.SkillsManager = (await import(...)).SkillsManager; } catch {}
try { capabilities.BudgetManager = (await import(...)).BudgetManager; } catch {}
// ... 串行 8 次
```

**问题**:
- 启动慢（串行 import）
- 静默吞错
- 非标准 DI

**建议**: 声明式依赖 + 并行加载
```js
// 声明式
DeepSearchAgentLoop.dependencies = [
  'skills:optional',
  'budget:required',
  'checkpoint:optional',
];

// Kernel 并行加载
const deps = await kernel.resolveDependencies(DeepSearchAgentLoop.dependencies);
```

---

### 10.9 消息格式不统一

**当前事件格式**:
```js
// 有的带 payload
eventBus.emit('deepsearch.progress', { percent: 50 });

// 有的带 status
eventBus.emit('run.completed', { status: 'success' });

// 有的带 actor
eventBus.emit('stage.failed', { actor: 'deepsearch', error: ... });
```

**问题**:
- 订阅者需要猜测格式
- 无 schema 验证

**建议**: 统一消息信封
```js
interface Message {
  id: string;           // 唯一 ID
  type: string;         // 消息类型
  source: string;       // 发送者
  target?: string;      // 接收者 (null = 广播)
  timestamp: number;    // Lamport 时钟
  payload: any;         // 业务数据
  correlationId?: string; // 关联请求 ID (RPC)
}
```

---

### 10.10 微内核重构路线图

**阶段一：提取最小内核 (1 周)**
```
runtime/kernel/
├── index.js            # 入口
├── scheduler.js        # 任务调度 (~100 行)
├── message-bus.js      # 消息总线 (~150 行)
├── service-registry.js # 服务注册 (~100 行)
└── types.js            # 类型定义
```

**阶段二：服务化改造 (2 周)**
- 将 MemoryStore 改造为 MemoryService
- 将 ModelRouter 改造为 LlmService
- 通过 MessageBus 通信

**阶段三：Worker 隔离 (2 周)**
- LlmService → Worker
- IngestService → Worker
- 主线程只保留 Kernel + UI 交互

**阶段四：热插拔 (持续)**
- 服务版本管理
- 运行时服务替换
- 灰度发布支持

---

## 十一、下一步行动

1. **立即**: P0.1 工具函数收敛（grep + 批量替换）
2. **本周**: 静默 catch 审查 + 添加日志
3. **下周**:
   - P1.1 设计 DI 容器 API
   - 提取最小内核原型 (runtime/kernel/)
4. **持续**:
   - 热路径性能监控
   - 服务化改造
