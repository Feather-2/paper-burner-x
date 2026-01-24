# transports - 外部进程通信

与外部二进制工具通信的传输层，Node.js 实现 + Browser stub。

## 核心文件

| 文件 | 职责 |
|------|------|
| `process-transport.js` | Node.js stdio 通信 (JSONL/JSON-RPC) |
| `binary-skill-provider.js` | 二进制工具作为 Skills (微架构集成) |
| `index.js` | 运行时分发 (Node/Browser) |
| `index.node.js` | Node.js 实现导出 |
| `index.browser.js` | Browser stub 导出（调用即抛错） |

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    BinarySkillProvider                       │
│  - 管理多个二进制连接                                         │
│  - 集成 EventBus / ServiceBus                                │
│  - 自动重连 / 连接池                                          │
├─────────────────────────────────────────────────────────────┤
│                    ProcessTransport                          │
│  - spawn + stdio                                             │
│  - JSONL / JSON-RPC 2.0                                      │
│  - 请求/响应 + 事件                                           │
└─────────────────────────────────────────────────────────────┘
                           ↓
              External Binaries (Codex, Playwright, etc.)
```

## 运行时分发

`index.js` 通过 `Platform.isNode` 动态 import `index.node.js` 或 `index.browser.js`。
Browser 版本提供 fail-fast stub，避免打包 Node-only API。

## ProcessTransport

通过 stdio 与外部二进制通信，支持 JSON-RPC 2.0 协议。

### 数据流

```
js/agents (Node.js)
    ↓ spawn
┌─────────────────────────────────────┐
│ ProcessTransport                    │
│   stdin  →  JSON\n  →  Binary CLI  │
│   stdout ←  JSON\n  ←              │
│   stderr ←  logs    ←              │
└─────────────────────────────────────┘
    ↓ events
transport:message / method:* / transport:stderr / transport:error / transport:exit
```

### 事件

- `transport:connected` 连接就绪
- `transport:message` 原始消息 (JSON-RPC)
- `transport:stderr` stderr 输出
- `transport:error` 进程/传输错误
- `transport:exit` 进程退出
- `transport:parse_error` JSON 解析失败
- `transport:buffer_overflow` 缓冲区溢出
- `transport:message_too_large` 单条消息超过大小限制
- `transport:invalid_message` 消息结构校验失败（字段/长度/字符集）
- `transport:disconnected` 主动断开
- `method:<name>` 将 `message.method` 分发为事件

### 安全与限制

> 该模块的职责是**与外部进程通信**，因此天然具备“执行外部命令”的能力；若 `command/args/cwd/env` 来自不可信输入，可能导致任意命令执行或沙箱逃逸。建议始终启用白名单与路径约束。

#### 防护要点

- **命令白名单**：通过 `allowedCommands`（或环境变量 `PROCESS_TRANSPORT_ALLOWED_COMMANDS`）限制可执行命令。
- **工作目录白名单**：通过 `allowedCwdRoots` 限制 `cwd` 只能落在允许的根路径内。
- **环境变量收敛**：通过 `allowedEnvKeys` 限制可覆盖的 env key；默认阻止 `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES`（除非显式 allowlist）。
- **输入校验**：对 stdout 的 JSON-RPC 进行字段白名单与大小/深度校验，非法消息会丢弃并触发 `transport:invalid_message`。
- **DoS 限制**：限制缓冲区和单行消息大小；超过阈值会触发 `transport:buffer_overflow` / `transport:message_too_large`。

#### 配置字段

| 字段 | 类型 | 作用 |
|------|------|------|
| `allowedCommands` | `string[]` | 命令白名单（命令名或绝对路径） |
| `allowedCwdRoots` | `string[]` | `cwd` 允许的根路径列表 |
| `allowedEnvKeys` | `string[]` | 允许覆盖的环境变量键名 |

### 使用示例

```javascript
import { createProcessTransport } from 'js/agents/plugins/transports';

// 连接 Codex CLI
const transport = createProcessTransport({
  command: 'codex',
  args: ['exec', '--experimental-json'],
  cwd: '/path/to/project',
  timeout: 60000,
  allowedCommands: ['codex'],
  allowedCwdRoots: ['/path/to/project'],
});

await transport.connect();

// 发送请求并等待响应
const result = await transport.request('run', {
  input: 'Fix the bug in main.js',
});

