# Polyfills (node-compat)

`polyfills/` 提供浏览器环境下的 Node/V8 兼容补丁，按“缺失才安装”策略运行。

## 目录职责

| 文件 | 作用 | 关键能力 |
| --- | --- | --- |
| `error-stack-trace.js` | 新增 `Error.captureStackTrace` 兼容实现 | 解析 Chrome/Safari 栈行，生成 CallSite，支持 `prepareStackTrace` |
| `stack-trace.js` | 旧版栈追踪 polyfill | 兼容导出与历史调用路径 |
| `text-decoder.js` | `TextDecoder` 增强 | 编码别名归一化与扩展解码 |

## error-stack-trace.js（最新变更）

`setupErrorStackTracePolyfill(target = globalThis)` 的行为：

- 若 `target.Error.captureStackTrace` 已存在则直接跳过（幂等）。
- 缺省设置 `Error.stackTraceLimit = 10`（仅在未设置时）。
- 同时支持两类栈格式解析：
  - Chrome：`at fn (file:line:col)` / `at file:line:col`
  - Safari：`fn@file:line:col` / `@file:line:col`
- 安装后 `captureStackTrace(targetObject, constructorOpt?)` 支持：
  - 按 `constructorOpt.name` 裁剪栈帧
  - `Error.prepareStackTrace(error, callSites)` 自定义格式化
  - 可覆盖的 `stack` setter（与 V8 行为兼容）

该 polyfill 已在 `createNodeEnv()` 启动阶段自动调用。

## 维护约束

- 保持纯计算实现，不引入 `eval`/`new Function`/DOM 依赖。
- 全局补丁必须可重复执行且无副作用扩散。
- `CallSite` 类型和公开 API 变更时，需同步更新 `__tests__/error-stack-trace.test.js`。
