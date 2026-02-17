# WebRuntime / Contracts / Sandbox 架构分析

> 分析日期: 2026-02-17 | 分支: feat-pptgen1 | 关联: docs/agents-code-audit.md #38 #39

## 背景

`agents-code-audit.md` 将 Contracts (~2338 行) 和 WebRuntime (~1583 行) 标记为"死代码"（P2 #38、#39）。经深入追踪真实消费链后，结论需修正：**这两个模块不是死代码，而是解耦后未完成回接的架构预留层**。

---

## 一、Contracts 层分析

**路径**: `js/agents/core/contracts/`
**规模**: 11 文件, 2338 行

### 活跃组件（有真实消费者）

| 文件 | 行数 | 消费者 |
|------|------|--------|
| `tool-result.js` | 122 | `runtime/core/tool-registry.js:453,480,502,537,562,581`<br>`mcp/mcp-nexus-provider.js:689,712,728` |
| `disposable.js` | 155 | `shared/base/disposable-base.js:52` |
| `rpc-message.js` | 93 | `runtime/core/worker-rpc.js` |
| `llm-response.js` | 117 | 内部调用 `validateToolCall()` |

**小计**: ~487 行活跃代码

### 休眠组件（contracts-first 预建）

| 文件 | 行数 | 设计用途 |
|------|------|----------|
| `agent-registry.js` | 265 | 多 Agent 注册/发现/心跳 |
| `agent-coordinator.js` | 254 | Leader 选举/任务分配 |
| `agent-message.js` | 502 | Agent 间通信协议 (task-request/result, status-update, knowledge-share) |
| `shared-task-board.js` | 308 | 原子 claim 语义的共享任务板 |
| `taskboard-orchestrator-bridge.js` | 220 | TaskBoard ↔ Orchestrator 桥接 |
| `trace-propagator.js` | 252 | W3C traceparent 分布式追踪 |

**小计**: ~1801 行休眠基础设施

### 评估

这是 **contracts-first 架构模式**：先定义协议边界，实现随后跟进。对微内核系统来说是正确的做法。这些休眠组件为以下场景预建：

- 多 Agent 并发编排（AgentRegistry + AgentCoordinator）
- 分布式任务分配（SharedTaskBoard + Bridge）
- 跨 Agent 可观测性（TraceContextPropagator）

**结论**: 非缺陷，属架构预留。保留不动。

---

## 二、WebRuntime 层分析

**路径**: `js/agents/core/webruntime/`
**规模**: 9 组件, ~1583 行

### 活跃组件（有真实消费者）

| 文件 | 行数 | 消费者 |
|------|------|--------|
| `server-bridge.js` | ~180 | `sdk/http/browser-server.js:47` — `createServerBridge({ scope })` |
| `vfs-events.js` | ~145 | `core/node-compat/create-node-env.js:65` — `withVfsEvents(rawVfs)` |

**小计**: ~325 行活跃代码

### 休眠组件（解耦待回接）

| 文件 | 行数 | 设计用途 | 现状 |
|------|------|----------|------|
| `dev-server.js` | 158 | VFS 驱动的虚拟 HTTP 服务器 | 前瞻预建，当前无消费场景 |
| `hmr.js` | 516 | 模块热更新 (accept/dispose/invalidate) | 前瞻预建，开发时功能 |
| `sandbox-deploy.js` | ~120 | CSP header + SW 脚本生成 | **应被 sandbox 层消费** |
| `worker-comlink.js` | 112 | 零依赖 Comlink 风格 Worker RPC | 与 `runtime/core/worker-rpc.js` 功能重叠 |
| `sw-handler.js` | ~110 | Service Worker fetch 拦截 | 前瞻预建 |
| `vfs-snapshot.js` | 140 | VFS 状态序列化/diff | 与 `core/archive/archive-core.js` 功能重叠 |

**小计**: ~1258 行休眠/重叠代码

---

## 三、Sandbox ↔ WebRuntime 解耦分析

### 问题根源

Sandbox 层有两条执行路径：

```
sandbox/
├── Node 路径: node-compat/ → 直接用 Node 原生能力 (fs, child_process, vm)
└── Web 路径: webruntime/ → 浏览器沙箱 (iframe, SW, Worker, CSP)
```

解耦时 WebRuntime 被拆为独立模块，但 Sandbox 的 Web 路径实现没有回来消费 WebRuntime 的抽象，保留了内联实现。这导致两套代码做同一件事：

| Sandbox 文件 | 内联实现 | 对应的 WebRuntime 抽象 |
|---|---|---|
| `iframe-eval-bridge.js` | Blob iframe，**无 CSP** | `generateCspHeader()` + `generateSandboxFiles()` |
| `create-sandbox.js` (Worker 分支) | 手写 postMessage 协议 | `wrapWorker()` + `exposeApi()` |

