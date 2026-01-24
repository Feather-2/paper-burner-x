# services - 服务插件

注册内核基础服务（LLM/MCP/调度器/VFS），统一通过 `kernel.services` 调用。

## 模块描述
- 以 `createPlugin` 封装服务并在 `install` 阶段注册
- 插件名采用 `service/*`，服务名为短标识（`llm`/`mcp`/`scheduler`/`vfs`）
- 通过事件与作用域状态对外暴露运行信息，支持自动连接与任务超时
- 对关键配置做输入校验：MCP server `name` 防原型污染、`url` 仅允许 `http/https/ws/wss`

## 核心文件

| 文件 | 插件 | 职责 |
|------|------|------|
| `llm.js` | `service/llm` | 注册 LLM Provider 服务（chat/stream/getConfig/getStats，支持 tools/tool_choice） |
| `mcp.js` | `service/mcp` | MCP 客户端连接、工具调用、自动连接与断开（server name/url 校验） |
| `scheduler.js` | `service/scheduler` | 优先级队列（`TaskPriority`）、并发/超时控制、取消/状态查询 |
| `vfs.js` | `service/vfs` | 统一 VFS 读写/目录/Glob 能力并暴露实例信息 |

## 关键概念
- 服务注册：`ctx.registerService(name, service)` 将服务挂到 `kernel.services`
- 统一调用：`kernel.services.call()` / `kernel.services.get()` / `kernel.invoke()`
- 事件流：`llm.response`、`mcp.connected`、`mcp.tool.call`/`mcp.tool.result`、`scheduler.task.start/complete/error/cancelled`、`vfs.write`/`vfs.delete`
- 作用域状态：`ctx.state` 自动带 `plugins.service/*` 前缀，LLM token 统计在 `tokens`，调度统计在 `stats`/`running`
- 任务优先级：`TaskPriority.LOW|NORMAL|HIGH|CRITICAL`（数值越大优先级越高）

## 常见任务

### 加载服务插件
```javascript
const kernel = new Kernel();

await kernel.use('service/llm', {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 8192,
  temperature: 0.7,
});

await kernel.use('service/mcp', {
  servers: [
    { name: 'local', url: 'http://127.0.0.1:8787' },
    // name 不能是: __proto__/constructor/prototype
    // url 协议仅允许: http/https/ws/wss
  ],
});

await kernel.use('service/scheduler', { maxConcurrent: 3, defaultTimeout: 60000 });
await kernel.use('service/vfs', { kind: 'auto', rootPath: '.' });

await kernel.start();
```

### 调用 LLM
```javascript
const messages = [{ role: 'user', content: 'hi' }];
const res = await kernel.services.call('llm', 'chat', [messages, { temperature: 0.2 }]);
```

### 使用 Tools（LLM）
> `tools`/`tool_choice` 结构通常会透传给具体 provider（字段形状以 provider 为准）。

```javascript
const messages = [{ role: 'user', content: 'Use the tool if needed.' }];
const res = await kernel.services.call('llm', 'chat', [
  messages,
  {
    tools: [/* provider-specific tool definitions */],
    tool_choice: 'auto',
  },
]);
```

### 查询 LLM 配置/统计
```javascript
const llm = kernel.services.get('llm');
const config = llm.getConfig();
const stats = llm.getStats();
```

### MCP 连接与工具调用
```javascript
await kernel.services.call('mcp', 'connect', [{ name: 'local', url: 'http://127.0.0.1:8787' }]);
const tools = await kernel.services.call('mcp', 'listTools', ['local']);
const result = await kernel.services.call('mcp', 'callTool', ['local', tools[0].name, { foo: 'bar' }]);
```

### MCP 断开所有连接
```javascript
await kernel.services.call('mcp', 'disconnectAll', []);
```

### 调度任务（优先级/超时/取消）
> 具体公开方法名以 `scheduler.js` 注册到 service 对象为准。

- 优先级常量：`TaskPriority.LOW|NORMAL|HIGH|CRITICAL`
- 典型能力：提交任务（返回 `taskId`）、取消任务、查询状态、并发/超时控制
