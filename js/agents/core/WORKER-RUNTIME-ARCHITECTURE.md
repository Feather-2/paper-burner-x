# Worker 运行时架构文档

## 1. 概述

Worker 运行时用于在 Agent 微内核中提供隔离执行能力，核心目标是将不受信任或高风险代码从主线程/主进程中分离，降低执行风险并提升系统稳定性。

在当前实现中，Worker 运行时分为三层：

1. 应用层：面向业务的 Sandbox 实现（Skill 专用与通用沙箱）。
2. 基础设施层：`webruntime` 提供的 Worker 通信、部署与桥接能力。
3. 底层 API：浏览器 `Web Worker` 与 Node.js `worker_threads`。

## 2. 架构层次

### 2.1 应用层（Sandbox 实现）

#### `skill-sandbox.js`

- 关键函数：`executeFallbackInNodeWorker`（`js/agents/core/sandbox/skill-sandbox.js:298-328`）。
- 使用 `node:worker_threads`（动态导入 `Worker`）。
- 提供 Node 侧多线程隔离执行，用于 Skill 回退执行路径。

#### `create-sandbox.js`

- 关键函数：`createWorkerSandbox`。
- Worker 后端仅支持浏览器 `Web Worker`。
- Node 环境显式抛错（`js/agents/core/sandbox/create-sandbox.js:115-116`）。
- 提供四种后端：`wasm` / `iframe` / `worker` / `main`（见 `CREATORS` 路由表）。

### 2.2 基础设施层（webruntime）

#### `worker-comlink.js`（零依赖 RPC 层）

- `wrapWorker()`：主线程侧异步代理封装。
- `exposeApi()`：Worker 侧 API 注册与分发。
- 消息类型：`MSG_CALL`、`MSG_RETURN`、`MSG_CONSOLE`。
- 提供超时处理、错误处理、终止管理。

#### `sandbox-deploy.js`

- CSP 策略包含 `worker-src 'self' blob:`（`js/agents/core/webruntime/sandbox-deploy.js:71`）。
- 提供 Service Worker 脚本生成能力（`generateSwScript`）。

#### `server-bridge.js`

- 提供 Service Worker HTTP 桥接，支持浏览器内虚拟服务请求路由。

#### `worker-pool.js`（Worker 池管理）

- 位置：`js/agents/runtime/core/worker-pool.js`（433 行）
- DI 注册：`js/agents/core/di/defaults.js:305-315`
- 特性：
  - 按需创建 Worker，空闲自动回收（30 秒超时）
  - 最大并发限制（根据 CPU 核心数自动调整，默认是核心数的一半，最小 2，最大 8）
  - 健康检查和自动重启
  - 任务队列和优先级调度（HIGH/NORMAL/LOW）
  - 任务超时控制（默认 60 秒）
  - 优雅关闭（`drain()` 和 `close()`）
  - 统计信息（`stats` 属性：`total`/`busy`/`idle`/`queued`）

### 2.3 底层 API

- `Web Worker`（浏览器）。
- `worker_threads`（Node.js）。

## 3. 架构图

```text
┌─────────────────────────────────────────────────────────┐
│  应用层：Sandbox 实现                                    │
│  ├─ skill-sandbox.js                                    │
│  │   └─ executeFallbackInNodeWorker (Node Worker)      │
│  └─ create-sandbox.js                                   │
│      └─ createWorkerSandbox (浏览器 Worker)             │
└─────────────────────────────────────────────────────────┘
                         ↓ 使用
┌─────────────────────────────────────────────────────────┐
│  基础设施层：webruntime                                  │
│  ├─ worker-comlink.js (RPC 通信层)                      │
│  │   ├─ wrapWorker() - 主线程侧代理                     │
│  │   └─ exposeApi() - Worker 侧 API 注册               │
│  ├─ sandbox-deploy.js (CSP 策略)                        │
│  └─ server-bridge.js (Service Worker 桥接)             │
└─────────────────────────────────────────────────────────┘
                         ↓ 封装
┌─────────────────────────────────────────────────────────┐
│  底层 API                                                │
│  ├─ Web Worker (浏览器)                                 │
│  └─ worker_threads (Node.js)                            │
└─────────────────────────────────────────────────────────┘
```

