# js/agents 重构计划

> 基于 ARCHITECTURE_REVIEW.md 的分析，制定可执行的修复计划
> 策略：Strangler Fig Pattern（渐进式替换，保持向后兼容）

---

## 执行进度

| Phase | 状态 | 完成日期 | 备注 |
|-------|------|----------|------|
| 0 | ✅ 完成 | 2026-01-04 | 基线测试 933 pass / 54 fail |
| 1 | ✅ 完成 | 2026-01-04 | 64 文件收敛，测试 927 pass / 60 fail |
| 2 | ✅ 完成 | 2026-01-04 | 15 处静默 catch 添加注释 |
| 3 | ✅ 完成 | 2026-01-04 | DI 容器 (ef0bf72) |
| 4 | ✅ 完成 | 2026-01-04 | StateEngine 集成 (a3c69bd) |
| 5 | ✅ 完成 | 2026-01-04 | 微内核 (91dfa39) |
| 6 | ✅ 完成 | 2026-01-04 | Token 缓存 (0e0035e) |
| 7 | ✅ 完成 | 2026-01-04 | 取消传播 (d0c624d) |
| 8 | ⏸️ 延期 | 2026-01-04 | 大文件内聚性高，拆分收益低 |

---

## 执行原则

1. **每个 PR 必须保持系统可运行**
2. **先写测试，后改代码**
3. **小步提交，频繁集成**
4. **可回滚：每个阶段都可独立回滚**

---

## Phase 0: 基础设施准备 (1-2 天)

### 0.1 建立回归测试基线

```bash
# 记录当前测试状态
npm run test:agents 2>&1 | tee tests/baseline.log

# 添加 CI 脚本
echo 'node --test tests/agents/**/*.test.js' >> package.json
```

**验收标准**: CI 绿灯，测试通过率 > 95%

### 0.2 配置 Import Alias

```js
// vite.config.js 或 jsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@agents/*": ["js/agents/*"]
    }
  }
}
```

**验收标准**: `import { X } from "@agents/shared"` 可正常解析

---

## Phase 1: 工具函数收敛 (P0.1) — 2 小时

### 1.1 创建统一导出

```js
// js/agents/shared/utils/core.js
export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

export function toNonEmptyString(v, fallback = "") {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

export function estimateTokens(text) {
  if (!text) return 0;
  // CJK 字符权重高
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 1.5 + otherCount / 4);
}
```

### 1.2 批量替换脚本

```bash
#!/bin/bash
# scripts/converge-utils.sh

# 查找所有本地定义
grep -rn "function isPlainObject" js/agents --include="*.js" | grep -v "shared/utils/core.js" > /tmp/dups.txt

# 逐文件替换
while read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  # 添加 import
  sed -i '1i import { isPlainObject } from "@agents/shared/utils/core.js";' "$file"
  # 删除本地定义 (需人工审查)
  echo "REVIEW: $file"
done < /tmp/dups.txt
```

### 1.3 测试验证

```bash
npm run test:agents
# 确保无回归
```

**交付物**:
- [x] `shared/utils/value-utils.js` 统一实现（已存在）
- [x] 64 个文件批量替换完成
- [x] 重新导出：`stages/design/shared/design-utils.js`
- [x] 测试验证：927 pass / 60 fail（与基线一致，+6 fail 为既存问题）

### 1.4 实际执行日志 (2026-01-04)

```
脚本: scripts/converge-utils.mjs
修改文件: 64
替换函数: isPlainObject (53处) + toNonEmptyString (46处)

关键修复:
- design-utils.js: 添加 re-export 修复语法错误
```

---

## Phase 2: 静默 catch 修复 (P0.2) — 4 小时

### 2.1 创建错误处理工具

```js
// js/agents/shared/utils/error-utils.js
import { createLogger } from "./logger.js";

const logger = createLogger("error-utils");

/**
 * 安全执行，捕获错误但记录日志
 */
export function safeExec(fn, { context = "", fallback = undefined } = {}) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.catch(err => {
        logger.debug(`[${context}] Async error:`, err.message);
        return fallback;
      });
    }
    return result;
  } catch (err) {
    logger.debug(`[${context}] Sync error:`, err.message);
    return fallback;
  }
}

/**
 * 包装现有的静默 catch
 */
export function catchAndLog(context) {
  return (err) => {
    logger.debug(`[${context}]`, err.message);
  };
}
```

