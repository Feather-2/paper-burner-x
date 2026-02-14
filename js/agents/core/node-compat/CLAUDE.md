# node-compat - Node.js 兼容层

提供浏览器沙箱中的 Node.js 运行时兼容能力（`require`/模块解析/内置模块 shim/npm 包管理/ToolExecutor 集成），并在 `createNodeEnv` 中统一接入配额控制与可观测性流。

## 模块拆分

> 自 commit `03d6fab6` 起，原 `sandbox/` 的 Node 兼容相关能力拆分到 `node-compat/`，与隔离核心、浏览器运行时解耦。

| 模块 | 路径 | 职责 |
|------|------|------|
| **sandbox** | `../sandbox/` | WASM/System 沙箱核心与能力控制 |
| **node-compat** | `./` | Node.js 兼容层（require/module-resolver/shims/npm/ToolExecutor） |
| **webruntime** | `../webruntime/` | 浏览器运行时（DevServer/HMR/SW/Worker/VFS 工具） |

## 架构（createNodeEnv 流程）

```text
调用方 / ToolExecutor
        │
        ▼
createSandboxTool() ──────────────┐
        │                         │
        ▼                         │
createNodeEnv(config)             │
  ├─ externalVfs || MemoryVfs     │
  ├─ withVfsEvents(vfs)           │
  ├─ withObservability(vfs, obs)  │
  ├─ QuotaEnforcer(quota)         │
  ├─ ensure cwd                   │
  └─ createSandbox(...)           │
        │                         │
        ├────────► createBuiltinModules({ vfs, networkPolicy, violationStore, ... })
        │                         │
        ├────────► createRequire({ vfs, builtinModules, evaluate, globals })
        │                         │
        └────────► createCorsProxy() (optional, default disabled)
                                  │
                                  ▼
                         require('./main.js')
                                  │
                                  ▼
                    module-resolver + VFS + npm node_modules
```

## CORS Proxy（opt-in）

- 默认不代理（secure by default）。
- 推荐使用实例 API：`createCorsProxy(initialUrl?)`，每个环境独立维护状态。
- 兼容 API `setCorsProxy/getCorsProxy/buildCorsProxyUrl/fetchWithCorsProxy` 保留但标记 `@deprecated`。
- 代理 URL 与目标 URL 通过 `encodeURIComponent` 拼接；调用方需自行实施协议/域名/内网访问限制策略。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块聚合导出（shims/require/resolver/npm/polyfills 等） |
| `create-node-env.js` | `createNodeEnv`：组装 VFS + 事件桥 + 配额 + 可观测性 + Wasm sandbox |
| `quota.js` | `QuotaEnforcer`：资源配额控制（时间/IO/等） |
| `observability.js` | `ObservabilityStream` 与 `withObservability`：指标、日志、事件追踪 |
| `sandbox-tool.js` | `createSandboxTool`：`execute_code` 工具定义与处理器 |
| `require.js` | VFS 绑定 CommonJS require（IIFE 包装、缓存、循环依赖处理） |
| `module-resolver.js` | 模块解析（`exports`/`browser`/`main`/扩展名探测/node_modules 向上查找） |
| `transform-esm.js` | `hasESMSyntax` 与 `transformESMtoCJS` |
| `cors-proxy.js` | 可选 CORS 代理（实例 API + 兼容模块级 API） |
| `repl.js` | 轻量 REPL 上下文（跨次执行保留变量） |
| `vfs-adapter.js` | 将 VFS 适配为 Node 风格文件系统接口 |
| `npm/index.js` | `PackageManager`（安装、依赖树、事件发射） |
| `npm/registry.js` | npm registry 客户端（元数据与 tarball 拉取） |

## 设计约束

- Browser-first：默认可在浏览器运行，Node.js 仅为兼容运行时。
- Secure-by-default：默认不启用代理，默认最小 capabilities。
- Observability-first：环境创建时可注入外部观测流，未注入则创建默认流。
- 生命周期完整：调用方必须执行 `dispose()` 释放监听器与运行时资源。