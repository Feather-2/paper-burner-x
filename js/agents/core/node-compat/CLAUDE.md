# node-compat - Node.js 兼容层

提供浏览器沙箱中的 Node.js 运行时兼容能力（`require`/模块解析/内置模块 shim/npm 包管理/ToolExecutor 集成）。

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
  ├─ ensure cwd                   │
  └─ createSandbox(...)           │
        │                         │
        ├────────► createBuiltinModules({ vfs, networkPolicy, violationStore, ... })
        │                         │
        └────────► createRequire({ vfs, builtinModules, evaluate, globals })
                                  │
                                  ▼
                         require('./main.js')
                                  │
                                  ▼
                    module-resolver + VFS + npm node_modules
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块聚合导出（shims/require/resolver/npm/polyfills 等） |
| `create-node-env.js` | `createNodeEnv`：组装 VFS + 事件桥 + Wasm sandbox + 便捷执行接口 |
| `sandbox-tool.js` | `createSandboxTool`：`execute_code` 工具定义与处理器 |
| `require.js` | VFS 绑定 CommonJS require（IIFE 包装、缓存、循环依赖处理） |
| `module-resolver.js` | 模块解析（`exports`/`browser`/`main`/扩展名探测/node_modules 向上查找） |
| `transform-esm.js` | `hasESMSyntax` 与 `transformESMtoCJS` |
| `cors-proxy.js` | 可选 CORS 代理（实例 API + 兼容旧模块级 API） |
| `repl.js` | 轻量 REPL 上下文（跨次执行保留变量） |
| `vfs-adapter.js` | 将 VFS 适配为 Node 风格文件系统接口 |
| `npm/index.js` | `PackageManager`（安装、依赖树、事件发射） |
| `npm/registry.js` | npm registry API 客户端 + LRU 元数据缓存 |
| `npm/resolver.js` | semver 解析与依赖解析 |
| `npm/tarball.js` | tarball 下载、解压并写入 VFS |
| `polyfills/*` | 栈追踪 + TextDecoder 扩展 polyfill |

## 1. ToolExecutor 集成（sandbox-tool）

`createSandboxTool()` 生成可注册到 ToolExecutor 的 `execute_code` 工具：

- 工具名：`execute_code`
- 入参：`code`（必填）、`filename`、`install`（执行前安装 npm 包）
- 生命周期：内部懒初始化 `NodeEnv`、`require`、可选 iframe eval bridge，并暴露 `handler.dispose()`

关键设计：

- **执行包装策略**：`require.js` 通过 IIFE 包装返回模块函数，需在宿主侧拿到可调用函数对象。
- **为何不直接走 QuickJS `vm.dump()` 路径**：函数对象无法可靠序列化回宿主，导致包装函数不可调用。
- **当前实现**：
  - Browser 优先走 `iframe-eval-bridge`（受控 iframe）
  - Node-like 环境回退到宿主侧间接 `eval`（`(0, eval)(code)`）

## 2. Node.js 兼容层（createNodeEnv + require + module-resolver）

### createNodeEnv

- `vfs`: 外部注入优先，否则创建 `MemoryVfs`
- `withVfsEvents(vfs)`: 为 VFS 增加 `change/delete` 事件能力
- 自动确保 `cwd` 目录存在
- 通过 `createSandbox()` 创建执行上下文，并暴露：
  - `execute(code, filename?)`
  - `runFile(path)`
  - `dispose()`（同时清理 sandbox 与监听器）

### require（CommonJS）

- 解析顺序：内置模块 → JSON → JS 文件
- JS 文件执行使用 Node 风格包装参数：
  - `exports, require, module, __filename, __dirname, process, console, Buffer, global, globalThis, __dynamicImport`
- 支持循环依赖（先写入 cache 再执行）
- 支持 LRU 式 cache 限制（默认 `cacheLimit=2000`）

### module-resolver

- 支持 `node:` 前缀与裸内置模块名
- 支持相对/绝对路径与扩展名探测（`.js/.json/.mjs`）
- 支持目录入口解析：`exports['.']` → `browser/main` → `index.*`
- 支持 bare specifier 的 `node_modules` 逐级向上查找
- 支持 `package.json` `exports` 条件优先级（browser-first）

## 3. module-resolver 缓存（_pkgJsonCache）