// 监听事件
transport.on('method:item.completed', (params) => {
  console.log('Item:', params);
});

transport.on('transport:stderr', (text) => {
  console.error('[CLI]', text);
});

// 断开
transport.disconnect();
```

### 与 ToolRegistry 集成

```javascript
import { ToolRegistry } from 'js/agents/runtime';
import { createProcessTransport } from 'js/agents/plugins/transports';

// 创建工具代理
function createBinaryTool(name, transport) {
  return async (params, context) => {
    const result = await transport.request(name, params);
    return { ok: true, data: result };
  };
}

const codex = createProcessTransport({ command: 'codex', args: ['--json'] });
await codex.connect();

const registry = new ToolRegistry();
registry.registerTool('codex.run', createBinaryTool('run', codex));
registry.registerTool('codex.analyze', createBinaryTool('analyze', codex));
```

### 与 EventBus 集成

```javascript
import { EventBus } from 'js/agents/core';

const bus = new EventBus();
const transport = createProcessTransport({ command: 'playwright', args: ['--json'] });

// 桥接 transport 事件到 EventBus
transport.on('transport:message', (msg) => {
  bus.emit(`binary:${msg.method || 'message'}`, { payload: msg });
});

transport.on('transport:exit', ({ code }) => {
  bus.emit('binary:exit', { payload: { code } });
});
```

## 协议格式

采用 JSONL (JSON Lines) + JSON-RPC 2.0：

```jsonl
{"jsonrpc":"2.0","id":1,"method":"run","params":{"input":"task"}}
{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}
{"jsonrpc":"2.0","method":"item.completed","params":{"type":"message"}}
```

## 未来扩展

| Transport | 运行时 | 说明 |
|-----------|--------|------|
| `ProcessTransport` | Node.js | ✅ 已实现 |
| `WasmTransport` | Browser/Node | WASM 模块调用 |
| `WorkerTransport` | Browser/Node | Worker 线程通信 |
| `HttpTransport` | All | HTTP/SSE 远程调用 |

## BinarySkillProvider

高层封装，利用微架构特性将二进制工具集成为 Skills。

### 使用示例

```javascript
import { ToolRegistry } from 'js/agents/runtime';
import { createBinarySkillProvider } from 'js/agents/plugins/transports';
import { EventBus, ServiceBus } from 'js/agents/core';

const eventBus = new EventBus();
const serviceBus = new ServiceBus();

const provider = createBinarySkillProvider({
  eventBus,
  serviceBus,
  skills: [
    {
      name: 'codex',
      command: 'codex',
      args: ['exec', '--experimental-json'],
      methods: ['run', 'analyze'],
      autoReconnect: true,
      allowedCommands: ['codex'],
      allowedCwdRoots: ['/path/to/project'],
    },
    {
      name: 'playwright',
      command: 'npx',
      args: ['playwright', 'test', '--reporter=json'],
      methods: ['test', 'screenshot'],
      allowedCommands: ['npx'],
    },
  ],
});

await provider.initialize();

// 调用二进制技能
const result = await provider.call('codex', 'run', {
  input: 'Fix the bug in main.js',
});

// 通过 ServiceBus 调用
const codexService = serviceBus.get('codex');
await codexService.call('analyze', { file: 'src/index.js' });

// 监听事件
eventBus.subscribe('binary:codex:item.completed', (evt) => {
  console.log('Codex item:', evt.payload);
});

// 注册到 ToolRegistry
const registry = new ToolRegistry();
for (const tool of provider.getToolDefinitions()) {
  registry.registerTool(tool.name, tool.handler);
}

// 关闭
await provider.shutdown();
```

### 事件约定

- `binary:provider:ready`
- `binary:<skill>:connected`
- `binary:<skill>:disconnected`
- `binary:<skill>:message`
- `binary:<skill>:exit`
- `binary:<skill>:error`
- `binary:<skill>:call`
- `binary:<skill>:result`
- `binary:<skill>:<method>` (来自 JSON-RPC method)

### 微架构集成

| 总线 | 集成方式 |
|------|----------|
| **EventBus** | 广播 `binary:<skill>:<event>` 事件 |
| **ServiceBus** | 注册 `{ call, notify, isConnected }` 服务 |
| **ToolRegistry** | 生成工具定义 `<skill>.<method>` |
