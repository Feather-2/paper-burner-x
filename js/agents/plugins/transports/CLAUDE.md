# transports - 外部进程通信

与外部二进制工具通信的传输层，Node.js 实现 + Browser fail-fast stub。

## 核心文件

| 文件 | 职责 |
|------|------|
| `process-transport.js` | Node.js stdio 通信（JSONL；可承载 JSON-RPC 2.0 envelope） |
| `binary-skill-provider.js` | 二进制工具作为 Skills（ServiceBus 注册 + EventBus 广播；连接池/自动重连） |
| `index.js` | 运行时分发（Node/Browser），统一导出 API |
| `index.node.js` | Node.js 实现导出 |
| `index.browser.js` | Browser stub 导出（调用即抛错，避免打包 Node-only API） |

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    BinarySkillProvider                       │
│  - 管理多个二进制连接                                         │
│  - 集成 EventBus / ServiceBus                                │
│  - 连接池 / 自动重连                                          │
├─────────────────────────────────────────────────────────────┤
│                    ProcessTransport                          │
│  - spawn + stdio                                             │
│  - JSONL（可承载 JSON-RPC 2.0 消息体）                         │
│  - 请求/响应 + 事件                                           │
└─────────────────────────────────────────────────────────────┘
                           ↓
              External Binaries (Codex, Playwright, etc.)
```

## 运行时分发

`index.js` 通过 `Platform.isNode` 在运行时 `import()` 对应实现：

- Node: `index.node.js`
- Browser: `index.browser.js`（fail-fast stub）

统一导出符号（Node 可用，Browser 为 stub）：

- `ProcessTransport` / `createProcessTransport`
- `BinarySkillProvider` / `createBinarySkillProvider`

Browser 端调用上述 API 会抛错，用于快速暴露不兼容用法，并避免 Browser bundle 直接解析/引入 `node:*` 模块（例如 `node:child_process`）。

## ProcessTransport

通过 stdio 与外部二进制通信，使用 JSONL（以换行分隔的 JSON）作为双向消息流。

### 数据流

```
js/agents (Node.js)
    ↓ spawn
┌─────────────────────────────────────┐
│ ProcessTransport                    │
│   stdin  →  JSON\n  →  Binary CLI   │
│   stdout ←  JSON\n  ←               │
│   stderr ←  logs    ←               │
└─────────────────────────────────────┘
    ↓ events
transport:message / method:* / transport:stderr / transport:error / transport:exit
```

### 事件

- `transport:connected` 连接就绪
- `transport:message` 原始消息（已解析对象）
- `method:*` 按方法名派发（例如 `method:tools/list`）
- `transport:stderr` stderr 输出
- `transport:error` 进程/传输错误
- `transport:exit` 进程退出
- `transport:parse_error` JSON 解析失败
- `transport:buffer_overflow` 缓冲区溢出
- `transport:message_too_large` 单条消息超过大小限制

## BinarySkillProvider

将外部二进制工具封装为 Skills，并通过微架构总线集成：

- 通过 ServiceBus 注册服务/方法
- 通过 EventBus 广播工具事件
- 支持连接池和自动重连

### 配置（BinarySkillConfig）

- `name`：技能名称
- `command` / `args`：命令与参数
- `env`：环境变量覆写
- `cwd`：工作目录
- `timeout`：请求超时（默认 30s）
- `autoReconnect`：自动重连
- `methods`：暴露的方法列表

安全约束（建议默认启用/默认拒绝）：

- `allowedCommands`：允许执行的命令白名单（命令名或绝对路径）
- `allowedCwdRoots`：允许的工作目录根路径
- `allowedEnvKeys`：允许覆写的环境变量键名

### 安全注意事项

- 不要将 `command`/`args`/`cwd`/`env` 直接暴露给不可信输入。
- 启动子进程应避免 shell 执行（建议 `shell: false`），并对 `command`/`cwd` 做 allowlist 校验与路径规范化。
- 解析外部输出需做大小限制与 schema 校验，避免 DoS 与异常形态数据穿透。

## Browser Stub

`index.browser.js` 提供与 Node 端同名导出，但在构造/调用时立即抛错，确保：

- 浏览器构建不需要 Node-only API（例如 `node:child_process`）
- 错误早暴露（fail-fast），避免静默失败