`createResolver()` 内部维护 `_pkgJsonCache: Map<string, object|null>`：

- key：标准化后的 `package.json` 路径
- value：
  - `object`：已解析 `package.json`
  - `null`：读取/解析失败的负缓存
- 生命周期：**resolver 实例级**（实例销毁即失效）
- 目的：减少重复 I/O 与 JSON parse，稳定复杂依赖解析性能

## 4. npm 包管理（browser-side）

`npm/` 提供浏览器内 npm 安装链路：

- `Registry`：请求 npm registry 元数据，内置 LRU 缓存
- `DependencyResolver`：解析 semver range，构建扁平依赖树（去重/防环）
- `TarballManager`：下载 tarball，解压并写入 VFS `node_modules`
- `PackageManager`：门面 API + 事件（`install:start/progress/complete/error`）

典型流程：

1. `PackageManager.install(name, { version })`
2. resolver 确定版本并展开依赖
3. tarball 下载与解压
4. 写入 `/node_modules/*`

## 5. Shims 概览（16 个 builtin shim）

### Sync/Async API 限制

**重要**：同步 fs API（`readFileSync`, `writeFileSync`, `readdirSync` 等）仅支持 `MemoryVfs`。

- **MemoryVfs**：内存后端，支持同步与异步 API
- **IndexedDB/OPFS 后端**：仅支持异步 API（`readFile`, `writeFile`, `readdir` 等）

调用同步 API 时，若 VFS 不支持同步访问（缺少 `_getNode` 内部方法），会抛出错误：
```
Sync fs API requires a VFS with synchronous internals (MemoryVfs).
For IndexedDB/OPFS backends, use async APIs (readFile, writeFile, etc.) instead.
```

**推荐做法**：优先使用异步 API（`fs.promises.*` 或回调风格），确保跨后端兼容。

| 文件 | 对应模块 | 说明 |
|------|----------|------|
| `index.js` | registry | `createBuiltinModules` 统一装配入口 |
| `path.js` | `path` | POSIX 风格路径操作 |
| `fs.js` | `fs` | VFS 适配 fs API；支持 `protectedPaths` 写保护 |
| `http.js` | `http` | `createHttpShim`；支持 `NetworkPolicy` 过滤 |
| `events.js` | `events` | `EventEmitter` |
| `stream.js` | `stream` | `Readable/Writable/Transform/PassThrough` |
| `buffer.js` | `buffer` | `Buffer` 实现与编码工具 |
| `process.js` | `process` | `createProcess`（env/cwd/std* 等） |
| `os.js` | `os` | 浏览器下可用的系统信息近似值 |
| `net.js` | `net` | `Socket` 等网络桩能力 |
| `crypto.js` | `crypto` | `sign/verify/randomBytes/createHash` 等 |
| `url.js` | `url` | URL 解析与格式化 |
| `querystring.js` | `querystring` | query parse/stringify |
| `util.js` | `util` | inspect/format/promisify 等 |
| `zlib.js` | `zlib` | 压缩接口 stub（含 brotli 占位） |
| `child-process.js` | `child_process` | `createChildProcessShim` |

装配细节：

- `createBuiltinModules` 会自动把 `networkPolicy + violationStore` 注入 `http` shim。
- `fs` shim 在存在 `protectedPaths`/`violationStore` 时自动启用写入拦截记录。
- `https` 复用 `http` 实例，并在 `request/get` 时强制 `protocol: 'https:'`。

## 6. 公共导出

推荐从 `node-compat/index.js` 导入：

- Shims：`createBuiltinModules`, `BUILTIN_MODULE_NAMES`
- Require/解析：`createRequire`, `createResolver`
- ESM 转换：`hasESMSyntax`, `transformESMtoCJS`
- 环境工厂：`createNodeEnv`
- Tool 集成：`createSandboxTool`, `SANDBOX_TOOL_DEFINITION`
- CORS 代理：`createCorsProxy`, `setCorsProxy`, `getCorsProxy`, `buildProxyUrl`, `proxyFetch`
- REPL：`createREPL`
- VFS 适配：`createVfsAdapter`
- npm：`PackageManager`
- Polyfills：
  - `parseStack`, `createCallSite`, `installStackTracePolyfill`, `RAW_STACK`
  - `ExtendedTextDecoder`, `installPolyfill`
