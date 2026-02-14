# sandbox - 沙箱隔离系统

`sandbox/` 提供统一沙箱接口与后端分流逻辑；`create-sandbox.js` 负责按隔离级别创建可执行实例。

## create-sandbox.js（最新实现）

公共入口为 `createSandboxFactory(config)`：

1. `validateConfig()` 归一化配置。
2. 若 `level === 'auto'`，按 `AUTO_PRIORITY` 依次探测后端。
3. 使用 `wrapAsSandbox()` 统一返回接口：
   - `execute(code, filename?)` → `SandboxResult`（`ok/value/error/stack/durationMs`）
   - `runFile(path)`（依赖 `cfg.vfs.readText`）
   - `terminate()`（幂等）
   - `terminated` getter

## 后端状态

| 后端 | 当前行为 |
|------|----------|
| `wasm` | 先做 `isWasmSupported()` 检测，再调用 `wasm-sandbox.js` |
| `worker` | 浏览器可用；Node.js 环境当前直接报错（未支持 `worker_threads` 路径） |
| `iframe` | 当前为 stub，直接抛出 `not yet implemented` |
| `main` | 回退执行路径，使用 `new Function('return ' + code)` |

## 新增安全约束（主线程回退）

在 `createMainSandbox` 中新增死锁防护：

- 当 `cfg.vfs?._isRemote === true` 且允许主线程回退时，直接抛错。
- 原因：主线程沙箱 + 远程 VFS 可能造成同步 IO 死锁。
- 期望替代：使用 `worker/iframe` 级别执行。

## 维护约定

- `mainThreadFallback === false` 时，`main` 后端必须拒绝创建。
- `autoCreate` 必须收集每个失败后端的错误信息，便于定位降级原因。
- `terminate()` 行为保持幂等，不允许重复终止抛异常。