## 4. 模块职责

### 4.1 `skill-sandbox.js`

- 职责：Skill 执行的 Node 侧隔离。
- 关键函数：`executeFallbackInNodeWorker`。
- 依赖：`node:worker_threads`。

### 4.2 `create-sandbox.js`

- 职责：通用沙箱工厂。
- 支持后端：`wasm`、`iframe`、`worker`、`main`。
- 限制：Worker 后端仅支持浏览器。

### 4.3 `worker-comlink.js`

- 职责：Worker RPC 通信抽象层。
- 核心 API：
  - `wrapWorker(config)`：包装 Worker 为异步代理。
  - `exposeApi(api, self)`：在 Worker 侧注册 API。
- 特性：零依赖、超时控制、错误处理。

### 4.4 `sandbox/index.js`

- `sandbox/index.js` 在 line 173 重导出 `wrapWorker` 和 `exposeApi`（来自 `../webruntime/index.js`）。
- 说明 Sandbox 层直接复用 `webruntime` 提供的通信基础设施，而非重复实现 RPC。

## 5. 数据流

### 5.1 浏览器 Worker 通信流

```text
主线程                    worker-comlink              Worker 线程
  │                            │                          │
  ├─ wrapWorker(worker) ──────>│                          │
  │                            │                          │
  ├─ proxy.execute(code) ──────>│                          │
  │                            ├─ MSG_CALL ──────────────>│
  │                            │                          ├─ exposeApi handlers
  │                            │<─ MSG_RETURN ────────────┤
  │<─ Promise<result> ─────────┤                          │
```

### 5.2 Node Worker 通信流

```text
主线程                    skill-sandbox              Worker 线程
  │                            │                          │
  ├─ executeFallbackInNodeWorker()                        │
  │                            ├─ new Worker(path) ──────>│
  │                            ├─ postMessage ───────────>│
  │                            │                          ├─ 执行代码
  │                            │<─ message ───────────────┤
  │<─ Promise<result> ─────────┤                          │
```

## 6. 使用场景

### 6.1 Skill 沙箱（Node 环境）

- 使用 `skill-sandbox.js` 的 `executeFallbackInNodeWorker`。
- 隔离执行用户 Skill 代码。
- 防止恶意代码影响主进程。

### 6.2 通用沙箱（浏览器环境）

- 使用 `create-sandbox.js` 的 Worker 后端。
- 隔离执行不受信任代码（线程隔离，不等于权限隔离）。
- 可选搭配 `worker-comlink.js` 简化通信。

### 6.3 自定义 Worker 通信

- 直接使用 `webruntime/worker-comlink.js`。
- 适用于需要 RPC 风格通信的场景。
- 零依赖、轻量级。

## 7. 最佳实践

### 7.1 选择合适的 Worker 实现

- Node 环境 + Skill 执行：`skill-sandbox.js`。
- 浏览器环境 + 通用沙箱：`create-sandbox.js`。
- 自定义 Worker 通信：`worker-comlink.js`。

### 7.2 错误处理

- 使用 `worker-comlink.js` 的超时机制。
- 捕获 Worker 终止异常。
- 处理消息传递失败和未知方法错误。

### 7.3 资源管理

- 及时调用 `terminate()` 释放 Worker。
- 避免 Worker 泄漏。
- 监控 Worker 数量与生命周期。

## 8. 关键发现

1. 两个独立的 Worker 实现：
   - `skill-sandbox.js`：Skill 专用，支持 Node Worker。
   - `create-sandbox.js`：通用沙箱，仅支持浏览器 Worker。
2. `webruntime` 是基础设施：
   - 提供 Worker 通信的 RPC 抽象。
   - `sandbox/index.js` 导入并重导出这些工具。
3. 零依赖设计：
   - `worker-comlink.js` 不依赖第三方库。
   - 自实现类 Comlink 的 RPC 层。
4. **Worker Pool 已实现**：
   - `runtime/core/worker-pool.js` 提供完善的 Worker 池管理。
   - 支持动态池管理、优先级调度、空闲回收、优雅关闭。
   - 通过 DI 容器注册，可在整个系统中使用。