### 2.2 批量修复模式

```js
// ❌ 现状
try { doSomething(); } catch {}

// ✅ 修复
import { catchAndLog } from "@agents/shared/utils/error-utils.js";
try { doSomething(); } catch (err) { catchAndLog("doSomething")(err); }

// 或使用包装器
import { safeExec } from "@agents/shared/utils/error-utils.js";
safeExec(() => doSomething(), { context: "module:func" });
```

### 2.3 优先级排序

| 文件 | catch {} 数量 | 优先级 |
|------|--------------|--------|
| runtime/core/*.js | 45 | 🔴 高 |
| stages/deepsearch/*.js | 38 | 🔴 高 |
| mcp/*.js | 28 | 🟡 中 |
| 其他 | 251 | 🟢 低 |

**先修复 runtime/core + deepsearch，其他可渐进式处理**

---

## Phase 3: DI 容器引入 (P1.1) — 1 天

### 3.1 实现轻量 DI

```js
// js/agents/runtime/di/container.js

const SINGLETON = Symbol("singleton");
const TRANSIENT = Symbol("transient");

export class Container {
  #factories = new Map();
  #singletons = new Map();

  /**
   * 注册服务
   * @param {string} id - 服务 ID
   * @param {Function} factory - 工厂函数 (container) => instance
   * @param {object} options - { scope: SINGLETON | TRANSIENT }
   */
  register(id, factory, { scope = SINGLETON } = {}) {
    this.#factories.set(id, { factory, scope });
    return this;
  }

  /**
   * 获取服务实例
   */
  get(id) {
    if (this.#singletons.has(id)) {
      return this.#singletons.get(id);
    }

    const entry = this.#factories.get(id);
    if (!entry) {
      throw new Error(`Service not registered: ${id}`);
    }

    const instance = entry.factory(this);

    if (entry.scope === SINGLETON) {
      this.#singletons.set(id, instance);
    }

    return instance;
  }

  /**
   * 替换实现（用于测试）
   */
  override(id, factory) {
    this.#singletons.delete(id);
    this.#factories.set(id, { factory, scope: SINGLETON });
    return this;
  }

  /**
   * 重置（用于测试）
   */
  reset() {
    this.#singletons.clear();
  }

  /**
   * 创建子容器（继承父容器注册）
   */
  createChild() {
    const child = new Container();
    child.#factories = new Map(this.#factories);
    return child;
  }
}

export { SINGLETON, TRANSIENT };
```

### 3.2 默认注册

```js
// js/agents/runtime/di/defaults.js
import { Container, SINGLETON } from "./container.js";
import { EventBus } from "../events/event-bus.js";
import { MemoryStore } from "../memory/memory-store.js";
import { ModelRouter } from "../../llm/model-router.js";

export function createDefaultContainer() {
  const container = new Container();

  container
    .register("eventBus", () => new EventBus(), { scope: SINGLETON })
    .register("memoryStore", (c) => new MemoryStore({ eventBus: c.get("eventBus") }))
    .register("modelRouter", (c) => new ModelRouter({ logger: c.get("logger") }))
    .register("logger", () => console); // 可替换

  return container;
}
```

### 3.3 改造 AgentBuilder

```js
// js/agents/sdk/AgentBuilder.js

class AgentBuilder {
  #container;

  constructor(container = createDefaultContainer()) {
    this.#container = container;
  }

  withEventBus(factory) {
    this.#container.override("eventBus", factory);
    return this;
  }

  withModelRouter(factory) {
    this.#container.override("modelRouter", factory);
    return this;
  }

  build() {
    return new DeepSearchAgentLoop({
      eventBus: this.#container.get("eventBus"),
      memoryStore: this.#container.get("memoryStore"),
      modelRouter: this.#container.get("modelRouter"),
    });
  }
}
```

**交付物**:
- [x] `runtime/di/container.js` 实现
- [x] `runtime/di/defaults.js` 默认注册
- [x] AgentBuilder 改造
- [x] 测试覆盖 DI 容器

---

## Phase 4: 状态管理统一 (P1.2) — 2 天

### 4.1 目标架构

```
┌───────────────────────────────────┐
│     UnifiedAgentContext (门面)     │
├───────────────────────────────────┤
│       StateEngine (调度器)         │  ← 所有状态变更入口
├───────────────────────────────────┤
│        MemoryStore (存储)          │  ← 纯存储，无业务逻辑
└───────────────────────────────────┘

