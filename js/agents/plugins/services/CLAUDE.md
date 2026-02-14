# services - 服务插件

注册内核基础服务（LLM/MCP/调度器/VFS），统一通过 `kernel.services` 调用。

## 模块描述
- 以 `createPlugin` 封装服务并在 `install` 阶段注册
- 插件名采用 `service/*`，服务名为短标识（`llm`/`mcp`/`scheduler`/`vfs`）
- 通过事件与作用域状态对外暴露运行信息，支持自动连接与任务超时
- MCP 对关键配置做输入校验：server `name` 防原型污染、`url` 仅允许 `http/https/ws/wss`
- 调度器在 Browser/Node 统一运行：优先使用 `setImmediate`，否则回退到微任务调度

## 核心文件

| 文件 | 插件 | 职责 |
|------|------|------|
| `llm.js` | `service/llm` | 注册 LLM Provider 服务（`chat`/`stream`/`getConfig`/`getStats`，支持 `tools`/`tool_choice`） |
| `mcp.js` | `service/mcp` | MCP 客户端连接、工具调用、自动连接与断开（server `name`/`url` 校验） |
| `scheduler.js` | `service/scheduler` | 优先级队列（`TaskPriority`）、并发/超时控制、取消/状态查询 |
| `vfs.js` | `service/vfs` | 统一 VFS 读写/目录/Glob 能力并暴露实例信息 |

## 关键概念
- 服务注册：`ctx.registerService(name, service)` 将服务挂到 `kernel.services`
- 统一调用：`kernel.services.call()` / `kernel.services.get()` / `kernel.invoke()`
- 事件流：`llm:response`、`mcp:connected`、`mcp:tool:call`/`mcp:tool:result`、`scheduler:task:start/complete/error/cancelled`、`vfs:write`/`vfs:delete`
- 作用域状态：`ctx.state` 自动带 `plugins.service/*` 前缀，LLM token 统计在 `tokens`，调度统计在 `stats`/`running`
- 任务优先级：`TaskPriority.LOW|NORMAL|HIGH|CRITICAL`（数值越大优先级越高）

## MCP 配置约束
- `servers[].name` 必须是非空字符串，且不能是 `__proto__` / `constructor` / `prototype`
- `servers[].url` 必须是合法 URL，协议白名单：`http:` / `https:` / `ws:` / `wss:`
- 校验失败时立即抛出异常并阻止插件继续安装

## LLM 数据结构（约定）
> 字段形状会随 provider 不同略有差异；这里是本模块对外的最小约定。

- `LlmMessage`：`{ role, content, name?, tool_call_id? }`
  - `role`：`'user' | 'assistant' | 'system' | 'tool'`
  - `content`：文本内容
  - `name`：可选，通常用于 `tool` 角色标识工具名
  - `tool_call_id`：可选，用于串联工具调用
- `ChatOptions`：`{ model?, maxTokens?, temperature?, system?, tools?, tool_choice? }`
- `LlmUsage`：`{ input_tokens?, output_tokens? }`
- `LlmResponse`：`{ model, content, usage?, stop_reason? }`

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
```