## 9. 相关文件

- `js/agents/core/sandbox/skill-sandbox.js:298-328` - Node Worker 实现
- `js/agents/core/sandbox/create-sandbox.js:115-116` - 浏览器 Worker 后端的 Node 限制
- `js/agents/core/webruntime/worker-comlink.js` - RPC 通信层
- `js/agents/core/sandbox/index.js:173` - webruntime 导入/重导出
- `js/agents/runtime/core/worker-pool.js` - Worker 池管理实现
- `js/agents/core/di/defaults.js:305-315` - WorkerPool DI 注册
- `js/agents/core/sandbox/constants.js` - ResourceLimits 定义

## 10. 已知问题与改进建议

### 10.1 资源限制未生效 ✅ 已修复（commit 175cce11）

**问题**：`ResourceLimits` 在 `constants.js` 中定义了三个预设（LIGHT/STANDARD/HEAVY），但 `skill-sandbox.js:332` 创建 Node Worker 时**没有传递** `resourceLimits` 参数。

**影响**：Node Worker 没有内存和 CPU 时间限制，可能导致资源耗尽。

**修复方案**：在创建 Worker 时应用 `resourceLimits`：

```javascript
const worker = new Worker(workerPath, {
  resourceLimits: {
    maxOldGenerationSizeMb: 64,  // 来自 ResourceLimits.STANDARD
    maxYoungGenerationSizeMb: 8,
    codeRangeSizeMb: 8,
  }
});
```

**修复状态**：
- ✅ 已在 `skill-sandbox.js` 中应用 `ResourceLimits.STANDARD`
- ✅ 创建测试验证资源限制生效（`skill-sandbox-resource-limits.test.js`，2/2 通过）
- ✅ 提交：175cce11 fix(agents): 应用 Node Worker 资源限制

### 10.2 通信层不统一 ✅ 已修复（commit 435e1c33）

**问题**：Node 侧和浏览器侧使用不同的通信模式：
- 浏览器侧：使用 `worker-comlink.js` 的完整 RPC 抽象
- Node 侧：使用原生 `postMessage`/`on('message')` 模式

**影响**：增加维护成本，代码不一致。

**修复方案**：统一使用 `worker-comlink.js` 风格的 RPC 通信层，适配 Node.js `worker_threads` 的消息 API。

**修复状态**：
- ✅ 创建 `worker-comlink-node.js` 适配器，统一 Node 和浏览器 Worker 通信
- ✅ 重构 `skill-sandbox.js` 使用 `wrapNodeWorker` 替代原生消息传递
- ✅ 创建测试验证统一通信层（`skill-sandbox-unified-comlink.test.js`，4/4 通过）
- ✅ 提交：435e1c33 feat(agents): 统一 Node 和浏览器 Worker 通信层

### 10.3 测试覆盖补充 ✅ 已完成（commit 4d1eb65e）

**补充内容**：
- ✅ 为 `worker-pool.js` 创建完整测试（`worker-pool.test.js`，10/10 通过）
- ✅ 覆盖池创建、任务执行、优雅关闭、优先级调度、空闲回收、并发限制、超时处理、统计信息
- ✅ 提交：4d1eb65e test(agents): 补充 Worker Pool 完整测试

## 11. 代码审查发现的潜在风险

### 11.1 资源限制绕过风险 ✅ 已修复（ArrayBuffer 外部内存）

**问题**：`resourceLimits` 只限制 V8 堆内存，无法防止大 `ArrayBuffer`（external memory）分配绕过限制。

**修复方案（Option A）**：
- 在 `skill-sandbox.js` 创建 Node Worker 时，额外注入 `workerData.sandboxLimits`。
- 在 `js-sandbox-worker.node.js` 内部包装 `ArrayBuffer` 与常见 TypedArray 构造器，执行前做字节级配额校验：
  - `maxArrayBufferBytes`：单次分配上限
  - `maxTotalArrayBufferBytes`：单次执行累计分配上限
- 超限时抛出 `RangeError` 并返回 `blocked` 结果，审计日志记录 `blockedAllocations`。