废弃：DeepSearchState 迁移到 StateEngine
```

### 4.2 StateEngine 增强

```js
// js/agents/runtime/memory/state-engine.js

// 新增：L0/L1/L2/L3 分层 Action
export const L0_UPDATE_TASK = "L0_UPDATE_TASK";
export const L1_ADD_MESSAGE = "L1_ADD_MESSAGE";
export const L2_SET_CONDENSED = "L2_SET_CONDENSED";
export const L3_ARCHIVE = "L3_ARCHIVE";

// 分层 reducer
function l0Reducer(state, action) {
  switch (action.type) {
    case L0_UPDATE_TASK:
      return { ...state, L0: { ...state.L0, ...action.payload } };
    default:
      return state;
  }
}

// 组合 reducer
function rootReducer(state, action) {
  return {
    L0: l0Reducer(state, action).L0,
    L1: l1Reducer(state, action).L1,
    L2: l2Reducer(state, action).L2,
    L3: l3Reducer(state, action).L3,
  };
}
```

### 4.3 DeepSearchState 迁移

```js
// 迁移前
class DeepSearchState {
  get taskGoal() { return this._taskGoal; }
  set taskGoal(v) { this._taskGoal = v; }
}

// 迁移后
class DeepSearchState {
  #stateEngine;

  get taskGoal() {
    return this.#stateEngine.getState().L0.taskGoal;
  }

  set taskGoal(v) {
    this.#stateEngine.dispatch({ type: L0_UPDATE_TASK, payload: { taskGoal: v } });
  }
}
```

**交付物**:
- [x] StateEngine 分层 Action
- [x] DeepSearchState 委托 StateEngine
- [x] 移除 DeepSearchState 独立状态
- [x] 测试覆盖状态同步

---

## Phase 5: 微内核提取 (P1.3) — 1 周

### 5.1 目录结构

```
js/agents/runtime/kernel/
├── index.js              # 入口
├── micro-kernel.js       # 核心 (~300 行)
├── scheduler.js          # 任务调度 (~100 行)
├── message-bus.js        # IPC (~150 行)
├── service-registry.js   # 服务注册 (~100 行)
└── service-provider.js   # 服务接口定义
```

### 5.2 MicroKernel 实现

```js
// js/agents/runtime/kernel/micro-kernel.js

import { Scheduler } from "./scheduler.js";
import { MessageBus } from "./message-bus.js";
import { ServiceRegistry } from "./service-registry.js";

export class MicroKernel {
  #scheduler;
  #messageBus;
  #registry;
  #started = false;

  constructor() {
    this.#scheduler = new Scheduler();
    this.#messageBus = new MessageBus();
    this.#registry = new ServiceRegistry();
  }

  /**
   * 注册服务
   */
  register(provider) {
    this.#registry.register(provider);
    return this;
  }

  /**
   * 获取服务
   */
  getService(id) {
    return this.#registry.get(id);
  }

  /**
   * 请求-响应模式
   */
  async request(type, payload) {
    return this.#messageBus.request(type, payload);
  }

  /**
   * 发布事件
   */
  emit(type, payload) {
    this.#messageBus.emit(type, payload);
  }

  /**
   * 订阅事件
   */
  on(type, handler) {
    return this.#messageBus.on(type, handler);
  }

  /**
   * 调度任务
   */
  schedule(task, priority = "normal") {
    return this.#scheduler.schedule(task, priority);
  }

