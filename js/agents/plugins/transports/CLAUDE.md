# transports - 外部进程通信

与外部二进制工具通信的传输层，Node.js 实现 + Browser fail-fast stub。

> 安全提示：该模块具备启动外部进程的能力，相关配置应被视为“高权限输入”。如需从外部来源（用户配置/远端配置/插件）加载技能，必须启用并强制执行 allowlist 约束（见 BinarySkillProvider）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `process-transport.js` | Node.js stdio 通信（JSONL；可承载 JSON-RPC 2.0 envelope） |
| `binary-skill-provider.js` | 二进制工具作为 Skills（ServiceBus 注册 + EventBus 广播；连接池/自动重连；命令/cwd/env allowlist 约束） |
| `index.js` | 运行时分发（Node/Browser），统一导出 API（基于 `Platform.isNode` 的动态 `import()`；top-level `await`） |
| `index.node.js` | Node.js 实现导出 |
| `index.browser.js` | Browser stub 导出（调用即抛错，避免打包 Node-only API） |

## 架构

```
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

## 运行时分发

`index.js` 通过 `Platform.isNode` 在运行时 `import()` 对应实现：

- Node: `index.node.js`
- Browser: `index.browser.js`（fail-fast stub）

统一导出符号（Node 可用，Browser 为 stub）：

- `ProcessTransport` / `createProcessTransport`
- `BinarySkillProvider` / `createBinarySkillProvider`

Browser 端调用上述 API 会抛错，用于快速暴露不兼容用法，并避免 Browser bundle 直接解析/引入 `node:*` 模块（例如 `node:child_process`）。

注意：该分发实现使用 top-level `await` 动态导入；在需要兼容较旧打包器/运行时的场景，优先考虑使用条件导出（`package.json` exports 的 `browser`/`node` 条件）来替代运行时分发。

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
transport:message / method:* / transport:stde
```

## BinarySkillProvider

将外部二进制包装成 Skills：

- 通过 ServiceBus 注册二进制服务
- 通过 EventBus 广播工具事件
- 支持连接池与自动重连

### 配置与安全边界（必须阅读）

`BinarySkillConfig`（如 `command`/`args`/`env`/`cwd`）等价于“启动外部进程”的能力授予，必须当作高权限配置处理：

- 不要直接接受不受信任的输入作为 `command`/`cwd`/`env`。
- 如必须允许外部来源选择/配置技能，务必启用并强制执行 allowlist：
  - `allowedCommands`：允许启动的命令名或绝对路径白名单
  - `allowedCwdRoots`：允许的工作目录根路径（建议 realpath 后做前缀匹配，防止 `..`/符号链接逃逸）
  - `allowedEnvKeys`：允许覆盖的环境变量键名（默认拒绝覆盖；避免 `PATH`/`NODE_OPTIONS` 等高风险键）

实现/使用建议：

- 默认拒绝：allowlist 未配置时，不要“默认放行”任意 `command`。
- 永远不要使用 `shell: true`；`args` 始终用数组传参。
- 限制 `timeout` 的边界（下限/上限/NaN/Infinity），避免被极端值拖垮。
- 日志中避免输出完整命令行、cwd、env 值（尤其是 token/key）。
