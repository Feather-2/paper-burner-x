# webruntime - 浏览器运行时

提供浏览器侧沙箱应用运行能力（DevServer/HMR/Service Worker/Worker RPC/VFS 快照与事件桥）。

## 模块拆分

> 自 commit `03d6fab6` 起，原 `sandbox/` 的浏览器运行时能力拆分到 `webruntime/`，与隔离核心、Node 兼容层解耦。

| 模块 | 路径 | 职责 |
|------|------|------|
| **sandbox** | `../sandbox/` | WASM/System 沙箱核心与能力边界 |
| **node-compat** | `../node-compat/` | Node.js 兼容层（require/shims/npm/ToolExecutor） |
| **webruntime** | `./` | 浏览器运行时（DevServer/HMR/SW/Worker/VFS 工具） |

## 架构（DevServer + SW + Worker）

```text
                 ┌──────────────────────────────────┐
                 │            Main Thread            │
                 │                                  │
VFS ───────────► │ DevServer.handleRequest(path)    │
                 │   ├─ MIME 识别                   │
                 │   └─ HMR 事件分发                │
                 │                                  │
                 │ createServerBridge()             │
                 │   └─ 监听 virtual-request        │
                 └──────────────┬───────────────────┘
                                │ postMessage / MessageChannel
                                ▼
                 ┌──────────────────────────────────┐
                 │         Service Worker           │
                 │ installFetchHandler(sw)          │
                 │  - 拦截 /__virtual__/* 请求      │
                 │  - 转发给主线程并回写 Response   │
                 └──────────────┬───────────────────┘
                                │
                                ▼
                       浏览器 fetch 响应链路

Main Thread ◄──────── wrapWorker() RPC ────────► Worker
                MSG_CALL / MSG_RETURN / MSG_CONSOLE
                             exposeApi(api)
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块聚合导出 |
| `dev-server.js` | `DevServer`：VFS 驱动的 HTTP 语义服务（文件分发/MIME/HMR） |
| `hmr.js` | `HmrClient`：模块热更新生命周期（accept/dispose/invalidate） |
| `server-bridge.js` | `createServerBridge` + `createFetchHandler`（虚拟服务桥） |
| `sw-handler.js` | `installFetchHandler`：SW 侧 fetch 拦截器 |
| `sandbox-deploy.js` | `generateCspHeader` / `generateSwScript` / `generateSandboxFiles` |
| `worker-comlink.js` | 零依赖 Worker RPC（`wrapWorker`/`exposeApi`） |
| `vfs-snapshot.js` | VFS 序列化/反序列化/差异计算 |
| `vfs-events.js` | VFS 事件代理与跨 VFS 同步桥 |

## 1. DevServer

`DevServer` 是面向浏览器沙箱的轻量虚拟 HTTP 服务：

- 从 VFS 读取文件并返回 `status/headers/body`
- 支持目录自动回退 `index.html`
- 内置常见 MIME 表，并支持 `mimeOverrides`
- 提供 `onHmr/offHmr/emitHmr` 用于和热更新系统对接
- 具备 `start/stop/started/port` 状态接口（便于上层编排）

## 2. HMR

`HmrClient` 提供 browser-first 的热更新状态机：

- 更新类型：`update`（JS 模块）、`css-update`、`full-reload`
- 提供 `createHotContext(moduleId)`，兼容 `import.meta.hot` 常见语义：
  - `accept`（自接收/依赖接收）
  - `dispose`
  - `invalidate`
  - `decline`
  - `data`
- 可绑定 VFS 事件（监听 `change`）自动触发 `handleFileChange`
- 缺少可接收链路时自动降级为 `full-reload`

## 3. Service Worker（sw-handler + sandbox-deploy）

### sw-handler

`installFetchHandler(sw)` 用于 SW 侧接管虚拟路径请求：

- 拦截 `/__virtual__/PORT/PATH`
- 通过 `MessageChannel` 转发请求到主线程 bridge
- 将主线程返回的数据封装为 `Response`
- 内置 keepalive message 处理，降低 SW 空闲回收带来的中断

### sandbox-deploy

提供部署产物生成工具：

- `generateCspHeader(parentOrigin)`：生成 iframe sandbox 页面 CSP
- `generateSwScript()`：生成默认 SW 脚本（安装/激活/缓存/skip-waiting）
- `generateSandboxFiles(options)`：一次性生成 `indexHtml`、`vercelJson`、`swScript`

## 4. Worker RPC（worker-comlink）

`worker-comlink.js` 提供零依赖、Comlink 风格最小 RPC：

- 主线程：`wrapWorker({ worker, timeout, onConsole })`
  - 返回 async proxy：`execute`、`runFile`、`clearCache`
  - 支持 `terminate()` 与 pending 请求超时回收
- Worker 线程：`exposeApi(api, self)`
  - 监听 `MSG_CALL`，执行后回传 `MSG_RETURN`
- 消息常量：`MSG_CALL`, `MSG_RETURN`, `MSG_CONSOLE`

## 5. VFS 工具（snapshot + events）

### vfs-snapshot

- `toSnapshot(vfs)`：序列化目录/文件（文件内容 base64）
- `fromSnapshot(snapshot, vfs?)`：恢复到目标 VFS（可自动创建 `MemoryVfs`）
- `diffSnapshots(a, b)`：输出 `added/modified/deleted`
- `uint8ToBase64` / `base64ToUint8`：浏览器安全字节编码工具

### vfs-events

- `withVfsEvents(vfs)`：通过 Proxy 拦截写入/删除/移动/复制并发出 `change/delete`
- `createVfsEventBridge(eventVfs, target)`：把事件复制到另一个 VFS（含 `dispose`）
- 适用于 DevServer/HMR/reactive UI 的跨组件文件状态同步

## 6. 公共导出

推荐从 `webruntime/index.js` 导入：

- DevServer：`DevServer`, `MIME_TYPES`
- HMR：`HmrClient`, `createHmrClient`
- Bridge：`createServerBridge`, `createFetchHandler`
- SW：`installFetchHandler`
- Deploy：`generateCspHeader`, `generateSwScript`, `generateSandboxFiles`
- Worker RPC：`wrapWorker`, `exposeApi`, `MSG_CALL`, `MSG_RETURN`, `MSG_CONSOLE`
- VFS Snapshot：`uint8ToBase64`, `base64ToUint8`, `toSnapshot`, `fromSnapshot`, `diffSnapshots`
- VFS Events：`withVfsEvents`, `createVfsEventBridge`
