# services - 服务插件

注册内核基础服务（LLM/MCP/调度器/VFS），统一通过 `kernel.services` 调用。

## 模块描述
- 以 `createPlugin` 封装服务并在 `install` 阶段注册
- 插件名采用 `service/*`，服务名为短标识（`llm`/`mcp`/`scheduler`/`vfs`）
- 通过事件与作用域状态对外暴露运行信息，支持自动连接与任务超时

## 核心文件

| 文件 | 插件 | 职责 |
|------|------|------|
| `llm.js` | `service/llm` | 注册 LLM Provider 服务（chat/stream/getConfig/getStats） |
| `mcp.js` | `service/mcp` | MCP 客户端连接、工具调用、自动连接与断开 |
| `scheduler.js` | `service/scheduler` | 优先级队列、并发/超时控制、取消/状态查询 |
| `vfs.js` | `service/vfs` | 统一 VFS 读写/目录/Glob 能力并暴露实例信息 |

## 关键概念
- 服务注册：`ctx.registerService(name, service)` 将服务挂到 `kernel.services`
- 统一调用：`kernel.services.call()` / `kernel.services.get()` / `kernel.invoke()`
- 事件流：`llm.response`、`mcp.connected`、`mcp.tool.call`/`mcp.tool.result`、`scheduler.task.start/complete/error/cancelled`、`vfs.write`/`vfs.delete`
- 作用域状态：`ctx.state` 自动带 `plugins.service/*` 前缀，LLM token 统计在 `tokens`，调度统计在 `stats`/`running`

## 常见任务

### 加载服务插件
```javascript
const kernel = new Kernel();
await kernel.use('service/llm', { provider: 'anthropic' });
await kernel.use('service/mcp', { servers: [{ name: 'local', url: 'http://...' }] });
await kernel.use('service/scheduler', { maxConcurrent: 3 });
await kernel.use('service/vfs', { kind: 'auto', rootPath: '.' });
await kernel.start();
```

### 调用 LLM
```javascript
const messages = [{ role: 'user', content: 'hi' }];
const res = await kernel.services.call('llm', 'chat', [messages, { temperature: 0.2 }]);
```

### 查询 LLM 配置/统计
```javascript
const llm = kernel.services.get('llm');
const config = llm.getConfig();
const stats = llm.getStats();
```

### MCP 连接与工具调用
```javascript
await kernel.services.call('mcp', 'connect', [{ name: 'local', url: 'http://...' }]);
const tools = await kernel.services.call('mcp', 'listTools', ['local']);
const result = await kernel.services.call('mcp', 'callTool', ['local', tools[0].name, { foo: 'bar' }]);
```

### MCP 断开所有连接
```javascript
await kernel.services.call('mcp', 'disconnectAll', []);
```

### 调度任务（含取消）
```javascript
const scheduler = kernel.services.get('scheduler');
const task = scheduler.schedule(() => doWork(), TaskPriority.HIGH);
// 需要取消时，监听 scheduler.task.queued 获取 id，再调用 scheduler.cancel(id)
await task;
```

### VFS 读写与 Glob
```javascript
const vfs = kernel.services.get('vfs');
await vfs.writeFile('data/config.json', JSON.stringify({ ok: true }));
const list = await vfs.glob('data/*.json');
```

### VFS 目录列表
```javascript
const list = await vfs.list('data');
```