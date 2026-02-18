# node-compat - Node.js 兼容层

提供浏览器优先的 Node 兼容运行能力；`createNodeEnv` 是当前统一入口，负责把 VFS、可观测性、配额与沙箱后端组装为可执行环境。

## createNodeEnv（最新实现）

`create-node-env.js` 当前流程如下：

1. 启动时调用 `setupErrorStackTracePolyfill()`（幂等，仅在缺失 `Error.captureStackTrace` 时生效）。
2. 创建资源控制组件：可选 `QuotaEnforcer` + `ObservabilityStream`（可外部注入）。
3. 组装 VFS 管线：`externalVfs || MemoryVfs` → `withVfsEvents` → `withObservability`。
4. 自动确保 `cwd` 存在（`mkdir(..., { recursive: true })`）；失败仅记录 debug 日志，不中断启动。
5. 根据 `sandboxLevel` 选择后端：
   - `wasm`（默认）：调用 `../sandbox/wasm-sandbox.js#createSandbox`
   - `worker/iframe/main/auto`：调用 `../sandbox/create-sandbox.js#createSandboxFactory`
   - `eval`：兼容别名，映射到 `main`
6. 暴露便捷方法：
   - `execute(code, filename?)`（附带 `__filename`）
   - `runFile(path)`（先从 VFS `readText` 再执行）
7. `dispose()` 幂等清理：释放沙箱并移除 VFS 监听器；返回对象包含 `terminated` getter。

## 关键行为说明

- `sandboxLevel` 已真实接线；默认值为 `wasm`（保证与历史行为一致）。
- 默认超时 `30000ms`，默认能力为 `['console']`。
- 传入外部 `observability` 时复用该流；未传入时自动创建新流。
- 生命周期由调用方负责：使用完毕后应调用 `dispose()`。

## 相关文件

| 文件 | 职责 |
|------|------|
| `create-node-env.js` | 统一环境装配（polyfill + VFS + quota/observability + sandbox） |
| `polyfills/error-stack-trace.js` | `Error.captureStackTrace` 兼容层（Safari/Firefox） |
| `quota.js` | 资源配额控制 |
| `observability.js` | 观测流与 VFS 观测包装 |
| `index.js` | node-compat 聚合导出 |
