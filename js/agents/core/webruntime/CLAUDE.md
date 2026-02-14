# webruntime - 浏览器运行时

提供浏览器侧沙箱应用运行能力（DevServer/HMR/Service Worker/Worker RPC/VFS 快照与部署文件生成）。

## 模块拆分

> 自 commit `03d6fab6` 起，原 `sandbox/` 的浏览器运行时能力拆分到 `webruntime/`，与隔离核心、Node 兼容层解耦。

| 模块 | 路径 | 职责 |
|------|------|------|
| **sandbox** | `../sandbox/` | WASM/System 沙箱核心与能力边界 |
| **node-compat** | `../node-compat/` | Node.js 兼容层（require/shims/npm/ToolExecutor） |
| **webruntime** | `./` | 浏览器运行时（DevServer/HMR/SW/Worker/VFS 工具） |

## 架构（DevServer + SW + Worker + Snapshot）

```text
                 ┌──────────────────────────────────┐
                 │            Main Thread            │
VFS ───────────► │ DevServer.handleRequest(path)    │
                 │   ├─ MIME 识别                   │
                 │   ├─ 根目录约束与路径归一化      │
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

Snapshot Utils: toSnapshot/fromSnapshot/diffSnapshots
用于跨线程或持久化的 VFS 状态同步
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块聚合导出 |
| `dev-server.js` | `DevServer`：VFS 驱动的 HTTP 语义服务（文件分发/MIME/HMR） |
| `hmr.js` | `HmrClient`：模块热更新生命周期（accept/dispose/invalidate） |
| `server-bridge.js` | `createServerBridge` + `createFetchHandler`（虚拟服务桥） |
| `sw-handler.js` | `installFetchHandler`：SW 侧 fetch 拦截与请求转发 |
| `sandbox-deploy.js` | `generateCspHeader` / `generateSwScript` / `generateSandboxFiles` |
| `worker-comlink.js` | `wrapWorker` / `exposeApi` 与 RPC 消息常量 |
| `vfs-snapshot.js` | `uint8/base64` 转换、快照生成/恢复/差异比较 |

## 对外 API（index.js）

- Dev Server：`DevServer`、`MIME_TYPES`
- HMR：`HmrClient`、`createHmrClient`
- Server Bridge：`createServerBridge`、`createFetchHandler`
- Service Worker：`installFetchHandler`
- Sandbox Deploy：`generateCspHeader`、`generateSwScript`、`generateSandboxFiles`
- Worker RPC：`wrapWorker`、`exposeApi`、`MSG_CALL`、`MSG_RETURN`、`MSG_CONSOLE`
- VFS Snapshot：`uint8ToBase64`、`base64ToUint8`、`toSnapshot`、`fromSnapshot`、`diffSnapshots`

## 约束与测试关注

- Browser-first：禁止引入 Node-only API（`fs`/`path`/`child_process` 等）。
- 路径安全：请求路径必须归一化并限制在 `root` 下。
- 监听器生命周期：HMR/Bridge/SW 监听器需提供可回收机制，避免内存泄漏。
- 建议测试：状态机转换、并发更新、插件生命周期、监听器释放。