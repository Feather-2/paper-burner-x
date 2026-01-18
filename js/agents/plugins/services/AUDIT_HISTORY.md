# Audit History - services

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc Any Type
*Archived: 2026-01-18T20:45:24.032Z*

- **File**: js/agents/plugins/services/llm.js:41
- **Description**: 服务 API 的 JSDoc 使用 any/Record<string, any>，违反“禁止 any 类型”约定，降低可读性与工具提示效果（llm/mcp/scheduler/vfs 都有类似用法）。
- **Suggestion**: 定义明确的 @typedef（例如 LlmMessage、ChatOptions、ToolArgs、VfsOptions）并替换 any。
```
@param {any[]} messages
@param {Record<string, any>} [options]
@returns {Promise<any>}
```

---

## Archived: 2026-01-18

### [RESOLVED] Prototype Pollution
*Archived: 2026-01-18T20:45:12.598Z*

- **File**: js/agents/plugins/services/mcp.js:40
- **Description**: 使用 serverConfig.name 拼接状态路径；若 name 含 __proto__/constructor/prototype 等特殊值，且 ctx.state.set 采用路径写入，可能污染状态对象。
- **Suggestion**: 对 name 做白名单/转义（拒绝 __proto__/constructor/prototype），或改用 Map 存储并避免路径拼接。
```
ctx.state.set(`servers.${serverConfig.name}`, { status: 'connected' });
```

---

## Archived: 2026-01-18

### [RESOLVED] Missing JSDoc
*Archived: 2026-01-18T20:43:41.169Z*

- **File**: js/agents/plugins/services/vfs.js:41
- **Description**: service/vfs 的公开方法缺少完整 JSDoc，与“public API 必须有完整 JSDoc”约定不符。
- **Suggestion**: 为 readFile/writeFile/deleteFile/list/glob 等公开方法补充 @param/@returns/@throws。
```
async readFile(path, options) {
  return vfs.readFile(path, options);
},
```

---

## Archived: 2026-01-18

### [RESOLVED] Resource Leak
*Archived: 2026-01-18T20:41:16.991Z*

- **File**: js/agents/plugins/services/scheduler.js:71
- **Description**: 超时 Promise 使用 setTimeout，但任务完成后未清理定时器；大量短任务会积累待触发的计时器。
- **Suggestion**: 保存 timeout 句柄并在任务完成/失败后 clearTimeout，或使用 AbortController 封装可取消超时。
```
const result = await Promise.race([
  task.execute(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Task timeout')), task.timeout)
  ),
]);
```

---

## Archived: 2026-01-18

### [RESOLVED] SSRF
*Archived: 2026-01-18T20:41:16.140Z*

- **File**: js/agents/plugins/services/mcp.js:36
- **Description**: MCP 连接直接使用 serverConfig 构造客户端并连接；若 serverConfig 来自不可信输入，可能导致服务器端对任意地址发起请求（SSRF）。
- **Suggestion**: 限制或校验 serverConfig.url（协议/域名/端口 allowlist），或确保该配置只来自受信任来源。
```
const client = new McpClient(serverConfig);
await /** @type {any} */ (client).connect();
```

---

