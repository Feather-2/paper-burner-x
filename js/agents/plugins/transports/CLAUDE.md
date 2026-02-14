# transports - 外部进程通信

与外部二进制工具通信的传输层，Node.js 实现 + Browser fail-fast stub。

> 安全提示：该模块具备启动外部进程的能力，相关配置应被视为高权限输入。若技能配置来自用户配置、远端配置或插件输入，必须启用并强制执行 allowlist 约束（`command` / `cwd` / `env`）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `process-transport.js` | Node.js stdio 通信（JSONL；可承载 JSON-RPC 2.0 envelope） |
| `binary-skill-provider.js` | 二进制工具作为 Skills（ServiceBus 注册 + EventBus 广播；连接池/自动重连；命令/cwd/env allowlist 约束） |
| `index.js` | 运行时异步分发门面（基于 `Platform.isNode` 的懒加载 `import()`） |
| `index.node.js` | Node.js 实现导出 |
| `index.browser.js` | Browser stub 导出（调用即抛错，避免打包 Node-only API） |

## 架构

```text
┌─────────────────────────────────────────────────────────────┐
│                    BinarySkillProvider                       │
│  - 管理多个二进制连接                                         │
│  - 集成 EventBus / ServiceBus                                │
│  - 连接池 / 自动重连                                          │
│  - allowlist 校验：command / cwd / env                        │
├─────────────────────────────────────────────────────────────┤
│                    ProcessTransport                          │
│  - spawn + stdio                                             │
│  - JSONL（可承载 JSON-RPC 2.0 消息体）                         │
│  - 请求/响应 + 事件                                           │
└─────────────────────────────────────────────────────────────┘
                           ↓
              External Binaries (Codex, Playwright, etc.)
```

## 运行时分发（更新）

`index.js` 通过 `Platform.isNode` 在运行时懒加载对应实现：

- Node: `index.node.js`
- Browser: `index.browser.js`（fail-fast stub）

当前实现采用异步门面，不再直接同步导出 `ProcessTransport` / `BinarySkillProvider`。调用方需通过异步 API 获取类或实例。

### 对外 API（`index.js`）

| API | 返回 | 说明 |
|-----|------|------|
| `getImpl()` | `Promise<Module>` | 获取当前运行时实现模块 |
| `getProcessTransport()` | `Promise<typeof ProcessTransport>` | 获取 `ProcessTransport` 类 |
| `createProcessTransport(...args)` | `Promise<ProcessTransport>` | 创建 `ProcessTransport` 实例 |
| `getBinarySkillProvider()` | `Promise<typeof BinarySkillProvider>` | 获取 `BinarySkillProvider` 类 |
| `createBinarySkillProvider(...args)` | `Promise<BinarySkillProvider>` | 创建 `BinarySkillProvider` 实例 |

默认导出为门面对象：

- `getImpl`
- `getProcessTransport`
- `createProcessTransport`
- `getBinarySkillProvider`
- `createBinarySkillProvider`

> 兼容性注意：旧调用方式若依赖 `index.js` 的同步类导出，需要迁移到 `await createProcessTransport(...)` / `await createBinarySkillProvider(...)`。

## Browser Stub

`index.browser.js` 导出同名类和工厂函数，但调用即抛错：

- `ProcessTransport`
- `createProcessTransport`
- `BinarySkillProvider`
- `createBinarySkillProvider`

目的：

1. 在浏览器环境快速暴露不兼容调用；
2. 防止 Browser bundle 误引入 `node:child_process` 等 Node-only API。

## ProcessTransport

通过 stdio 与外部二进制通信，核心能力：

- 进程生命周期管理（启动 / 关闭 / 重连）
- JSONL 消息收发（可承载 JSON-RPC envelope）
- 请求-响应匹配与事件转发
- 超时控制与错误传播

## BinarySkillProvider

将外部二进制封装为 Skill 服务，核心能力：

- 多技能配置装配与生命周期管理
- ServiceBus 注册（供 Agent 侧调用）
- EventBus 广播（连接状态 / 执行事件）
- 连接池复用与自动重连
- allowlist 约束：`allowedCommands` / `allowedCwdRoots` / `allowedEnvKeys`

默认超时常量：`DEFAULT_TIMEOUT_MS = 30000`。

## 安全基线

- `command` 必须匹配 allowlist（命令名或绝对路径）
- `cwd` 必须落在允许根目录内（规范化后校验）
- `env` 仅允许白名单键覆盖
- 外部输入场景建议 fail-closed（白名单缺失则拒绝执行）
- 错误分级：日志保留细节，对用户输出友好错误

## Browser / Node 兼容约定

- Browser 入口不得静态依赖 Node-only API（`node:*`、`child_process`、`fs`、`path`）
- Node 实现限定在 `index.node.js` 及其依赖
- 跨端统一入口为 `index.js` 的异步门面 API