**修复结果**：
- ✅ 200MB `ArrayBuffer` 分配不再可绕过（会被 Worker 内部校验拒绝）
- ✅ 新增单测覆盖超大单次分配与累计分配超限路径
- ✅ 保持与现有 `resourceLimits` 兼容，作为第二道防线

### 11.2 Node 版本兼容性问题 ✅ 已修复

**原问题**：`resourceLimits` 不是所有 Node 版本都支持，旧版本会在创建 Worker 时失败。

**修复方案**：
- 在 `skill-sandbox.js` 增加 Node 版本检测（使用 `process.versions.node`）。
- 判定规则：`>= 12.16.0` 才传递 `resourceLimits`。
- 旧版本降级：仅传递 `workerData`，不传 `resourceLimits`，并记录 warning 日志。

**修复状态**：
- ✅ 新增 `supportsNodeWorkerResourceLimits()` 版本检测逻辑。
- ✅ `executeFallbackInNodeWorker()` 已按版本分支创建 Worker。
- ✅ 增加测试覆盖：
  - 支持版本：会应用 `resourceLimits`
  - 不支持版本：不传 `resourceLimits` 且会打 warning
  - 文件：`js/agents/core/sandbox/__tests__/skill-sandbox-resource-limits.test.js`

### 11.3 测试覆盖范围问题 ✅ 已修复

**原问题**：新增测试默认不在 `npm run test:agents` 的执行范围内。

**修复方案**：
- 更新 `package.json` 的 `test:agents` 脚本，保留原有：
  - `tests/unit/agents`
  - `tests/integration/agents`
- 新增 `js/agents` 路径过滤；结合 Vitest include 规则覆盖 co-located 测试：
  - `js/agents/**/__tests__/**/*.test.js`

**修复结果**：
- ✅ `npm run test:agents` 可同时执行目录型测试与 `js/agents/**/__tests__` 下测试
- ✅ 新增修复相关回归测试进入主测试命令范围

### 11.4 事件处理不完整 🟡 中优先级

**问题**：Node 适配层对 `exit` 没有统一处理，依赖调用方额外补生命周期监听。

**证据**：
- 适配层只处理 `message/error`：`worker-comlink-node.js:122`
- RPC 层只消费 `message` frame：`worker-comlink.js:33`

**影响**：
- 当前 `skill-sandbox` 自己补了 `exit/error` 监听，所以当下可用
- 但 `wrapNodeWorker` 作为公共导出时，其他调用点容易踩坑

**建议**：
- 在 `wrapNodeWorker` 中统一处理 `exit` 事件
- 或者在文档中明确说明调用方需要自行处理 `exit` 事件

### 11.5 内存泄漏风险 🟢 低优先级

**问题**：`createWorkerAdapter` 对同一 handler 重复 `addEventListener` 会覆盖 map entry，旧 wrapped listener 可能残留。

**证据**：`worker-comlink-node.js:131`

**影响**：
- 在正常使用场景下不太可能触发
- 但在异常场景下可能导致内存泄漏

**建议**：
- 添加检查，如果 handler 已存在则先移除旧的 listener

### 11.6 测试重复问题 🟢 低优先级

**问题**：WorkerPool 新增测试与已有单测重复度较高，且仍有缺口。

**证据**：
- 新增测试：`js/agents/runtime/core/__tests__/worker-pool.test.js`
- 已有测试：`tests/unit/agents/runtime/core/worker-pool.test.js`

**影响**：
- 测试维护成本增加
- 部分边缘情况仍未覆盖（如 `createWorker` 失败、`drain` 超时强制路径）

**建议**：
- 合并重复的测试
- 补充缺失的边缘情况测试

## 总结

代码审查发现了 5 个潜在风险，其中：
- ✅ 已修复：2 个（Node 版本兼容性、测试覆盖范围）
- 🟡 中优先级：1 个（事件处理不完整）
- 🟢 低优先级：2 个（内存泄漏风险、测试重复）

本次已确认 `npm run test:agents` 纳入 `js/agents/**/__tests__` 覆盖范围。当前剩余风险主要集中在事件处理边界与测试维护成本；另有历史测试失败需独立处理（与覆盖范围修复无关）。