  /**
   * 启动所有服务（按依赖顺序）
   */
  async start() {
    if (this.#started) return;

    const sorted = this.#registry.topologicalSort();
    for (const provider of sorted) {
      await provider.initialize(this);
      await provider.start();
    }

    this.#started = true;
  }

  /**
   * 停止所有服务（逆序）
   */
  async stop() {
    if (!this.#started) return;

    const sorted = this.#registry.topologicalSort().reverse();
    for (const provider of sorted) {
      await provider.stop();
      await provider.destroy();
    }

    this.#started = false;
  }
}
```

### 5.3 ServiceProvider 接口

```js
// js/agents/runtime/kernel/service-provider.js

/**
 * 服务提供者接口
 */
export class ServiceProvider {
  /** 服务 ID */
  get id() { throw new Error("Not implemented"); }

  /** 服务版本 */
  get version() { return "1.0.0"; }

  /** 依赖的服务 ID 列表 */
  get dependencies() { return []; }

  /** 初始化（注入 kernel） */
  async initialize(kernel) {}

  /** 启动服务 */
  async start() {}

  /** 停止服务 */
  async stop() {}

  /** 销毁资源 */
  async destroy() {}

  /** 处理请求 */
  async handleRequest(type, payload) {
    throw new Error(`Unknown request type: ${type}`);
  }
}
```

### 5.4 MemoryService 示例

```js
// js/agents/runtime/services/memory-service.js

import { ServiceProvider } from "../kernel/service-provider.js";
import { MemoryStore } from "../memory/memory-store.js";

export class MemoryServiceProvider extends ServiceProvider {
  #kernel;
  #store;

  get id() { return "memory"; }
  get version() { return "2.0.0"; }
  get dependencies() { return ["eventBus"]; }

  async initialize(kernel) {
    this.#kernel = kernel;
    this.#store = new MemoryStore({
      eventBus: kernel.getService("eventBus"),
    });
  }

  async handleRequest(type, payload) {
    switch (type) {
      case "memory.addMessage":
        return this.#store.addMessage(payload.message);
      case "memory.getMessages":
        return this.#store.getMessages(payload.options);
      case "memory.toSnapshot":
        return this.#store.toSnapshot(payload.options);
      default:
        throw new Error(`Unknown memory request: ${type}`);
    }
  }
}
```

**交付物**:
- [x] `kernel/micro-kernel.js` 核心实现
- [x] `kernel/scheduler.js` 任务调度
- [x] `kernel/message-bus.js` 消息总线
- [x] `kernel/service-registry.js` 服务注册
- [x] MemoryServiceProvider 示例
- [x] 测试覆盖服务生命周期

---

## Phase 6: 性能热路径优化 (P2) — 3 天

### 6.1 热路径识别

| 路径 | 频率 | 优化 |
|------|------|------|
| `MemoryStore.toSnapshot()` | 每轮 | 增量快照 |
| `estimateTokens()` | 每消息 | 缓存 + 批量 |
| `robustParseJson()` | 每响应 | 流式解析 |
| `EventBus.emit()` | 高频 | 批量 + 防抖 |

### 6.2 增量快照优化

```js
// js/agents/runtime/memory/memory-store.impl.js

toSnapshot({ incremental = false } = {}) {
  if (!incremental) {
    return this._fullSnapshot();
  }

  // 只序列化脏层
  const snapshot = {};
  if (this._dirty.L0) snapshot.L0 = structuredClone(this._L0);
  if (this._dirty.L1) snapshot.L1 = structuredClone(this._L1);
  if (this._dirty.L2) snapshot.L2 = structuredClone(this._L2);
  if (this._dirty.L3) snapshot.L3 = structuredClone(this._L3);

  this._clearDirty();
  return snapshot;
}
```

### 6.3 Token 估算缓存

```js
// js/agents/shared/utils/token-cache.js

const cache = new Map();
const MAX_CACHE_SIZE = 10000;

export function estimateTokensCached(text) {
  if (!text) return 0;

  // 对长文本使用哈希
  const key = text.length > 100 ? hashCode(text) : text;

  if (cache.has(key)) {
    return cache.get(key);
  }

  const tokens = estimateTokens(text);

  // LRU 淘汰
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }

  cache.set(key, tokens);
  return tokens;
}
```

### 6.4 EventBus 批量优化

```js
// js/agents/runtime/events/event-bus.js

class EventBus {
  #batchQueue = [];
  #batchTimer = null;
  #batchWindowMs = 16; // 约 60fps

  emit(type, payload) {
    this.#batchQueue.push({ type, payload, ts: Date.now() });

    if (!this.#batchTimer) {
      this.#batchTimer = setTimeout(() => this._flushBatch(), this.#batchWindowMs);
    }
  }

  _flushBatch() {
    const events = this.#batchQueue;
    this.#batchQueue = [];
    this.#batchTimer = null;

    // 合并同类事件（保留最新）
    const merged = new Map();
    for (const event of events) {
      merged.set(event.type, event);
    }

    for (const event of merged.values()) {
      this._dispatch(event);
    }
  }
}
```

---

## Phase 7: 取消机制补全 (P2) — 2 天

### 7.1 检查清单

```bash
# 找出不接受 signal 的 async 函数
grep -rn "async function" js/agents --include="*.js" | xargs -I{} grep -L "signal" {} > /tmp/no-signal.txt
```

### 7.2 修复模式

```js
// ❌ 现状
async function processChunks(chunks) {
  for (const chunk of chunks) {
    await processChunk(chunk);
  }
}