### 安全隐患

`iframe-eval-bridge.js` 创建 iframe 时使用 `sandbox="allow-scripts"` 但**没有 Content-Security-Policy**。`generateCspHeader()` 正是为此设计的，但从未被接入。

### 修改范围约束

**仅限 Web 路径**。Node 路径（`wasm-sandbox.js` 的 QuickJS VM、`create-node-env.js`）使用 VM 级别的 host function 注入，与浏览器 SW 级别的 `installFetchHandler` 是不同层面的抽象，不应混用。

---

## 四、功能重叠分析

### 存在更优实现的组件

| WebRuntime 组件 | 行数 | 已有替代 | 替代优势 |
|---|---|---|---|
| `worker-comlink.js` | 112 | `runtime/core/worker-rpc.js` | AbortSignal、Transferable 零拷贝、崩溃重建 |
| `vfs-snapshot.js` | 140 | `core/archive/archive-core.js` | JSON Patch diff；`vfs-sync-protocol.js` delta sync |
| `uint8ToBase64`/`base64ToUint8` | ~40 | `ingest/asset-manager.js` | 分块优化；`node-compat/shims/buffer.js` 多编码 |

### 关于 shared/ 的边界

**并非所有相似功能都应提取到 `shared/`**。判断标准：

- **提取到 shared/**：真正跨层使用的公共工具（如 `withTimeout`、`shouldDegrade`、`withRetry`）
- **保留在层内**：服务于特定上下文的层内抽象

示例：

| 功能 | 归属 | 理由 |
|------|------|------|
| `uint8ToBase64` (vfs-snapshot) | WebRuntime 层 | 为 VFS 快照的浏览器安全序列化设计 |
| `base64ToBytes` (asset-manager) | Ingest 层 | 为文件摄取的格式转换设计 |
| `generateCspHeader` | WebRuntime 层 | 浏览器沙箱特有的安全策略 |
| `wrapWorker` | WebRuntime 层 | 对浏览器 Worker 的封装 |

它们看起来相似但**服务于不同上下文**，合并到 `shared/` 会破坏层间内聚性。

---

## 五、建议操作

### 短期（安全收益）

| 优先级 | 操作 | 文件 |
|--------|------|------|
| P1 | 将 `generateCspHeader()` 接入 `iframe-eval-bridge.js` | `webruntime/sandbox-deploy.js` → `sandbox/iframe-eval-bridge.js` |

### 中期（代码整洁度）

| 优先级 | 操作 | 说明 |
|--------|------|------|
| P2 | 完善 Sandbox Web 路径 ↔ WebRuntime 接线 | Worker RPC、fetch handler |
| P2 | 评估 `worker-comlink.js` 是否可废弃 | `worker-rpc.js` 已覆盖且更强 |
| P2 | 评估 `vfs-snapshot.js` 是否可废弃 | `archive-core.js` + `vfs-sync-protocol.js` 已覆盖 |

### 长期（功能接入）

| 优先级 | 操作 | 触发条件 |
|--------|------|----------|
| P3 | DevServer 接入 PPT 预览 | 需要浏览器内 VFS→HTTP 文件服务时 |
| P3 | HmrClient 接入开发模式 | 需要编辑器实时预览刷新时 |
| P3 | Contracts 多 Agent 编排接入 | 启用多 Agent 并发编排时 |
| P3 | TraceContextPropagator 接入遥测 | 需要跨 Agent 分布式追踪时 |

---

## 六、审计报告修正

`docs/agents-code-audit.md` 中以下条目应更新状态：

| # | 原描述 | 原分类 | 修正分类 |
|---|--------|--------|----------|
| 38 | contracts 协议栈 ~1300 行死代码 | P2 技术债务 | **架构预留** — contracts-first 模式，非缺陷 |
| 39 | webruntime 模块 8/9 组件零消费者 | P2 技术债务 | **解耦待回接** — 2 组件活跃，3 组件待接入 sandbox，2 组件有更优替代，2 组件前瞻预建 |
| 55 | HMR 不做实际模块重新求值 | P2 技术债务 | **前瞻预建** — 待 HmrClient 接入时一并修复 |

---

## 七、参考

- `js/agents/core/webruntime/` — WebRuntime 源码
- `js/agents/core/contracts/` — Contracts 源码
- `js/agents/core/sandbox/` — Sandbox 源码（Web + Node 双路径）
- `js/agents/core/node-compat/` — Node 兼容层
- `ref/` — almostnode 参考实现
- `docs/agents-code-audit.md` — 原始审计报告
