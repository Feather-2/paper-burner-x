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

## 9. 相关文件

- `js/agents/core/sandbox/skill-sandbox.js:298-328` - Node Worker 实现
- `js/agents/core/sandbox/create-sandbox.js:115-116` - 浏览器 Worker 后端的 Node 限制
- `js/agents/core/webruntime/worker-comlink.js` - RPC 通信层
- `js/agents/core/sandbox/index.js:173` - webruntime 导入/重导出