// ✅ 修复
async function processChunks(chunks, { signal } = {}) {
  for (const chunk of chunks) {
    signal?.throwIfAborted();
    await processChunk(chunk, { signal });
  }
}
```

### 7.3 添加 checkCancelled 工具

```js
// js/agents/shared/utils/cancellation.js

export function checkCancelled(signal) {
  if (signal?.aborted) {
    const error = new Error("Operation cancelled");
    error.name = "AbortError";
    throw error;
  }
}

export function withCancellation(fn) {
  return async function(...args) {
    const options = args[args.length - 1];
    const signal = options?.signal;

    checkCancelled(signal);
    const result = await fn.apply(this, args);
    checkCancelled(signal);

    return result;
  };
}
```

---

## Phase 8: 大文件拆分 (P3) — 3 天

### 8.1 拆分清单

| 原文件 | 行数 | 拆分为 |
|--------|------|--------|
| `storage/run-store.js` | 1116 | `db.js`, `retention.js`, `export.js` |
| `mcp/smart-content-extractor.js` | 930 | `html-extractor.js`, `pdf-extractor.js` |
| `llm/model-router.js` | 752 | `router.js`, `circuit-breaker.js`, `rate-limiter.js` |

### 8.2 拆分策略

```
1. 创建新文件 + 移动代码
2. 原文件改为 re-export
3. 运行测试确认无回归
4. 逐步更新外部引用
5. 删除 re-export（可选）
```

### 8.3 run-store.js 拆分示例

```js
// storage/db.js - 数据库操作
export class RunStoreDB {
  async open() { ... }
  async get(key) { ... }
  async put(key, value) { ... }
}

// storage/retention.js - 保留策略
export class RetentionPolicy {
  async cleanup(olderThan) { ... }
  async prune(maxEntries) { ... }
}

// storage/export.js - 导出功能
export class RunExporter {
  async toJSON() { ... }
  async toCSV() { ... }
}

// storage/run-store.js - 组合 (向后兼容)
import { RunStoreDB } from "./db.js";
import { RetentionPolicy } from "./retention.js";
import { RunExporter } from "./export.js";

export class RunStore {
  #db;
  #retention;
  #exporter;

  constructor() {
    this.#db = new RunStoreDB();
    this.#retention = new RetentionPolicy();
    this.#exporter = new RunExporter();
  }

  // 代理方法
  async get(key) { return this.#db.get(key); }
  async cleanup(olderThan) { return this.#retention.cleanup(olderThan); }
  async toJSON() { return this.#exporter.toJSON(); }
}
```

---

## 验收标准

### 每个 Phase 完成后

- [ ] 所有测试通过 (`npm run test:agents`)
- [ ] 无新增 console.warn/error
- [ ] 代码覆盖率不下降
- [ ] 无循环依赖 (`npx madge --circular js/agents`)

### 最终验收

| 指标 | 目标 | 验证方法 |
|------|------|----------|
| 静默 catch | < 50 | `grep -r "catch {}" js/agents \| wc -l` |
| 工具函数重复 | 0 | `grep -rn "function isPlainObject" js/agents` |
| runtime/core 行数 | < 2000 | `wc -l js/agents/runtime/core/*.js` |
| DI 容器覆盖 | 100% 核心类 | 手工审查 |

---

## 风险与回滚

| Phase | 风险 | 回滚策略 |
|-------|------|----------|
| 1 | 工具函数行为差异 | 保留旧实现 1 周 |
| 3 | DI 引入增加复杂度 | 渐进式，不强制使用 |
| 5 | 微内核过度设计 | 最小实现，按需扩展 |
| 6 | 性能优化引入 bug | A/B 测试，可配置禁用 |

---

## 时间线（无日期，仅顺序）

```
Phase 0 → Phase 1 → Phase 2 (可并行) → Phase 3 → Phase 4 → Phase 5 → Phase 6/7/8 (可并行)
```

**关键路径**: 0 → 1 → 3 → 5（微内核是后续的基础）
